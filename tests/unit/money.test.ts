import { describe, expect, it } from 'vitest'
import {
  addMoney,
  applyDiscount,
  formatMoney,
  majorToMinor,
  minorToMajor,
  money,
  multiplyMoney,
  percentOf,
  subtractMoney,
  sumMoney,
} from '@/utils/money'

describe('money construction', () => {
  it('rejects non-integer minor units', () => {
    // The whole point of the module: a float amount is a bug, caught loudly.
    expect(() => money(19.99)).toThrow(/integer/i)
  })

  it('converts major to minor units without float drift', () => {
    expect(majorToMinor(19.99)).toBe(1999)
    expect(majorToMinor(1999)).toBe(199900)
    expect(majorToMinor(0.1)).toBe(10)
    // 0.1 + 0.2 in float is 0.30000000000000004; via minor units it is exact.
    expect(majorToMinor(0.1) + majorToMinor(0.2)).toBe(majorToMinor(0.3))
  })

  it('round-trips through minorToMajor', () => {
    expect(minorToMajor(199900)).toBe(1999)
    expect(minorToMajor(1999)).toBe(19.99)
  })
})

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(addMoney(money(100), money(250)).amount).toBe(350)
    expect(subtractMoney(money(500), money(199)).amount).toBe(301)
  })

  it('refuses to mix currencies', () => {
    expect(() => addMoney(money(100, 'INR'), money(100, 'USD'))).toThrow(/cannot combine/i)
  })

  it('sums an empty list to zero rather than throwing', () => {
    expect(sumMoney([]).amount).toBe(0)
  })

  it('multiplies by integer quantity only', () => {
    expect(multiplyMoney(money(1999), 3).amount).toBe(5997)
    expect(() => multiplyMoney(money(1999), 1.5)).toThrow(/integer/i)
  })
})

describe('percentages', () => {
  it('computes GST-style tax exactly', () => {
    // ₹1,999.00 at 18% = ₹359.82
    expect(percentOf(money(199900), 18).amount).toBe(35982)
  })

  it('rounds half away from zero', () => {
    // 1 minor unit at 50% is 0.5 → 1, not 0.
    expect(percentOf(money(1), 50).amount).toBe(1)
  })

  it('keeps invoice parts summing to the whole', () => {
    const lines = [money(99900), money(49900), money(150000)]
    const subtotal = sumMoney(lines)
    const tax = percentOf(subtotal, 18)
    const total = addMoney(subtotal, tax)

    expect(subtotal.amount).toBe(299800)
    expect(tax.amount).toBe(53964)
    expect(total.amount).toBe(353764)
    // Rounding once on the subtotal, not per line, is what makes this hold.
    expect(subtractMoney(total, tax).amount).toBe(subtotal.amount)
  })
})

describe('discounts', () => {
  it('applies a percentage discount', () => {
    const { net, discountAmount } = applyDiscount(money(199900), {
      type: 'percentage',
      value: 30,
    })
    expect(discountAmount.amount).toBe(59970)
    expect(net.amount).toBe(139930)
  })

  it('applies a flat discount', () => {
    const { net } = applyDiscount(money(199900), { type: 'fixed', value: 50000 })
    expect(net.amount).toBe(149900)
  })

  it('never lets a discount push a total negative', () => {
    // A ₹5,000 coupon on a ₹999 invoice zeroes it — it does not owe the customer money.
    const { net, discountAmount } = applyDiscount(money(99900), {
      type: 'fixed',
      value: 500000,
    })
    expect(net.amount).toBe(0)
    expect(discountAmount.amount).toBe(99900)
  })

  it('caps a 100%+ percentage discount at the gross', () => {
    const { net } = applyDiscount(money(99900), { type: 'percentage', value: 150 })
    expect(net.amount).toBe(0)
  })
})

describe('formatting', () => {
  it('formats INR without decimals when whole', () => {
    expect(formatMoney(money(199900))).toContain('1,999')
    expect(formatMoney(money(199900))).not.toContain('.00')
  })

  it('shows decimals when there are paise', () => {
    expect(formatMoney(money(199950))).toContain('1,999.50')
  })
})

describe('discount clamping (regression)', () => {
  it('ignores a negative percentage rather than inflating the total', () => {
    // A negative discount previously flowed straight through and INCREASED the
    // net — a "-20% discount" billed 20% more.
    const { net, discountAmount } = applyDiscount(money(100000), {
      type: 'percentage',
      value: -20,
    })
    expect(discountAmount.amount).toBe(0)
    expect(net.amount).toBe(100000)
  })

  it('ignores a negative fixed amount', () => {
    const { net, discountAmount } = applyDiscount(money(100000), {
      type: 'fixed',
      value: -50000,
    })
    expect(discountAmount.amount).toBe(0)
    expect(net.amount).toBe(100000)
  })

  it('never returns a net greater than the gross, for any input', () => {
    const values = [-1_000_000, -1, 0, 1, 50, 100, 150, 1_000_000]
    for (const value of values) {
      for (const type of ['percentage', 'fixed'] as const) {
        const { net, discountAmount } = applyDiscount(money(99900), { type, value })
        expect(net.amount).toBeLessThanOrEqual(99900)
        expect(net.amount).toBeGreaterThanOrEqual(0)
        expect(discountAmount.amount).toBeGreaterThanOrEqual(0)
        // The two must always reconcile back to the gross.
        expect(net.amount + discountAmount.amount).toBe(99900)
      }
    }
  })
})
