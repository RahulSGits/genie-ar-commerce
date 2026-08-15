/**
 * The single entitlement layer.
 *
 * RULE: nothing anywhere in this codebase may branch on a plan's name.
 * `if (plan.slug === 'starter')` is a bug — it hardcodes commercial policy into
 * application code, so the super admin can no longer change what a plan
 * includes without a deploy, and a custom negotiated plan silently behaves like
 * whatever branch it happens to miss.
 *
 * Instead every limit is data on the plan record, optionally overridden
 * per-business, and every gate goes through `checkEntitlement`.
 */

/** Sentinel for "no ceiling". Stored as NULL in the database. */
export const UNLIMITED = null
export type Limit = number | typeof UNLIMITED

export type FeatureKey =
  | 'advanced_analytics'
  | 'custom_branding'
  | 'white_label'
  | 'custom_domain'
  | 'team_members'
  | 'api_access'
  | 'priority_support'
  | 'model_generation'

export type PlanLimits = {
  maxProducts: Limit
  maxArModels: Limit
  maxQrCodes: Limit
  /** Total 3D/image storage across the business. */
  maxStorageBytes: Limit
  maxTeamMembers: Limit
  /** Public AR page loads per calendar month. Null = uncapped. */
  maxMonthlyScans: Limit
}

export type PlanFeatures = Record<FeatureKey, boolean>

/**
 * What a business is currently entitled to. Assembled by merging the plan's
 * limits with any per-business override, so a negotiated deal never requires
 * editing the shared plan.
 */
export type Entitlements = {
  planId: string
  planName: string
  limits: PlanLimits
  features: PlanFeatures
  /** Subscription state gates access independently of the plan's contents. */
  status: SubscriptionStatus
  /** True while the account may use the product at all. */
  isActive: boolean
}

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'grace',
  'suspended',
  'cancelled',
] as const

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/**
 * Which states may still use the product.
 *
 * `past_due` and `grace` deliberately remain usable: cutting a paying
 * restaurant's live QR codes the morning a payment is late means their
 * customers hit a dead page mid-service. Suspension is a deliberate admin
 * decision at the end of the grace period, not an automatic side effect of a
 * missed webhook.
 */
const USABLE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  'trialing',
  'active',
  'past_due',
  'grace',
])

export function isUsableStatus(status: SubscriptionStatus): boolean {
  return USABLE_STATUSES.has(status)
}

/* ── current usage ──────────────────────────────────────────────────────── */

export type UsageSnapshot = {
  products: number
  arModels: number
  qrCodes: number
  storageBytes: number
  teamMembers: number
  monthlyScans: number
}

export const EMPTY_USAGE: UsageSnapshot = {
  products: 0,
  arModels: 0,
  qrCodes: 0,
  storageBytes: 0,
  teamMembers: 0,
  monthlyScans: 0,
}

/* ── the check ──────────────────────────────────────────────────────────── */

export type EntitlementResult =
  | { allowed: true }
  | {
      allowed: false
      /** Machine-readable so the UI can route to the right upgrade prompt. */
      reason: 'suspended' | 'cancelled' | 'limit_reached' | 'feature_unavailable'
      /** Shown to the business user verbatim. */
      message: string
      limit?: number
      current?: number
    }

type LimitKey = keyof PlanLimits
type UsageKey = keyof UsageSnapshot

const LIMIT_TO_USAGE: Record<LimitKey, UsageKey> = {
  maxProducts: 'products',
  maxArModels: 'arModels',
  maxQrCodes: 'qrCodes',
  maxStorageBytes: 'storageBytes',
  maxTeamMembers: 'teamMembers',
  maxMonthlyScans: 'monthlyScans',
}

const LIMIT_NOUNS: Record<LimitKey, string> = {
  maxProducts: 'products',
  maxArModels: 'AR models',
  maxQrCodes: 'QR codes',
  maxStorageBytes: 'storage',
  maxTeamMembers: 'team members',
  maxMonthlyScans: 'monthly scans',
}

function statusGate(e: Entitlements): EntitlementResult | null {
  if (e.status === 'suspended') {
    return {
      allowed: false,
      reason: 'suspended',
      message:
        'This account is suspended pending payment. Existing QR codes still work — contact support to restore full access.',
    }
  }
  if (e.status === 'cancelled') {
    return {
      allowed: false,
      reason: 'cancelled',
      message: 'This subscription has been cancelled. Reactivate a plan to continue.',
    }
  }
  return null
}

/** Generic quantity gate. Every specific helper below funnels through here. */
export function checkLimit(
  entitlements: Entitlements,
  usage: UsageSnapshot,
  key: LimitKey,
  additional = 1,
): EntitlementResult {
  const blocked = statusGate(entitlements)
  if (blocked) return blocked

  const limit = entitlements.limits[key]
  if (limit === UNLIMITED) return { allowed: true }

  const current = usage[LIMIT_TO_USAGE[key]]
  if (current + additional <= limit) return { allowed: true }

  const noun = LIMIT_NOUNS[key]
  return {
    allowed: false,
    reason: 'limit_reached',
    message: `Your ${entitlements.planName} plan includes ${limit} ${noun} and you're using ${current}. Upgrade to add more.`,
    limit,
    current,
  }
}

export function checkFeature(
  entitlements: Entitlements,
  feature: FeatureKey,
): EntitlementResult {
  const blocked = statusGate(entitlements)
  if (blocked) return blocked

  if (entitlements.features[feature]) return { allowed: true }

  return {
    allowed: false,
    reason: 'feature_unavailable',
    message: `This feature isn't included in your ${entitlements.planName} plan.`,
  }
}

/* ── named helpers ──────────────────────────────────────────────────────── */
/* Thin wrappers so call sites read as intent rather than as limit plumbing. */

export const canCreateProduct = (e: Entitlements, u: UsageSnapshot) =>
  checkLimit(e, u, 'maxProducts')

export const canCreateArModel = (e: Entitlements, u: UsageSnapshot) =>
  checkLimit(e, u, 'maxArModels')

export const canCreateQrCode = (e: Entitlements, u: UsageSnapshot) =>
  checkLimit(e, u, 'maxQrCodes')

export const canInviteTeamMember = (e: Entitlements, u: UsageSnapshot) =>
  checkLimit(e, u, 'maxTeamMembers')

export const canUploadBytes = (e: Entitlements, u: UsageSnapshot, bytes: number) =>
  checkLimit(e, u, 'maxStorageBytes', bytes)

export const canUseAdvancedAnalytics = (e: Entitlements) =>
  checkFeature(e, 'advanced_analytics')

export const canUseCustomBranding = (e: Entitlements) => checkFeature(e, 'custom_branding')
export const canUseWhiteLabel = (e: Entitlements) => checkFeature(e, 'white_label')
export const canUseCustomDomain = (e: Entitlements) => checkFeature(e, 'custom_domain')

/* ── display helpers ────────────────────────────────────────────────────── */

export type UsageBar = {
  label: string
  current: number
  limit: Limit
  /** 0–100, or null when the limit is unlimited. */
  percent: number | null
  /** True past 80% — the dashboard highlights these before they bite. */
  nearLimit: boolean
}

export function usageBars(e: Entitlements, u: UsageSnapshot): UsageBar[] {
  return (Object.keys(LIMIT_TO_USAGE) as LimitKey[]).map((key) => {
    const limit = e.limits[key]
    const current = u[LIMIT_TO_USAGE[key]]
    const percent = limit === UNLIMITED ? null : Math.min(100, (current / Math.max(limit, 1)) * 100)
    return {
      label: LIMIT_NOUNS[key],
      current,
      limit,
      percent,
      nearLimit: percent !== null && percent >= 80,
    }
  })
}

export function formatLimit(limit: Limit): string {
  return limit === UNLIMITED ? 'Unlimited' : String(limit)
}
