import 'server-only'

import { getDb, now, today, uuid, str, num, type Row, type SqlParam } from '@/lib/db'
import { AR_FUNNEL_EVENTS, type ArFunnelEvent } from '@/types/ar'

/**
 * Analytics.
 *
 * Append-only and deliberately anonymous. What is NOT stored, ever: IP address,
 * user agent string, any device fingerprint, any camera frame. Only coarse
 * buckets ('mobile', 'Safari', 'iOS') that cannot re-identify a person.
 *
 * `session_key` is random per page load, not per person. It lets us count
 * sessions and measure funnel drop-off without tracking anyone across visits.
 */

export type RecordEventInput = {
  businessId: string
  eventType: ArFunnelEvent | string
  productId?: string | null
  qrCodeId?: string | null
  deviceType?: string | null
  browser?: string | null
  os?: string | null
  arTier?: string | null
  campaign?: string | null
  sessionKey?: string | null
}

export function recordEvent(input: RecordEventInput): void {
  getDb()
    .prepare(
      `INSERT INTO analytics_events
         (id, business_id, product_id, qr_code_id, event_type, device_type, browser, os,
          ar_tier, campaign, session_key, created_at, day)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuid(), input.businessId, input.productId ?? null, input.qrCodeId ?? null,
      input.eventType, input.deviceType ?? null, input.browser ?? null, input.os ?? null,
      input.arTier ?? null, input.campaign ?? null, input.sessionKey ?? null,
      now(), today(),
    )
}

/* ── aggregates ─────────────────────────────────────────────────────────── */

function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Inclusive start of a "last N days" window.
 *
 * `day >= daysAgo(30)` spans THIRTY-ONE calendar days — today plus thirty
 * before it — so every "last 30 days" figure was silently inflated by an extra
 * day's traffic, and disagreed with the 30-point chart beside it.
 */
function windowStart(days: number): string {
  return daysAgo(Math.max(0, days - 1))
}

export type FunnelCounts = Record<ArFunnelEvent, number>

/**
 * The conversion funnel. Aggregated at query time against an indexed
 * (business_id, event_type, day) — at the scale this product targets that is
 * far simpler and fresher than maintaining rollup tables, and it needs no
 * background job service to stay correct.
 */
export function getFunnel(businessId: string, days = 30): FunnelCounts {
  const rows = getDb()
    .prepare(
      `SELECT event_type, COUNT(*) AS c
         FROM analytics_events
        WHERE business_id = ? AND day >= ?
        GROUP BY event_type`,
    )
    .all(businessId, windowStart(days)) as Row[]

  const counts = Object.fromEntries(AR_FUNNEL_EVENTS.map((e) => [e, 0])) as FunnelCounts
  for (const row of rows) {
    const key = str(row, 'event_type') as ArFunnelEvent
    if (key in counts) counts[key] = num(row, 'c')
  }
  return counts
}

/**
 * The same funnel, narrowed to one product.
 *
 * Not `getFunnel` with a filter argument: the product-scoped query must also
 * match events whose product_id was cleared when a product was deleted, and
 * conflating the two would make a deleted product's history silently reappear
 * in every other product's numbers.
 */
export function getProductFunnel(
  businessId: string,
  productId: string,
  days = 30,
): FunnelCounts {
  const rows = getDb()
    .prepare(
      `SELECT event_type, COUNT(*) AS c
         FROM analytics_events
        WHERE business_id = ? AND product_id = ? AND day >= ?
        GROUP BY event_type`,
    )
    .all(businessId, productId, windowStart(days)) as Row[]

  const counts = Object.fromEntries(AR_FUNNEL_EVENTS.map((e) => [e, 0])) as FunnelCounts
  for (const row of rows) {
    const key = str(row, 'event_type') as ArFunnelEvent
    if (key in counts) counts[key] = num(row, 'c')
  }
  return counts
}

export type DailyPoint = { day: string; scans: number; arSessions: number; ctaClicks: number }

/** Dense series — days with no activity appear as zeros so charts don't lie. */
export function getDailySeries(businessId: string, days = 30): DailyPoint[] {
  const rows = getDb()
    .prepare(
      `SELECT day,
              SUM(CASE WHEN event_type = 'qr_scanned' THEN 1 ELSE 0 END) AS scans,
              SUM(CASE WHEN event_type = 'ar_session_started' THEN 1 ELSE 0 END) AS ar_sessions,
              SUM(CASE WHEN event_type = 'cta_clicked' THEN 1 ELSE 0 END) AS cta_clicks
         FROM analytics_events
        WHERE business_id = ? AND day >= ?
        GROUP BY day`,
    )
    .all(businessId, windowStart(days)) as Row[]

  const byDay = new Map(rows.map((r) => [str(r, 'day'), r]))
  const out: DailyPoint[] = []

  for (let i = days - 1; i >= 0; i--) {
    const day = daysAgo(i)
    const row = byDay.get(day)
    out.push({
      day,
      scans: row ? num(row, 'scans') : 0,
      arSessions: row ? num(row, 'ar_sessions') : 0,
      ctaClicks: row ? num(row, 'cta_clicks') : 0,
    })
  }
  return out
}

export type TopProduct = { productId: string; name: string; views: number; arSessions: number }

export function getTopProducts(businessId: string, days = 30, limit = 5): TopProduct[] {
  const rows = getDb()
    .prepare(
      `SELECT e.product_id, p.name,
              SUM(CASE WHEN e.event_type = 'product_loaded' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN e.event_type = 'ar_session_started' THEN 1 ELSE 0 END) AS ar_sessions
         FROM analytics_events e
         JOIN products p ON p.id = e.product_id AND p.deleted_at IS NULL
        WHERE e.business_id = ? AND e.day >= ? AND e.product_id IS NOT NULL
        GROUP BY e.product_id
        ORDER BY views DESC
        LIMIT ?`,
    )
    .all(businessId, windowStart(days), limit) as Row[]

  return rows.map((r) => ({
    productId: str(r, 'product_id'),
    name: str(r, 'name'),
    views: num(r, 'views'),
    arSessions: num(r, 'ar_sessions'),
  }))
}

export type DeviceBreakdown = { label: string; count: number }

export function getDeviceBreakdown(businessId: string, days = 30): DeviceBreakdown[] {
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(device_type, 'unknown') AS label, COUNT(*) AS c
         FROM analytics_events
        WHERE business_id = ? AND day >= ?
        GROUP BY label
        ORDER BY c DESC`,
    )
    .all(businessId, windowStart(days)) as Row[]
  return rows.map((r) => ({ label: str(r, 'label'), count: num(r, 'c') }))
}

export type BusinessStats = {
  totalScans: number
  totalProducts: number
  arProducts: number
  totalQrCodes: number
  arSessions: number
  ctaClicks: number
  conversionRate: number
}

export function getBusinessStats(businessId: string, days = 30): BusinessStats {
  const db = getDb()
  const since = windowStart(days)
  const one = (sql: string, ...p: SqlParam[]) => num(db.prepare(sql).get(...p) as Row, 'c')

  const totalScans = one(
    `SELECT COUNT(*) AS c FROM analytics_events
      WHERE business_id = ? AND event_type = 'qr_scanned' AND day >= ?`,
    businessId, since,
  )
  const arSessions = one(
    `SELECT COUNT(*) AS c FROM analytics_events
      WHERE business_id = ? AND event_type = 'ar_session_started' AND day >= ?`,
    businessId, since,
  )
  const ctaClicks = one(
    `SELECT COUNT(*) AS c FROM analytics_events
      WHERE business_id = ? AND event_type = 'cta_clicked' AND day >= ?`,
    businessId, since,
  )

  return {
    totalScans,
    arSessions,
    ctaClicks,
    totalProducts: one(
      `SELECT COUNT(*) AS c FROM products WHERE business_id = ? AND deleted_at IS NULL`,
      businessId,
    ),
    arProducts: one(
      `SELECT COUNT(*) AS c FROM products
        WHERE business_id = ? AND deleted_at IS NULL AND ar_enabled = 1 AND model_id IS NOT NULL`,
      businessId,
    ),
    totalQrCodes: one(
      `SELECT COUNT(*) AS c FROM qr_codes WHERE business_id = ? AND deleted_at IS NULL`,
      businessId,
    ),
    // Guarded against the zero-scan case that would otherwise render NaN%.
    conversionRate: totalScans === 0 ? 0 : Number(((ctaClicks / totalScans) * 100).toFixed(1)),
  }
}

/* ── platform-wide (super admin) ────────────────────────────────────────── */

export type PlatformStats = {
  totalBusinesses: number
  activeBusinesses: number
  trialBusinesses: number
  suspendedBusinesses: number
  totalProducts: number
  totalArProducts: number
  totalScans: number
  totalQrCodes: number
}

export function getPlatformStats(): PlatformStats {
  const db = getDb()
  const one = (sql: string, ...p: SqlParam[]) => num(db.prepare(sql).get(...p) as Row, 'c')

  return {
    totalBusinesses: one(`SELECT COUNT(*) AS c FROM businesses WHERE deleted_at IS NULL`),
    activeBusinesses: one(
      `SELECT COUNT(*) AS c FROM businesses WHERE deleted_at IS NULL AND status = 'active'`,
    ),
    trialBusinesses: one(
      `SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'trialing'`,
    ),
    suspendedBusinesses: one(
      `SELECT COUNT(*) AS c FROM businesses WHERE deleted_at IS NULL AND status = 'suspended'`,
    ),
    totalProducts: one(`SELECT COUNT(*) AS c FROM products WHERE deleted_at IS NULL`),
    totalArProducts: one(
      `SELECT COUNT(*) AS c FROM products
        WHERE deleted_at IS NULL AND ar_enabled = 1 AND model_id IS NOT NULL`,
    ),
    totalScans: one(`SELECT COUNT(*) AS c FROM analytics_events WHERE event_type = 'qr_scanned'`),
    totalQrCodes: one(`SELECT COUNT(*) AS c FROM qr_codes WHERE deleted_at IS NULL`),
  }
}
