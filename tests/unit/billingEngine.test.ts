import { describe, expect, it } from 'vitest'
import {
  addMonths,
  addYears,
  daysBetween,
  resolveSubscriptionStatus,
} from '@/lib/billing/engine'
import type { SubscriptionStatus } from '@/lib/billing/entitlements'

describe('daysBetween', () => {
  it('counts whole days, not elapsed hours', () => {
    // 23:00 to 01:00 the next day is 2 hours, but it IS the next day — an
    // invoice due yesterday is one day overdue for all of today.
    expect(daysBetween('2026-08-14T23:00:00Z', '2026-08-15T01:00:00Z')).toBe(1)
  })

  it('is zero on the due date itself, whatever the time', () => {
    expect(daysBetween('2026-08-15T00:00:00Z', '2026-08-15T23:59:59Z')).toBe(0)
  })

  it('goes negative before the due date', () => {
    expect(daysBetween('2026-08-20T00:00:00Z', '2026-08-15T00:00:00Z')).toBe(-5)
  })

  it('crosses month and year boundaries', () => {
    expect(daysBetween('2026-01-30T00:00:00Z', '2026-02-02T00:00:00Z')).toBe(3)
    expect(daysBetween('2025-12-30T00:00:00Z', '2026-01-02T00:00:00Z')).toBe(3)
  })

  it('handles a leap day', () => {
    expect(daysBetween('2028-02-28T00:00:00Z', '2028-03-01T00:00:00Z')).toBe(2)
  })

  it('returns 0 rather than NaN for unparseable input', () => {
    expect(daysBetween('not-a-date', '2026-08-15T00:00:00Z')).toBe(0)
  })
})

describe('addMonths', () => {
  it('advances a normal month', () => {
    expect(addMonths('2026-03-15T00:00:00Z', 1).slice(0, 10)).toBe('2026-04-15')
  })

  it('clamps to the last day when the next month is shorter', () => {
    // The bug this guards: naive setMonth turns 31 Jan into 3 March, silently
    // skipping February and billing a period that never existed.
    expect(addMonths('2026-01-31T00:00:00Z', 1).slice(0, 10)).toBe('2026-02-28')
    expect(addMonths('2026-03-31T00:00:00Z', 1).slice(0, 10)).toBe('2026-04-30')
    expect(addMonths('2026-05-31T00:00:00Z', 1).slice(0, 10)).toBe('2026-06-30')
  })

  it('clamps correctly into a leap February', () => {
    expect(addMonths('2028-01-31T00:00:00Z', 1).slice(0, 10)).toBe('2028-02-29')
  })

  it('rolls the year over in December', () => {
    expect(addMonths('2026-12-15T00:00:00Z', 1).slice(0, 10)).toBe('2027-01-15')
  })

  it('never produces a date in the same or an earlier month', () => {
    // Property check across every month-end, since this drives billing periods.
    for (let month = 0; month < 12; month++) {
      const start = new Date(Date.UTC(2026, month + 1, 0)).toISOString() // last day
      const next = addMonths(start, 1)
      expect(Date.parse(next)).toBeGreaterThan(Date.parse(start))
      const gap = daysBetween(start, next)
      expect(gap).toBeGreaterThanOrEqual(28)
      expect(gap).toBeLessThanOrEqual(31)
    }
  })
})

describe('addYears', () => {
  it('advances a year', () => {
    expect(addYears('2026-06-01T00:00:00Z', 1).slice(0, 10)).toBe('2027-06-01')
  })

  it('handles 29 February rolling into a non-leap year', () => {
    // JS normalises to 1 March. What matters for billing is that it moves
    // forward by roughly a year and never lands before the start.
    const next = addYears('2028-02-29T00:00:00Z', 1)
    expect(Date.parse(next)).toBeGreaterThan(Date.parse('2028-02-29T00:00:00Z'))
    expect(next.slice(0, 4)).toBe('2029')
  })
})

describe('resolveSubscriptionStatus', () => {
  const base = {
    at: '2026-08-15T12:00:00Z',
    trialEndsAt: null,
    oldestUnpaidDueDate: null,
    graceDays: 7,
    autoSuspend: false,
  }

  it('keeps a trial running until its end date', () => {
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'trialing',
        trialEndsAt: '2026-08-20T00:00:00Z',
      }),
    ).toBe('trialing')
  })

  it('activates a trial once the date passes', () => {
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'trialing',
        trialEndsAt: '2026-08-10T00:00:00Z',
      }),
    ).toBe('active')
  })

  it('does not delinquent a trial that has an unpaid invoice', () => {
    // A setup invoice raised during a trial must not push the account past_due
    // before the trial has even ended.
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'trialing',
        trialEndsAt: '2026-08-20T00:00:00Z',
        oldestUnpaidDueDate: '2026-08-01T00:00:00Z',
      }),
    ).toBe('trialing')
  })

  it('stays active while an invoice is outstanding but not yet due', () => {
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'active',
        oldestUnpaidDueDate: '2026-08-20T00:00:00Z',
      }),
    ).toBe('active')
  })

  it('goes past_due the day after the due date', () => {
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'active',
        oldestUnpaidDueDate: '2026-08-14T00:00:00Z',
      }),
    ).toBe('past_due')
  })

  it('stays past_due for the whole grace window, boundary included', () => {
    // Exactly graceDays overdue is still within grace — the customer gets the
    // full 7 days they were promised, not 6.
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'past_due',
        oldestUnpaidDueDate: '2026-08-08T00:00:00Z', // 7 days
      }),
    ).toBe('past_due')
  })

  it('enters grace one day past the window', () => {
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'past_due',
        oldestUnpaidDueDate: '2026-08-07T00:00:00Z', // 8 days
      }),
    ).toBe('grace')
  })

  it('never suspends unless autoSuspend is explicitly on', () => {
    const longOverdue = { ...base, current: 'grace' as const, oldestUnpaidDueDate: '2026-01-01T00:00:00Z' }
    expect(resolveSubscriptionStatus(longOverdue)).toBe('grace')
    expect(resolveSubscriptionStatus({ ...longOverdue, autoSuspend: true })).toBe('suspended')
  })

  it('restores a suspended account the moment its balance clears', () => {
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'suspended',
        oldestUnpaidDueDate: null,
        autoSuspend: true,
      }),
    ).toBe('active')
  })

  it('leaves a cancelled subscription alone', () => {
    expect(resolveSubscriptionStatus({ ...base, current: 'cancelled' })).toBe('cancelled')
  })

  it('is self-healing: the same answer whatever the previous state was', () => {
    // The point of recomputing from facts — a missed tick cannot strand an
    // account in a stale status.
    const facts = { ...base, oldestUnpaidDueDate: '2026-08-01T00:00:00Z', autoSuspend: false }
    const states: SubscriptionStatus[] = ['active', 'past_due', 'grace', 'suspended']
    const results = states.map((current) => resolveSubscriptionStatus({ ...facts, current }))
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe('grace')
  })

  it('is idempotent — re-running on its own output changes nothing', () => {
    const facts = { ...base, oldestUnpaidDueDate: '2026-08-14T00:00:00Z' }
    const once = resolveSubscriptionStatus({ ...facts, current: 'active' })
    const twice = resolveSubscriptionStatus({ ...facts, current: once })
    expect(twice).toBe(once)
  })

  it('treats a zero grace period as immediate escalation past the due date', () => {
    expect(
      resolveSubscriptionStatus({
        ...base,
        current: 'active',
        oldestUnpaidDueDate: '2026-08-14T00:00:00Z',
        graceDays: 0,
      }),
    ).toBe('grace')
  })
})
