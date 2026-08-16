import 'server-only'

import {
  getDb, now, uuid, toBool, fromBool, str, strOrNull, num, param,
  type Row, type SqlParam,
} from '@/lib/db'
import { generatePublicToken } from '@/lib/utils'
import type { QrCode, QrDestination } from '@/types/domain'

function mapQr(row: Row): QrCode {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    productId: strOrNull(row, 'product_id'),
    token: str(row, 'token'),
    label: str(row, 'label'),
    destination: (str(row, 'destination') || 'ar') as QrDestination,
    customUrl: strOrNull(row, 'custom_url'),
    campaign: strOrNull(row, 'campaign'),
    isActive: toBool(row.is_active),
    scanCount: num(row, 'scan_count'),
    lastScanAt: strOrNull(row, 'last_scan_at'),
    createdAt: str(row, 'created_at'),
    productName: strOrNull(row, 'product_name'),
  }
}

export function listQrCodes(businessId: string): QrCode[] {
  const rows = getDb()
    .prepare(
      `SELECT q.*, p.name AS product_name
         FROM qr_codes q
         LEFT JOIN products p ON p.id = q.product_id
        WHERE q.business_id = ? AND q.deleted_at IS NULL
        ORDER BY q.created_at DESC`,
    )
    .all(businessId) as Row[]
  return rows.map(mapQr)
}

export function getQrCode(businessId: string, id: string): QrCode | null {
  const row = getDb()
    .prepare(
      `SELECT q.*, p.name AS product_name
         FROM qr_codes q
         LEFT JOIN products p ON p.id = q.product_id
        WHERE q.id = ? AND q.business_id = ? AND q.deleted_at IS NULL`,
    )
    .get(id, businessId) as Row | undefined
  return row ? mapQr(row) : null
}

/**
 * Public resolution by token. No businessId — this is the anonymous path, and
 * the token itself is the credential.
 *
 * Returns the slugs needed to build the destination URL, so the redirect route
 * never has to expose an internal id.
 */
export function resolveQrToken(token: string): {
  qr: QrCode
  businessSlug: string
  productSlug: string | null
  businessWebsite: string | null
  businessMenuUrl: string | null
} | null {
  const row = getDb()
    .prepare(
      `SELECT q.*, p.name AS product_name, p.slug AS product_slug,
              b.slug AS business_slug, b.website_url, b.menu_url, b.status AS business_status
         FROM qr_codes q
         JOIN businesses b ON b.id = q.business_id
         LEFT JOIN products p ON p.id = q.product_id AND p.deleted_at IS NULL
        WHERE q.token = ? AND q.deleted_at IS NULL AND b.deleted_at IS NULL`,
    )
    .get(token) as Row | undefined

  if (!row) return null
  // A deactivated code or a suspended business resolves to nothing rather than
  // to a broken page — the caller renders a friendly "not available" screen.
  if (!toBool(row.is_active)) return null
  if (str(row, 'business_status') !== 'active') return null

  return {
    qr: mapQr(row),
    businessSlug: str(row, 'business_slug'),
    productSlug: strOrNull(row, 'product_slug'),
    businessWebsite: strOrNull(row, 'website_url'),
    businessMenuUrl: strOrNull(row, 'menu_url'),
  }
}

export function createQrCode(input: {
  businessId: string
  productId?: string | null
  label?: string
  destination?: QrDestination
  customUrl?: string | null
  campaign?: string | null
  /** Binds the code to a campaign so its scans attribute there (§21). */
  campaignId?: string | null
}): { id: string; token: string } {
  const id = uuid()
  const token = generatePublicToken()
  const ts = now()

  getDb()
    .prepare(
      `INSERT INTO qr_codes
         (id, business_id, product_id, token, label, destination, custom_url, campaign,
          campaign_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      id, input.businessId, input.productId ?? null, token,
      input.label ?? '', input.destination ?? 'ar',
      input.customUrl ?? null, input.campaign ?? null,
      input.campaignId ?? null, ts, ts,
    )

  return { id, token }
}

export function updateQrCode(
  businessId: string,
  id: string,
  patch: Partial<{
    label: string
    destination: QrDestination
    customUrl: string | null
    campaign: string | null
    isActive: boolean
    productId: string | null
  }>,
): void {
  const map: Record<string, string> = {
    label: 'label', destination: 'destination', customUrl: 'custom_url',
    campaign: 'campaign', isActive: 'is_active', productId: 'product_id',
  }
  const sets: string[] = []
  const params: SqlParam[] = []

  for (const [k, v] of Object.entries(patch)) {
    const col = map[k]
    if (!col) continue
    sets.push(`${col} = ?`)
    params.push(param(k === 'isActive' ? fromBool(Boolean(v)) : (v ?? null)))
  }
  if (!sets.length) return

  sets.push('updated_at = ?')
  params.push(now(), id, businessId)
  getDb().prepare(`UPDATE qr_codes SET ${sets.join(', ')} WHERE id = ? AND business_id = ?`).run(...params)
}

/**
 * Issues a fresh token, invalidating every printed copy of the old one.
 * Deliberately separate from `updateQrCode` — this is destructive in the
 * physical world and should never happen as a side effect of an edit.
 */
export function regenerateQrToken(businessId: string, id: string): string | null {
  const token = generatePublicToken()
  const result = getDb()
    .prepare(`UPDATE qr_codes SET token = ?, updated_at = ? WHERE id = ? AND business_id = ?`)
    .run(token, now(), id, businessId)
  return result.changes > 0 ? token : null
}

export function deleteQrCode(businessId: string, id: string): void {
  getDb()
    .prepare(`UPDATE qr_codes SET deleted_at = ? WHERE id = ? AND business_id = ?`)
    .run(now(), id, businessId)
}

/** Called from the anonymous redirect route; deliberately cheap and unauthenticated. */
export function recordScan(qrId: string): void {
  getDb()
    .prepare(`UPDATE qr_codes SET scan_count = scan_count + 1, last_scan_at = ? WHERE id = ?`)
    .run(now(), qrId)
}

/** Absolute URL a printed QR encodes. Goes through /r/ so it stays re-pointable. */
export function qrTargetUrl(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/r/${token}`
}
