import 'server-only'

import {
  getDb,
  now,
  uuid,
  parseJson,
  toJson,
  toBool,
  fromBool,
  str,
  strOrNull,
  num,
  numOrNull,
  param,
  type Row,
  type SqlParam,
} from '@/lib/db'
import type { CurrencyCode } from '@/utils/money'
import { normalizeRole } from '@/lib/auth/permissions'
import type { BusinessCategory } from '@/config/terminology'
import {
  UNLIMITED,
  type Entitlements,
  type PlanFeatures,
  type PlanLimits,
  type SubscriptionStatus,
  type UsageSnapshot,
} from '@/lib/billing/entitlements'
import type {
  Business,
  BusinessMember,
  BusinessRole,
  BusinessStatus,
  Subscription,
  SubscriptionPlan,
} from '@/types/domain'

/* ── mappers ────────────────────────────────────────────────────────────── */

function mapBusiness(row: Row): Business {
  return {
    id: str(row, 'id'),
    slug: str(row, 'slug'),
    name: str(row, 'name'),
    category: (str(row, 'category') || 'other') as BusinessCategory,
    description: strOrNull(row, 'description'),
    logoUrl: strOrNull(row, 'logo_url'),
    coverUrl: strOrNull(row, 'cover_url'),
    brandColor: strOrNull(row, 'brand_color'),
    phone: strOrNull(row, 'phone'),
    email: strOrNull(row, 'email'),
    address: strOrNull(row, 'address'),
    city: strOrNull(row, 'city'),
    websiteUrl: strOrNull(row, 'website_url'),
    instagramUrl: strOrNull(row, 'instagram_url'),
    facebookUrl: strOrNull(row, 'facebook_url'),
    whatsappNumber: strOrNull(row, 'whatsapp_number'),
    mapsUrl: strOrNull(row, 'maps_url'),
    menuUrl: strOrNull(row, 'menu_url'),
    orderingUrl: strOrNull(row, 'ordering_url'),
    reservationUrl: strOrNull(row, 'reservation_url'),
    storeUrl: strOrNull(row, 'store_url'),
    openingHours: parseJson<Record<string, string> | null>(row.opening_hours, null),
    currency: (str(row, 'currency') || 'INR') as CurrencyCode,
    timezone: str(row, 'timezone') || 'Asia/Kolkata',
    requiresApproval: toBool(row.requires_approval),
    showGenieBadge: toBool(row.show_genie_badge),
    industryTemplate: strOrNull(row, 'industry_template'),
    conversionGoal: strOrNull(row, 'conversion_goal'),
    status: (str(row, 'status') || 'active') as BusinessStatus,
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  }
}

function mapPlan(row: Row): SubscriptionPlan {
  return {
    id: str(row, 'id'),
    slug: str(row, 'slug'),
    name: str(row, 'name'),
    description: strOrNull(row, 'description'),
    priceMinor: num(row, 'price_minor'),
    currency: (str(row, 'currency') || 'INR') as CurrencyCode,
    billingInterval: (str(row, 'billing_interval') || 'monthly') as 'monthly' | 'yearly',
    setupFeeMinor: num(row, 'setup_fee_minor'),
    limits: parseJson<PlanLimits>(row.limits, DEFAULT_LIMITS),
    features: parseJson<PlanFeatures>(row.features, DEFAULT_FEATURES),
    trialDays: num(row, 'trial_days', 14),
    isPublic: toBool(row.is_public),
    sortOrder: num(row, 'sort_order'),
    archived: toBool(row.archived),
  }
}

function mapSubscription(row: Row): Subscription {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    planId: str(row, 'plan_id'),
    status: (str(row, 'status') || 'trialing') as SubscriptionStatus,
    negotiatedPriceMinor: numOrNull(row, 'negotiated_price_minor'),
    limitsOverride: parseJson<Partial<PlanLimits> | null>(row.limits_override, null),
    featuresOverride: parseJson<Partial<PlanFeatures> | null>(row.features_override, null),
    billingInterval: (str(row, 'billing_interval') || 'monthly') as 'monthly' | 'yearly',
    trialEndsAt: strOrNull(row, 'trial_ends_at'),
    currentPeriodStart: str(row, 'current_period_start'),
    currentPeriodEnd: str(row, 'current_period_end'),
    graceDays: num(row, 'grace_days', 7),
    cancelledAt: strOrNull(row, 'cancelled_at'),
    createdAt: str(row, 'created_at'),
  }
}

export const DEFAULT_LIMITS: PlanLimits = {
  maxProducts: 5,
  maxArModels: 5,
  maxQrCodes: 5,
  maxStorageBytes: 100 * 1024 * 1024,
  maxTeamMembers: 1,
  maxMonthlyScans: UNLIMITED,
}

export const DEFAULT_FEATURES: PlanFeatures = {
  advanced_analytics: false,
  custom_branding: false,
  white_label: false,
  custom_domain: false,
  team_members: false,
  api_access: false,
  priority_support: false,
  model_generation: false,
}

/* ── businesses ─────────────────────────────────────────────────────────── */

export function getBusinessById(id: string): Business | null {
  const row = getDb()
    .prepare(`SELECT * FROM businesses WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Row | undefined
  return row ? mapBusiness(row) : null
}

export function getBusinessBySlug(slug: string): Business | null {
  const row = getDb()
    .prepare(`SELECT * FROM businesses WHERE slug = ? AND deleted_at IS NULL`)
    .get(slug) as Row | undefined
  return row ? mapBusiness(row) : null
}

export type BusinessListFilters = {
  search?: string
  status?: BusinessStatus | 'all'
  planId?: string
  limit?: number
  offset?: number
}

/** Super-admin listing. Business users never call this. */
export function listBusinesses(filters: BusinessListFilters = {}): {
  rows: Array<Business & { planName: string | null; subStatus: SubscriptionStatus | null }>
  total: number
} {
  const db = getDb()
  const where: string[] = ['b.deleted_at IS NULL']
  const params: SqlParam[] = []

  if (filters.search) {
    where.push('(b.name LIKE ? OR b.email LIKE ? OR b.phone LIKE ? OR b.slug LIKE ?)')
    const q = `%${filters.search}%`
    params.push(q, q, q, q)
  }
  if (filters.status && filters.status !== 'all') {
    where.push('b.status = ?')
    params.push(param(filters.status))
  }
  if (filters.planId) {
    where.push('s.plan_id = ?')
    params.push(param(filters.planId))
  }

  const whereSql = where.join(' AND ')

  const total = num(
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM businesses b
           LEFT JOIN subscriptions s ON s.business_id = b.id
          WHERE ${whereSql}`,
      )
      .get(...params) as Row,
    'c',
  )

  const rows = db
    .prepare(
      `SELECT b.*, p.name AS plan_name, s.status AS sub_status
         FROM businesses b
         LEFT JOIN subscriptions s ON s.business_id = b.id
         LEFT JOIN subscription_plans p ON p.id = s.plan_id
        WHERE ${whereSql}
        ORDER BY b.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, filters.limit ?? 50, filters.offset ?? 0) as Row[]

  return {
    total,
    rows: rows.map((r) => ({
      ...mapBusiness(r),
      planName: strOrNull(r, 'plan_name'),
      subStatus: (strOrNull(r, 'sub_status') as SubscriptionStatus | null) ?? null,
    })),
  }
}

export type CreateBusinessInput = {
  name: string
  slug: string
  category: BusinessCategory
  email?: string | null
  phone?: string | null
  city?: string | null
  currency?: CurrencyCode
  timezone?: string
}

export function createBusiness(input: CreateBusinessInput): string {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO businesses (id, slug, name, category, email, phone, city, currency, timezone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      id,
      input.slug,
      input.name,
      input.category,
      input.email ?? null,
      input.phone ?? null,
      input.city ?? null,
      input.currency ?? 'INR',
      input.timezone ?? 'Asia/Kolkata',
      ts,
      ts,
    )
  return id
}

/**
 * Partial update. Only whitelisted columns can be written — the field list is
 * closed, so a crafted form payload cannot reach `status` or `slug` through the
 * business-facing profile action. Internal notes are not reachable at all —
 * they live in their own table.
 */
const BUSINESS_WRITABLE = [
  'name', 'category', 'description', 'logo_url', 'cover_url', 'brand_color',
  'phone', 'email', 'address', 'city', 'website_url', 'instagram_url',
  'facebook_url', 'whatsapp_number', 'maps_url', 'menu_url', 'ordering_url',
  'reservation_url', 'store_url', 'opening_hours', 'currency', 'timezone',
] as const

const BUSINESS_ADMIN_ONLY = ['status', 'slug'] as const

export function updateBusiness(
  id: string,
  patch: Record<string, unknown>,
  opts: { allowAdminFields?: boolean } = {},
): void {
  const allowed: readonly string[] = opts.allowAdminFields
    ? [...BUSINESS_WRITABLE, ...BUSINESS_ADMIN_ONLY]
    : BUSINESS_WRITABLE

  const sets: string[] = []
  const params: SqlParam[] = []

  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) continue
    sets.push(`${key} = ?`)
    params.push(param(key === 'opening_hours' ? toJson(value) : (value ?? null)))
  }
  if (sets.length === 0) return

  sets.push('updated_at = ?')
  params.push(now(), id)

  getDb().prepare(`UPDATE businesses SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function setBusinessStatus(id: string, status: BusinessStatus): void {
  getDb()
    .prepare(`UPDATE businesses SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, now(), id)
}

export function slugAvailable(slug: string, exceptId?: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM businesses WHERE slug = ? AND deleted_at IS NULL ${exceptId ? 'AND id != ?' : ''}`,
    )
    .get(...(exceptId ? [slug, exceptId] : [slug])) as Row | undefined
  return !row
}

/* ── members ────────────────────────────────────────────────────────────── */

export function addMember(businessId: string, userId: string, role: BusinessRole): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO business_members (id, business_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(uuid(), businessId, userId, role, now())
}

export function listMembers(businessId: string): BusinessMember[] {
  const rows = getDb()
    .prepare(
      `SELECT m.*, u.email, u.full_name, u.avatar_url, u.last_login_at
         FROM business_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.business_id = ?
        ORDER BY m.created_at ASC`,
    )
    .all(businessId) as Row[]

  return rows.map((r) => ({
    id: str(r, 'id'),
    businessId: str(r, 'business_id'),
    userId: str(r, 'user_id'),
    role: normalizeRole(str(r, 'role')),
    email: str(r, 'email'),
    fullName: str(r, 'full_name'),
    avatarUrl: strOrNull(r, 'avatar_url'),
    lastLoginAt: strOrNull(r, 'last_login_at'),
    createdAt: str(r, 'created_at'),
  }))
}

export function listBusinessesForUser(userId: string): Array<Business & { role: BusinessRole }> {
  const rows = getDb()
    .prepare(
      `SELECT b.*, m.role
         FROM business_members m
         JOIN businesses b ON b.id = m.business_id
        WHERE m.user_id = ? AND b.deleted_at IS NULL
        ORDER BY m.created_at ASC`,
    )
    .all(userId) as Row[]
  return rows.map((r) => ({ ...mapBusiness(r), role: (str(r, 'role') || 'member') as BusinessRole }))
}

/* ── plans ──────────────────────────────────────────────────────────────── */

export function listPlans(opts: { includeArchived?: boolean; publicOnly?: boolean } = {}): SubscriptionPlan[] {
  const where: string[] = []
  if (!opts.includeArchived) where.push('archived = 0')
  if (opts.publicOnly) where.push('is_public = 1')

  const rows = getDb()
    .prepare(
      `SELECT * FROM subscription_plans
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY sort_order ASC, price_minor ASC`,
    )
    .all() as Row[]
  return rows.map(mapPlan)
}

export function getPlan(id: string): SubscriptionPlan | null {
  const row = getDb().prepare(`SELECT * FROM subscription_plans WHERE id = ?`).get(id) as Row | undefined
  return row ? mapPlan(row) : null
}

export function upsertPlan(plan: Omit<SubscriptionPlan, 'id'> & { id?: string }): string {
  const db = getDb()
  const ts = now()
  const id = plan.id ?? uuid()

  const existing = plan.id
    ? (db.prepare(`SELECT id FROM subscription_plans WHERE id = ?`).get(plan.id) as Row | undefined)
    : undefined

  if (existing) {
    db.prepare(
      `UPDATE subscription_plans
          SET slug = ?, name = ?, description = ?, price_minor = ?, currency = ?,
              billing_interval = ?, setup_fee_minor = ?, limits = ?, features = ?,
              trial_days = ?, is_public = ?, sort_order = ?, archived = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      plan.slug, plan.name, plan.description ?? null, plan.priceMinor, plan.currency,
      plan.billingInterval, plan.setupFeeMinor, toJson(plan.limits), toJson(plan.features),
      plan.trialDays, param(fromBool(plan.isPublic)), plan.sortOrder, param(fromBool(plan.archived)), ts, id,
    )
  } else {
    db.prepare(
      `INSERT INTO subscription_plans
         (id, slug, name, description, price_minor, currency, billing_interval, setup_fee_minor,
          limits, features, trial_days, is_public, sort_order, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, plan.slug, plan.name, plan.description ?? null, plan.priceMinor, plan.currency,
      plan.billingInterval, plan.setupFeeMinor, toJson(plan.limits), toJson(plan.features),
      plan.trialDays, param(fromBool(plan.isPublic)), plan.sortOrder, param(fromBool(plan.archived)), ts, ts,
    )
  }
  return id
}

/* ── subscriptions ──────────────────────────────────────────────────────── */

export function getSubscription(businessId: string): Subscription | null {
  const row = getDb()
    .prepare(`SELECT * FROM subscriptions WHERE business_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(businessId) as Row | undefined
  return row ? mapSubscription(row) : null
}

export function createSubscription(input: {
  businessId: string
  planId: string
  status?: SubscriptionStatus
  negotiatedPriceMinor?: number | null
  billingInterval?: 'monthly' | 'yearly'
  trialDays?: number
}): string {
  const id = uuid()
  const ts = now()
  const start = new Date()
  const end = new Date(start)
  if ((input.billingInterval ?? 'monthly') === 'yearly') end.setFullYear(end.getFullYear() + 1)
  else end.setMonth(end.getMonth() + 1)

  const trialEnds =
    input.trialDays && input.trialDays > 0
      ? new Date(Date.now() + input.trialDays * 86_400_000).toISOString()
      : null

  getDb()
    .prepare(
      `INSERT INTO subscriptions
         (id, business_id, plan_id, status, negotiated_price_minor, billing_interval,
          trial_ends_at, current_period_start, current_period_end, grace_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 7, ?, ?)`,
    )
    .run(
      id,
      input.businessId,
      input.planId,
      input.status ?? (trialEnds ? 'trialing' : 'active'),
      input.negotiatedPriceMinor ?? null,
      input.billingInterval ?? 'monthly',
      trialEnds,
      start.toISOString(),
      end.toISOString(),
      ts,
      ts,
    )
  return id
}

export function updateSubscription(
  businessId: string,
  patch: {
    planId?: string
    status?: SubscriptionStatus
    negotiatedPriceMinor?: number | null
    limitsOverride?: Partial<PlanLimits> | null
    featuresOverride?: Partial<PlanFeatures> | null
    graceDays?: number
    currentPeriodStart?: string
    currentPeriodEnd?: string
    cancelledAt?: string | null
  },
): void {
  const sets: string[] = []
  const params: SqlParam[] = []

  if (patch.planId !== undefined) { sets.push('plan_id = ?'); params.push(patch.planId) }
  if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status) }
  if (patch.negotiatedPriceMinor !== undefined) {
    sets.push('negotiated_price_minor = ?'); params.push(param(patch.negotiatedPriceMinor))
  }
  if (patch.limitsOverride !== undefined) {
    sets.push('limits_override = ?'); params.push(param(toJson(patch.limitsOverride)))
  }
  if (patch.featuresOverride !== undefined) {
    sets.push('features_override = ?'); params.push(param(toJson(patch.featuresOverride)))
  }
  if (patch.graceDays !== undefined) { sets.push('grace_days = ?'); params.push(patch.graceDays) }
  if (patch.currentPeriodStart !== undefined) {
    sets.push('current_period_start = ?'); params.push(param(patch.currentPeriodStart))
  }
  if (patch.currentPeriodEnd !== undefined) {
    sets.push('current_period_end = ?'); params.push(param(patch.currentPeriodEnd))
  }
  if (patch.cancelledAt !== undefined) {
    sets.push('cancelled_at = ?'); params.push(param(patch.cancelledAt))
  }
  if (sets.length === 0) return

  sets.push('updated_at = ?')
  params.push(now(), businessId)

  getDb().prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE business_id = ?`).run(...params)
}

/* ── entitlements ───────────────────────────────────────────────────────── */

/**
 * Resolves what a business may actually do right now.
 *
 * Plan limits are the base; the subscription's overrides are merged on top.
 * That merge is the whole reason a negotiated deal never requires editing the
 * shared plan — and why no call site ever needs to know a plan's name.
 */
export function getEntitlements(businessId: string): Entitlements {
  const sub = getSubscription(businessId)
  const plan = sub ? getPlan(sub.planId) : null

  if (!sub || !plan) {
    // No subscription yet (mid-onboarding): everything is denied rather than
    // silently unlimited.
    return {
      planId: '',
      planName: 'No plan',
      limits: { ...DEFAULT_LIMITS, maxProducts: 0, maxArModels: 0, maxQrCodes: 0 },
      features: { ...DEFAULT_FEATURES },
      status: 'cancelled',
      isActive: false,
    }
  }

  const business = getBusinessById(businessId)
  // An admin suspension outranks whatever the subscription says.
  const status: SubscriptionStatus =
    business?.status === 'suspended' ? 'suspended' : sub.status

  return {
    planId: plan.id,
    planName: plan.name,
    limits: { ...plan.limits, ...(sub.limitsOverride ?? {}) },
    features: { ...plan.features, ...(sub.featuresOverride ?? {}) },
    status,
    isActive: status === 'active' || status === 'trialing',
  }
}

/** Current consumption, counted live so it can never drift from reality. */
export function getUsage(businessId: string): UsageSnapshot {
  const db = getDb()
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  const monthKey = monthStart.toISOString().slice(0, 10)

  const one = (sql: string, ...params: SqlParam[]) =>
    num(db.prepare(sql).get(...params) as Row, 'c')

  return {
    products: one(
      `SELECT COUNT(*) AS c FROM products WHERE business_id = ? AND deleted_at IS NULL`,
      businessId,
    ),
    arModels: one(
      `SELECT COUNT(*) AS c FROM three_d_models WHERE business_id = ? AND deleted_at IS NULL`,
      businessId,
    ),
    qrCodes: one(
      `SELECT COUNT(*) AS c FROM qr_codes WHERE business_id = ? AND deleted_at IS NULL`,
      businessId,
    ),
    // Storage is charged for EVERYTHING a business uploads. Counting only 3D
    // models would let image uploads consume disk against no quota at all.
    storageBytes: num(
      db
        .prepare(
          `SELECT
             COALESCE((SELECT SUM(file_size_bytes) FROM three_d_models
                        WHERE business_id = ? AND deleted_at IS NULL), 0)
           + COALESCE((SELECT SUM(bytes) FROM product_images
                        WHERE business_id = ?), 0) AS c`,
        )
        .get(businessId, businessId) as Row,
      'c',
    ),
    teamMembers: one(`SELECT COUNT(*) AS c FROM business_members WHERE business_id = ?`, businessId),
    monthlyScans: one(
      `SELECT COUNT(*) AS c FROM analytics_events
        WHERE business_id = ? AND event_type = 'qr_scanned' AND day >= ?`,
      businessId,
      monthKey,
    ),
  }
}


/* ── internal notes ─────────────────────────────────────────────────────── */

/**
 * Admin-only notes about a client.
 *
 * A separate table rather than a column on `businesses`, because the public
 * product page must be able to read a business row and row-level security
 * cannot hide a single column. Callers of both functions must already have
 * passed requireSuperAdmin().
 */
export function getInternalNotes(businessId: string): string {
  const row = getDb()
    .prepare(`SELECT notes FROM business_internal_notes WHERE business_id = ?`)
    .get(businessId) as Row | undefined
  return row ? str(row, 'notes') : ''
}

export function setInternalNotes(businessId: string, notes: string, actorId: string): void {
  getDb()
    .prepare(
      `INSERT INTO business_internal_notes (business_id, notes, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(business_id) DO UPDATE SET
         notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(businessId, notes.slice(0, 4000), now(), actorId)
}
