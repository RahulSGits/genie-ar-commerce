import 'server-only'

import { getDb, now, today, uuid, type Row, str, num, toJson, param } from '@/lib/db'
import type { CurrencyCode } from '@/utils/money'

/**
 * What it costs GENIE to serve a customer.
 *
 * GENIE is itself a SaaS business, so "are we making money on this account"
 * has to be answerable from data rather than from a spreadsheet someone
 * maintains by hand. Every action with a real infrastructure cost appends a
 * row here, in the same integer minor units as revenue — which is what turns
 * gross margin into a subtraction instead of an estimate.
 *
 * Rates are configuration, not constants baked into call sites, because they
 * change whenever a vendor changes pricing and they differ per provider.
 */

export type CostKind = 'ai_generation' | 'storage' | 'bandwidth' | 'compute' | 'api'

export const COST_KIND_LABELS: Record<CostKind, string> = {
  ai_generation: 'AI 3D generation',
  storage: 'Object storage',
  bandwidth: 'Bandwidth',
  compute: 'Compute',
  api: 'Third-party API',
}

/**
 * Default unit rates in paise (INR minor units).
 *
 * These are the platform's own assumptions and are overridable from
 * /admin/settings — they are NOT quotes from any vendor. Where a real invoice
 * exists the recorded cost should come from the provider's response instead of
 * from this table, which is why `recordCost` takes an explicit `costMinor`.
 */
export const DEFAULT_RATES = {
  /** Per successful image-to-3D generation. */
  aiGenerationPerModel: 2500,
  /** Per GB-month of stored assets. */
  storagePerGbMonth: 200,
  /** Per GB egress — the dominant cost, since every QR scan pulls a GLB. */
  bandwidthPerGb: 800,
  /** Per 1,000 API requests. */
  apiPer1kRequests: 10,
} as const

export type CostRates = typeof DEFAULT_RATES

export function recordCost(input: {
  businessId?: string | null
  kind: CostKind
  provider?: string | null
  quantity: number
  unit: string
  costMinor: number
  currency?: CurrencyCode
  referenceId?: string | null
  metadata?: unknown
}): void {
  if (!Number.isInteger(input.costMinor)) {
    // Same rule as revenue: a fractional paisa is a rounding bug that only
    // shows up months later as a margin that does not reconcile.
    throw new Error(`costMinor must be an integer, received ${input.costMinor}`)
  }

  getDb()
    .prepare(
      `INSERT INTO cost_events
         (id, business_id, kind, provider, quantity, unit, cost_minor, currency,
          reference_id, metadata, day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuid(),
      param(input.businessId ?? null),
      input.kind,
      param(input.provider ?? null),
      input.quantity,
      input.unit,
      input.costMinor,
      input.currency ?? 'INR',
      param(input.referenceId ?? null),
      param(toJson(input.metadata ?? null)),
      today(),
      now(),
    )
}

/** Convenience for the generation pipeline, which is the biggest cost driver. */
export function recordGenerationCost(
  businessId: string,
  provider: string,
  jobId: string,
  costMinor: number = DEFAULT_RATES.aiGenerationPerModel,
): void {
  recordCost({
    businessId,
    kind: 'ai_generation',
    provider,
    quantity: 1,
    unit: 'model',
    costMinor,
    referenceId: jobId,
  })
}

/* ── reads ──────────────────────────────────────────────────────────────── */

export type CostByKind = { kind: CostKind; costMinor: number; quantity: number }

export function costsByKind(sinceDay: string, businessId?: string): CostByKind[] {
  const rows = getDb()
    .prepare(
      `SELECT kind, SUM(cost_minor) AS cost_minor, SUM(quantity) AS quantity
         FROM cost_events
        WHERE day >= ? ${businessId ? 'AND business_id = ?' : ''}
        GROUP BY kind ORDER BY cost_minor DESC`,
    )
    .all(...(businessId ? [sinceDay, businessId] : [sinceDay])) as Row[]

  return rows.map((row) => ({
    kind: str(row, 'kind') as CostKind,
    costMinor: num(row, 'cost_minor'),
    quantity: num(row, 'quantity'),
  }))
}

export function totalCostMinor(sinceDay: string, businessId?: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(cost_minor), 0) AS total FROM cost_events
        WHERE day >= ? ${businessId ? 'AND business_id = ?' : ''}`,
    )
    .get(...(businessId ? [sinceDay, businessId] : [sinceDay])) as Row | undefined
  return num(row ?? {}, 'total')
}

/** Per-business cost for the margin table on the admin dashboard. */
export function costByBusiness(sinceDay: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT business_id, SUM(cost_minor) AS total FROM cost_events
        WHERE day >= ? AND business_id IS NOT NULL GROUP BY business_id`,
    )
    .all(sinceDay) as Row[]
  return new Map(rows.map((row) => [str(row, 'business_id'), num(row, 'total')]))
}

/* ── derived costs ──────────────────────────────────────────────────────── */

/**
 * Storage and bandwidth are not events, they are standing quantities — so they
 * are computed from what is actually stored and served rather than accrued row
 * by row. Called by the daily tick, which is why it takes the day explicitly.
 */
export function accrueStorageCost(day: string, rates: CostRates = DEFAULT_RATES): number {
  const db = getDb()

  // Already accrued for this day? Re-running the tick must not double-charge.
  const existing = db
    .prepare(`SELECT COUNT(*) AS n FROM cost_events WHERE kind = 'storage' AND day = ?`)
    .get(day) as Row | undefined
  if (num(existing ?? {}, 'n') > 0) return 0

  const rows = db
    .prepare(
      `SELECT business_id, SUM(bytes) AS bytes FROM (
         SELECT business_id, file_size_bytes AS bytes FROM three_d_models WHERE deleted_at IS NULL
         UNION ALL
         SELECT business_id, bytes FROM product_images
       ) GROUP BY business_id`,
    )
    .all() as Row[]

  let total = 0
  const daysInMonth = 30

  for (const row of rows) {
    const gb = num(row, 'bytes') / 1_000_000_000
    // One day's share of a GB-month, rounded to whole paise. Rounding per
    // business rather than in aggregate keeps per-account margin honest.
    const costMinor = Math.round((gb * rates.storagePerGbMonth) / daysInMonth)
    if (costMinor <= 0) continue

    recordCost({
      businessId: str(row, 'business_id'),
      kind: 'storage',
      quantity: gb,
      unit: 'GB-day',
      costMinor,
    })
    total += costMinor
  }

  return total
}
