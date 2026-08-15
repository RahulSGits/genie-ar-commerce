import { describe, expect, it } from 'vitest'
import {
  formatLimitValue,
  usageBars,
  UNLIMITED,
  type Entitlements,
  type PlanFeatures,
  type UsageSnapshot,
} from '@/lib/billing/entitlements'
import { EMPTY_USAGE } from '@/lib/billing/entitlements'

/**
 * Regression tests for three calculation bugs found by audit:
 *
 *  1. a plan limit of 0 reported as 0% consumed instead of fully consumed
 *  2. storage limits rendered to users as raw byte integers
 *  3. (covered in the admin action) invalid limit input collapsing to UNLIMITED
 */

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

function plan(limits: Partial<Entitlements['limits']> = {}): Entitlements {
  return {
    planId: 'p',
    planName: 'Starter',
    status: 'active',
    isActive: true,
    features: { ...noFeatures },
    limits: {
      maxProducts: 5,
      maxArModels: 5,
      maxQrCodes: 5,
      maxStorageBytes: 100 * 1024 * 1024,
      maxTeamMembers: 1,
      maxMonthlyScans: UNLIMITED,
      ...limits,
    },
  }
}

const usage = (o: Partial<UsageSnapshot> = {}): UsageSnapshot => ({ ...EMPTY_USAGE, ...o })

describe('usageBars with a zero limit', () => {
  it('reports a zero limit as fully consumed, not empty', () => {
    // A plan that permits no team members has no headroom. Showing 0% told the
    // user they had room they did not have.
    const bars = usageBars(plan({ maxTeamMembers: 0 }), usage({ teamMembers: 0 }))
    const team = bars.find((b) => b.label === 'team members')
    expect(team?.percent).toBe(100)
    expect(team?.nearLimit).toBe(true)
  })

  it('still reports 100% when usage somehow exceeds a zero limit', () => {
    const bars = usageBars(plan({ maxTeamMembers: 0 }), usage({ teamMembers: 3 }))
    expect(bars.find((b) => b.label === 'team members')?.percent).toBe(100)
  })

  it('leaves normal limits unchanged', () => {
    const bars = usageBars(plan(), usage({ products: 4 }))
    expect(bars.find((b) => b.label === 'products')?.percent).toBe(80)
  })

  it('caps at 100 when over a normal limit', () => {
    const bars = usageBars(plan(), usage({ products: 50 }))
    expect(bars.find((b) => b.label === 'products')?.percent).toBe(100)
  })

  it('reports null for unlimited and never flags it as near limit', () => {
    const bars = usageBars(plan(), usage({ monthlyScans: 9_999_999 }))
    const scans = bars.find((b) => b.label === 'monthly scans')
    expect(scans?.percent).toBeNull()
    expect(scans?.nearLimit).toBe(false)
  })

  it('never produces NaN or Infinity for any combination', () => {
    const combos: Array<[number | null, number]> = [
      [0, 0], [0, 5], [1, 0], [5, 5], [5, 500], [UNLIMITED, 0], [UNLIMITED, 1_000_000],
    ]
    for (const [limit, current] of combos) {
      const bars = usageBars(plan({ maxProducts: limit }), usage({ products: current }))
      const p = bars.find((b) => b.label === 'products')?.percent
      if (p !== null && p !== undefined) {
        expect(Number.isFinite(p)).toBe(true)
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('formatLimitValue', () => {
  it('renders byte limits in human units', () => {
    expect(formatLimitValue('maxStorageBytes', 100 * 1024 * 1024)).toBe('100 MB')
    expect(formatLimitValue('maxStorageBytes', 2 * 1024 * 1024 * 1024)).toBe('2 GB')
    expect(formatLimitValue('maxStorageBytes', 1536 * 1024 * 1024)).toBe('1.5 GB')
    expect(formatLimitValue('maxStorageBytes', 0)).toBe('0 MB')
  })

  it('leaves count limits as plain numbers', () => {
    expect(formatLimitValue('maxProducts', 20)).toBe('20')
    expect(formatLimitValue('maxQrCodes', 0)).toBe('0')
  })
})
