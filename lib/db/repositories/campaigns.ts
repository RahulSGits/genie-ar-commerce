import 'server-only'

import {
  getDb, now, uuid, str, strOrNull, num, param,
  type Row, type SqlParam,
} from '@/lib/db'
import { mapProduct } from '@/lib/db/repositories/catalog'
import type { Product } from '@/types/domain'

/**
 * Campaigns (§21, §31).
 *
 * A campaign is a dated set of products with its own QR codes and landing
 * page. It exists because scan analytics only become commercially useful when
 * they attribute to the thing being promoted — "Diwali Collection got 3,000
 * scans" is a decision; "the catalogue got 3,000 scans" is a number.
 */

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired'

export type Campaign = {
  id: string
  businessId: string
  name: string
  slug: string
  description: string | null
  coverUrl: string | null
  destination: 'landing' | 'product'
  productId: string | null
  /** Stored intent: draft | paused | live. */
  storedStatus: string
  /** What is actually true right now, given the dates. */
  status: CampaignStatus
  startsAt: string | null
  endsAt: string | null
  goal: string | null
  productCount: number
  qrCount: number
  scans: number
  createdAt: string
  updatedAt: string
}

/**
 * Derives the real status from the stored intent plus the dates.
 *
 * The stored column is the operator's *intent* (`draft`, `live`, `paused`);
 * whether the campaign is live is a function of intent AND the clock. Storing
 * "active" and relying on a job to flip it to "expired" means a campaign whose
 * end date passed while the job was down is still advertising a finished
 * promotion — the same failure the scheduled-publishing predicate avoids.
 *
 * Exported and pure so it is unit-testable without a database.
 */
export function resolveCampaignStatus(
  stored: string,
  startsAt: string | null,
  endsAt: string | null,
  at: string = new Date().toISOString(),
): CampaignStatus {
  if (stored === 'draft') return 'draft'
  if (stored === 'paused') return 'paused'
  if (endsAt && endsAt <= at) return 'expired'
  if (startsAt && startsAt > at) return 'scheduled'
  return 'active'
}

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  active: 'Active',
  paused: 'Paused',
  expired: 'Ended',
}

export const CAMPAIGN_STATUS_VARIANTS: Record<
  CampaignStatus,
  'default' | 'success' | 'warning' | 'muted' | 'destructive'
> = {
  draft: 'muted',
  scheduled: 'default',
  active: 'success',
  paused: 'warning',
  expired: 'muted',
}

function mapCampaign(row: Row, at: string): Campaign {
  const stored = str(row, 'status') || 'draft'
  const startsAt = strOrNull(row, 'starts_at')
  const endsAt = strOrNull(row, 'ends_at')

  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    name: str(row, 'name'),
    slug: str(row, 'slug'),
    description: strOrNull(row, 'description'),
    coverUrl: strOrNull(row, 'cover_url'),
    destination: (str(row, 'destination') || 'landing') as 'landing' | 'product',
    productId: strOrNull(row, 'product_id'),
    storedStatus: stored,
    status: resolveCampaignStatus(stored, startsAt, endsAt, at),
    startsAt,
    endsAt,
    goal: strOrNull(row, 'goal'),
    productCount: num(row, 'product_count'),
    qrCount: num(row, 'qr_count'),
    scans: num(row, 'scans'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  }
}

const SELECT_CAMPAIGN = `
  SELECT c.*,
         (SELECT COUNT(*) FROM campaign_products cp WHERE cp.campaign_id = c.id) AS product_count,
         (SELECT COUNT(*) FROM qr_codes q WHERE q.campaign_id = c.id AND q.deleted_at IS NULL) AS qr_count,
         (SELECT COALESCE(SUM(q.scan_count), 0) FROM qr_codes q WHERE q.campaign_id = c.id) AS scans
    FROM campaigns c`

export function listCampaigns(businessId: string): Campaign[] {
  const at = now()
  const rows = getDb()
    .prepare(`${SELECT_CAMPAIGN} WHERE c.business_id = ? AND c.deleted_at IS NULL
              ORDER BY c.created_at DESC`)
    .all(businessId) as Row[]
  return rows.map((row) => mapCampaign(row, at))
}

export function getCampaign(businessId: string, id: string): Campaign | null {
  const row = getDb()
    .prepare(`${SELECT_CAMPAIGN} WHERE c.id = ? AND c.business_id = ? AND c.deleted_at IS NULL`)
    .get(id, businessId) as Row | undefined
  return row ? mapCampaign(row, now()) : null
}

/**
 * Public read for the campaign landing page.
 *
 * Returns null for anything not currently live, so a paused or expired
 * campaign's printed QR lands on a clear "this promotion has ended" page
 * rather than silently serving stale prices.
 */
export function getPublicCampaign(
  businessSlug: string,
  campaignSlug: string,
): { campaign: Campaign; live: boolean } | null {
  const row = getDb()
    .prepare(
      `${SELECT_CAMPAIGN}
         JOIN businesses b ON b.id = c.business_id
        WHERE b.slug = ? AND c.slug = ? AND c.deleted_at IS NULL
          AND b.deleted_at IS NULL AND b.status = 'active'`,
    )
    .get(businessSlug, campaignSlug) as Row | undefined

  if (!row) return null
  const campaign = mapCampaign(row, now())
  return { campaign, live: campaign.status === 'active' }
}

export function createCampaign(input: {
  businessId: string
  name: string
  slug: string
  description?: string | null
  startsAt?: string | null
  endsAt?: string | null
  goal?: string | null
  destination?: 'landing' | 'product'
  productId?: string | null
}): string {
  const id = uuid()
  const timestamp = now()

  getDb()
    .prepare(
      `INSERT INTO campaigns (id, business_id, name, slug, description, destination,
                              product_id, status, starts_at, ends_at, goal,
                              created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.businessId,
      input.name,
      input.slug,
      param(input.description ?? null),
      input.destination ?? 'landing',
      param(input.productId ?? null),
      param(input.startsAt ?? null),
      param(input.endsAt ?? null),
      param(input.goal ?? null),
      timestamp,
      timestamp,
    )

  return id
}

const UPDATABLE: Record<string, string> = {
  name: 'name',
  slug: 'slug',
  description: 'description',
  coverUrl: 'cover_url',
  destination: 'destination',
  productId: 'product_id',
  status: 'status',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  goal: 'goal',
}

export function updateCampaign(
  businessId: string,
  id: string,
  patch: Record<string, unknown>,
): void {
  const sets: string[] = []
  const params: SqlParam[] = []

  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (!(field in patch)) continue
    sets.push(`${column} = ?`)
    params.push(param(patch[field] ?? null))
  }
  if (sets.length === 0) return

  sets.push('updated_at = ?')
  params.push(now(), id, businessId)

  getDb()
    .prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ? AND business_id = ?`)
    .run(...params)
}

export function deleteCampaign(businessId: string, id: string): void {
  getDb()
    .prepare(`UPDATE campaigns SET deleted_at = ?, updated_at = ? WHERE id = ? AND business_id = ?`)
    .run(now(), now(), id, businessId)
}

/* ── membership ─────────────────────────────────────────────────────────── */

/**
 * Replaces the campaign's product set wholesale.
 *
 * The array's index becomes sort_order, so callers must pass ids in display
 * order — the same contract as collections.
 */
export function setCampaignProducts(
  businessId: string,
  campaignId: string,
  productIds: string[],
): void {
  const db = getDb()

  const owns = db
    .prepare(`SELECT 1 FROM campaigns WHERE id = ? AND business_id = ? AND deleted_at IS NULL`)
    .get(campaignId, businessId)
  if (!owns) return

  db.prepare(`DELETE FROM campaign_products WHERE campaign_id = ?`).run(campaignId)

  const insert = db.prepare(
    `INSERT INTO campaign_products (campaign_id, product_id, sort_order)
     SELECT ?, id, ? FROM products WHERE id = ? AND business_id = ? AND deleted_at IS NULL`,
  )
  // The SELECT is the tenant check: a product id belonging to another business
  // inserts zero rows rather than being silently accepted.
  productIds.forEach((productId, index) => {
    insert.run(campaignId, index, productId, businessId)
  })
}

export function listCampaignProducts(businessId: string, campaignId: string): Product[] {
  const rows = getDb()
    .prepare(
      `SELECT p.* FROM campaign_products cp
         JOIN products p ON p.id = cp.product_id
        WHERE cp.campaign_id = ? AND p.business_id = ? AND p.deleted_at IS NULL
        ORDER BY cp.sort_order ASC`,
    )
    .all(campaignId, businessId) as Row[]
  return rows.map(mapProduct)
}

/** Public variant: only products a customer may actually see. */
export function listPublicCampaignProducts(campaignId: string): Product[] {
  const timestamp = now()
  const rows = getDb()
    .prepare(
      `SELECT p.* FROM campaign_products cp
         JOIN products p ON p.id = cp.product_id
        WHERE cp.campaign_id = ?
          AND p.status = 'published'
          AND p.deleted_at IS NULL
          AND (p.publish_at IS NULL OR p.publish_at <= ?)
          AND (p.unpublish_at IS NULL OR p.unpublish_at > ?)
          AND p.approval_status IN ('none', 'approved')
        ORDER BY cp.sort_order ASC`,
    )
    .all(campaignId, timestamp, timestamp) as Row[]
  return rows.map(mapProduct)
}

/** Campaigns whose end date has just passed, for the webhook + notification. */
export function expiringCampaigns(businessId: string, withinDays = 7): Campaign[] {
  const at = now()
  const horizon = new Date(Date.now() + withinDays * 86_400_000).toISOString()
  return listCampaigns(businessId).filter(
    (c) => c.status === 'active' && c.endsAt !== null && c.endsAt <= horizon && c.endsAt > at,
  )
}

export function campaignSlugAvailable(businessId: string, slug: string, exceptId?: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM campaigns WHERE business_id = ? AND slug = ? AND deleted_at IS NULL
        ${exceptId ? 'AND id != ?' : ''} LIMIT 1`,
    )
    .get(...(exceptId ? [businessId, slug, exceptId] : [businessId, slug]))
  return !row
}
