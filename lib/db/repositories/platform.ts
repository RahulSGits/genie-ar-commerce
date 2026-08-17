import 'server-only'

import {
  getDb, now, uuid, parseJson, toJson, toBool, str, strOrNull, num, param,
  type Row, type SqlParam,
} from '@/lib/db'
import type { AuditLog, Notification, Promotion } from '@/types/domain'

/**
 * Platform-level data: branding, feature flags, CMS content, audit trail.
 *
 * Everything the super admin can edit without a deploy lives here. Nothing in
 * this module is tenant-scoped — it is all global configuration.
 */

/* ── settings ───────────────────────────────────────────────────────────── */

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare(`SELECT value FROM system_settings WHERE key = ?`).get(key) as
    | Row
    | undefined
  return row ? parseJson<T>(row.value, fallback) : fallback
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, toJson(value), now())
}

export type Branding = {
  name: string
  tagline: string
  logoUrl: string | null
  faviconEmoji: string
  primaryColor: string
  supportEmail: string
  supportPhone: string
}

const DEFAULT_BRANDING: Branding = {
  name: 'GENIE',
  tagline: 'Turn your products into interactive AR experiences',
  logoUrl: null,
  faviconEmoji: '📦',
  primaryColor: '#5b3df5',
  supportEmail: 'support@genie.local',
  supportPhone: '',
}

export function getBranding(): Branding {
  return { ...DEFAULT_BRANDING, ...getSetting<Partial<Branding>>('branding', {}) }
}

export type FeatureFlags = {
  model_generation: boolean
  payments: boolean
  whatsapp: boolean
  voice_calling: boolean
  marker_ar: boolean
  white_label: boolean
  custom_domain: boolean
  advanced_analytics: boolean
  pwa: boolean
  /** Master switch for the public REST API. Off until an operator opts in. */
  public_api: boolean
  /** Outbound webhook delivery. Off by default — it makes outbound requests. */
  webhooks: boolean
}

/**
 * Every flag that would require a paid third party defaults to OFF. Nothing
 * here can start incurring cost without an explicit switch.
 */
const DEFAULT_FLAGS: FeatureFlags = {
  model_generation: false,
  payments: false,
  whatsapp: false,
  voice_calling: false,
  marker_ar: false,
  white_label: false,
  custom_domain: false,
  advanced_analytics: true,
  pwa: false,
  public_api: false,
  webhooks: false,
}

export function getFeatureFlags(): FeatureFlags {
  return { ...DEFAULT_FLAGS, ...getSetting<Partial<FeatureFlags>>('feature_flags', {}) }
}

export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return getFeatureFlags()[flag]
}

export type TaxSettings = { enabled: boolean; name: string; percent: number; taxId: string }

/** No default rate is assumed — tax is entirely the operator's configuration. */
export function getTaxSettings(): TaxSettings {
  return getSetting<TaxSettings>('tax', { enabled: false, name: 'Tax', percent: 0, taxId: '' })
}

export type BillingSettings = {
  gracePeriodDays: number
  autoSuspend: boolean
  invoicePrefix: string
}

export function getBillingSettings(): BillingSettings {
  return getSetting<BillingSettings>('billing', {
    gracePeriodDays: 7,
    // Off by default: automatically cutting a live venue's QR codes is a
    // decision an operator should opt into, not inherit.
    autoSuspend: false,
    invoicePrefix: 'INV-',
  })
}

/* ── CMS ────────────────────────────────────────────────────────────────── */

export function getCmsSection<T>(key: string): T | null {
  const row = getDb()
    .prepare(`SELECT content FROM cms_sections WHERE key = ? AND is_active = 1`)
    .get(key) as Row | undefined
  return row ? parseJson<T | null>(row.content, null) : null
}

export function setCmsSection(key: string, content: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO cms_sections (id, key, content, is_active, sort_order, updated_at)
       VALUES (?, ?, ?, 1, 0, ?)
       ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    )
    .run(uuid(), key, toJson(content), now())
}

export function listCmsSections(): Array<{ key: string; content: unknown; updatedAt: string }> {
  const rows = getDb()
    .prepare(`SELECT key, content, updated_at FROM cms_sections ORDER BY sort_order ASC`)
    .all() as Row[]
  return rows.map((r) => ({
    key: str(r, 'key'),
    content: parseJson<unknown>(r.content, null),
    updatedAt: str(r, 'updated_at'),
  }))
}

/* ── promotions ─────────────────────────────────────────────────────────── */

function mapPromotion(row: Row): Promotion {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    description: strOrNull(row, 'description'),
    discountType: (str(row, 'discount_type') || 'percentage') as 'percentage' | 'fixed',
    discountValue: num(row, 'discount_value'),
    couponCode: strOrNull(row, 'coupon_code'),
    applicablePlans: parseJson<string[] | null>(row.applicable_plans, null),
    startsAt: str(row, 'starts_at'),
    endsAt: str(row, 'ends_at'),
    bannerTitle: strOrNull(row, 'banner_title'),
    bannerMessage: strOrNull(row, 'banner_message'),
    bannerCtaLabel: strOrNull(row, 'banner_cta_label'),
    bannerCtaUrl: strOrNull(row, 'banner_cta_url'),
    bannerColor: strOrNull(row, 'banner_color'),
    showBanner: toBool(row.show_banner),
    isActive: toBool(row.is_active),
  }
}

/** The banner disappears on its own when the window closes — no manual cleanup. */
export function getActivePromotion(): Promotion | null {
  const ts = now()
  const row = getDb()
    .prepare(
      `SELECT * FROM promotions
        WHERE is_active = 1 AND starts_at <= ? AND ends_at >= ?
        ORDER BY starts_at DESC LIMIT 1`,
    )
    .get(ts, ts) as Row | undefined
  return row ? mapPromotion(row) : null
}

export function listPromotions(): Promotion[] {
  const rows = getDb().prepare(`SELECT * FROM promotions ORDER BY starts_at DESC`).all() as Row[]
  return rows.map(mapPromotion)
}

/* ── notifications ──────────────────────────────────────────────────────── */

export function listNotifications(opts: {
  businessId?: string
  userId?: string
  limit?: number
}): Notification[] {
  const where: string[] = []
  const params: SqlParam[] = []
  if (opts.businessId) {
    where.push('business_id = ?')
    params.push(param(opts.businessId))
  }
  if (opts.userId) {
    where.push('(user_id = ? OR user_id IS NULL)')
    params.push(param(opts.userId))
  }

  const rows = getDb()
    .prepare(
      `SELECT * FROM notifications
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, opts.limit ?? 20) as Row[]

  return rows.map((r) => ({
    id: str(r, 'id'),
    businessId: strOrNull(r, 'business_id'),
    userId: strOrNull(r, 'user_id'),
    title: str(r, 'title'),
    body: str(r, 'body'),
    kind: (str(r, 'kind') || 'info') as Notification['kind'],
    linkUrl: strOrNull(r, 'link_url'),
    readAt: strOrNull(r, 'read_at'),
    createdAt: str(r, 'created_at'),
  }))
}

export function createNotification(input: {
  businessId?: string | null
  userId?: string | null
  title: string
  body: string
  kind?: Notification['kind']
  linkUrl?: string | null
}): void {
  getDb()
    .prepare(
      `INSERT INTO notifications (id, business_id, user_id, title, body, kind, link_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuid(), input.businessId ?? null, input.userId ?? null,
      input.title, input.body, input.kind ?? 'info', input.linkUrl ?? null, now(),
    )
}

export function markNotificationRead(id: string, userId: string): void {
  getDb()
    .prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL)`)
    .run(now(), id, userId)
}

/* ── audit ──────────────────────────────────────────────────────────────── */

/**
 * Records a privileged action. Called for anything that changes money, access
 * or availability — price changes, suspensions, plan edits, deletions.
 */
export function recordAudit(input: {
  actorId: string | null
  actorEmail?: string | null
  action: string
  entityType: string
  entityId?: string | null
  businessId?: string | null
  before?: unknown
  after?: unknown
  metadata?: unknown
}): void {
  getDb()
    .prepare(
      `INSERT INTO audit_logs
         (id, actor_id, actor_email, action, entity_type, entity_id, business_id,
          before_value, after_value, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuid(), input.actorId, input.actorEmail ?? null, input.action, input.entityType,
      input.entityId ?? null, input.businessId ?? null,
      toJson(input.before), toJson(input.after), toJson(input.metadata), now(),
    )
}

export function listAuditLogs(opts: { limit?: number; entityType?: string } = {}): AuditLog[] {
  const where: string[] = []
  const params: SqlParam[] = []
  if (opts.entityType) {
    where.push('entity_type = ?')
    params.push(param(opts.entityType))
  }

  const rows = getDb()
    .prepare(
      `SELECT * FROM audit_logs
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, opts.limit ?? 100) as Row[]

  return rows.map((r) => ({
    id: str(r, 'id'),
    actorId: strOrNull(r, 'actor_id'),
    actorEmail: strOrNull(r, 'actor_email'),
    action: str(r, 'action'),
    entityType: str(r, 'entity_type'),
    entityId: strOrNull(r, 'entity_id'),
    businessId: strOrNull(r, 'business_id'),
    beforeValue: parseJson<unknown>(r.before_value, null),
    afterValue: parseJson<unknown>(r.after_value, null),
    metadata: parseJson<unknown>(r.metadata, null),
    createdAt: str(r, 'created_at'),
  }))
}
