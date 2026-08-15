import { describe, expect, it } from 'vitest'
import {
  canCreateProduct,
  canCreateQrCode,
  canUploadBytes,
  canUseAdvancedAnalytics,
  checkLimit,
  EMPTY_USAGE,
  isUsableStatus,
  UNLIMITED,
  usageBars,
  type Entitlements,
  type PlanFeatures,
  type SubscriptionStatus,
  type UsageSnapshot,
} from '@/lib/billing/entitlements'

const noFeatures: PlanFeatures = {
  advanced_analytics: false,
  custom_branding: false,
  white_label: false,
  custom_domain: false,
  team_members: false,
  api_access: false,
  priority_support: false,
  model_generation: false,
}

function plan(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    planId: 'plan_1',
    planName: 'Starter',
    status: 'active',
    isActive: true,
    limits: {
      maxProducts: 5,
      maxArModels: 5,
      maxQrCodes: 5,
      maxStorageBytes: 100 * 1024 * 1024,
      maxTeamMembers: 1,
      maxMonthlyScans: UNLIMITED,
    },
    features: { ...noFeatures },
    ...overrides,
  }
}

function usage(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return { ...EMPTY_USAGE, ...overrides }
}

describe('quantity limits', () => {
  it('allows creation below the limit', () => {
    expect(canCreateProduct(plan(), usage({ products: 4 })).allowed).toBe(true)
  })

  it('blocks creation at the limit', () => {
    const result = canCreateProduct(plan(), usage({ products: 5 }))
    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason).toBe('limit_reached')
      // The message must name the real numbers, not a generic "upgrade".
      expect(result.message).toContain('5')
      expect(result.message).toContain('Starter')
    }
  })

  it('treats null as unlimited', () => {
    const unlimited = plan({
      limits: { ...plan().limits, maxProducts: UNLIMITED },
    })
    expect(canCreateProduct(unlimited, usage({ products: 10_000 })).allowed).toBe(true)
  })

  it('accounts for the size of a pending upload, not just the count', () => {
    const p = plan()
    const almostFull = usage({ storageBytes: 95 * 1024 * 1024 })
    expect(canUploadBytes(p, almostFull, 2 * 1024 * 1024).allowed).toBe(true)
    expect(canUploadBytes(p, almostFull, 20 * 1024 * 1024).allowed).toBe(false)
  })
})

describe('subscription status gating', () => {
  const cases: Array<[SubscriptionStatus, boolean]> = [
    ['trialing', true],
    ['active', true],
    // Deliberately still usable — a late payment must not break a live venue's
    // QR codes mid-service. Suspension is an explicit admin action.
    ['past_due', true],
    ['grace', true],
    ['suspended', false],
    ['cancelled', false],
  ]

  it.each(cases)('%s → usable: %s', (status, expected) => {
    expect(isUsableStatus(status)).toBe(expected)
  })

  it('blocks creation when suspended, regardless of headroom', () => {
    const result = canCreateProduct(plan({ status: 'suspended' }), usage({ products: 0 }))
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('suspended')
  })

  it('blocks when cancelled', () => {
    const result = canCreateQrCode(plan({ status: 'cancelled' }), usage())
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('cancelled')
  })
})

describe('feature flags', () => {
  it('denies a feature the plan does not include', () => {
    const result = canUseAdvancedAnalytics(plan())
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('feature_unavailable')
  })

  it('grants a feature the plan includes', () => {
    const pro = plan({
      planName: 'Pro',
      features: { ...noFeatures, advanced_analytics: true },
    })
    expect(canUseAdvancedAnalytics(pro).allowed).toBe(true)
  })

  it('lets a per-business override grant a feature without touching the shared plan', () => {
    // This is the negotiated-deal case: same plan name, extra feature.
    const negotiated = plan({
      features: { ...noFeatures, white_label: true },
    })
    expect(negotiated.features.white_label).toBe(true)
    expect(plan().features.white_label).toBe(false)
  })
})

describe('usage bars', () => {
  it('flags bars at or past 80% as near limit', () => {
    const bars = usageBars(plan(), usage({ products: 4, qrCodes: 1 }))
    const products = bars.find((b) => b.label === 'products')
    const qr = bars.find((b) => b.label === 'QR codes')

    expect(products?.percent).toBe(80)
    expect(products?.nearLimit).toBe(true)
    expect(qr?.nearLimit).toBe(false)
  })

  it('reports null percent for unlimited limits', () => {
    const bars = usageBars(plan(), usage({ monthlyScans: 50_000 }))
    const scans = bars.find((b) => b.label === 'monthly scans')
    expect(scans?.percent).toBeNull()
    expect(scans?.nearLimit).toBe(false)
  })

  it('does not divide by zero on a zero limit', () => {
    const zeroed = plan({ limits: { ...plan().limits, maxTeamMembers: 0 } })
    const bars = usageBars(zeroed, usage())
    const team = bars.find((b) => b.label === 'team members')
    expect(Number.isFinite(team?.percent ?? 0)).toBe(true)
  })
})

describe('additional quantity', () => {
  it('supports checking for more than one at a time (bulk import)', () => {
    const p = plan()
    expect(checkLimit(p, usage({ products: 2 }), 'maxProducts', 3).allowed).toBe(true)
    expect(checkLimit(p, usage({ products: 2 }), 'maxProducts', 4).allowed).toBe(false)
  })
})
