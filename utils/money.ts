/**
 * Money handling.
 *
 * Every monetary amount in this system is an INTEGER number of minor units
 * (paise for INR, cents for USD). Floats are never used for money — `0.1 + 0.2`
 * is not `0.3`, and a rounding drift of one paise per invoice line compounds
 * into billing disputes. The database stores BIGINT; TypeScript sees `number`,
 * which is exact for integers up to 2^53 (≈ ₹90 trillion — comfortably enough).
 *
 * The currency CODE always travels with the amount. An amount without its
 * currency is meaningless and must never be stored or passed alone.
 */

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD'

export type Money = {
  /** Integer minor units. ₹1,999.00 → 199900 */
  amount: number
  currency: CurrencyCode
}

type CurrencyMeta = {
  symbol: string
  /** Minor units per major unit — 100 for INR/USD, 1 for zero-decimal currencies. */
  minorPerMajor: number
  locale: string
}

const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  INR: { symbol: '₹', minorPerMajor: 100, locale: 'en-IN' },
  USD: { symbol: '$', minorPerMajor: 100, locale: 'en-US' },
  EUR: { symbol: '€', minorPerMajor: 100, locale: 'en-IE' },
  GBP: { symbol: '£', minorPerMajor: 100, locale: 'en-GB' },
  AED: { symbol: 'د.إ', minorPerMajor: 100, locale: 'ar-AE' },
  SGD: { symbol: 'S$', minorPerMajor: 100, locale: 'en-SG' },
}

export const DEFAULT_CURRENCY: CurrencyCode = 'INR'

export function money(amount: number, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  if (!Number.isInteger(amount)) {
    throw new Error(
      `Money must be an integer number of minor units, received ${amount}. ` +
        `Use majorToMinor() to convert a decimal like 19.99.`,
    )
  }
  return { amount, currency }
}

/** 1999.5 → 199950 minor units. Rounds half away from zero. */
export function majorToMinor(major: number, currency: CurrencyCode = DEFAULT_CURRENCY): number {
  const { minorPerMajor } = currencyMeta(currency)
  const scaled = major * minorPerMajor
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)
}

/** 199950 → 1999.5. For display and form inputs only — never for arithmetic. */
export function minorToMajor(minor: number, currency: CurrencyCode = DEFAULT_CURRENCY): number {
  return minor / currencyMeta(currency).minorPerMajor
}

/** "₹1,999.00" — locale-aware. */
export function formatMoney(
  value: Money,
  opts: { showDecimals?: boolean } = {},
): string {
  const meta = currencyMeta(value.currency)
  const showDecimals = opts.showDecimals ?? value.amount % meta.minorPerMajor !== 0

  return new Intl.NumberFormat(meta.locale, {
    style: 'currency',
    currency: value.currency,
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(minorToMajor(value.amount, value.currency))
}

/* ── arithmetic ─────────────────────────────────────────────────────────── */

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot combine ${a.currency} with ${b.currency}.`)
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { amount: a.amount + b.amount, currency: a.currency }
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { amount: a.amount - b.amount, currency: a.currency }
}

export function sumMoney(values: Money[], currency: CurrencyCode = DEFAULT_CURRENCY): Money {
  if (values.length === 0) return { amount: 0, currency }
  return values.reduce(addMoney)
}

export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new Error(`Quantity must be an integer, received ${quantity}.`)
  }
  return { amount: value.amount * quantity, currency: value.currency }
}

/**
 * Applies a percentage, rounding half away from zero at the minor unit.
 * `percent` is a plain number: 18 means 18%, 2.5 means 2.5%.
 *
 * Rounding once here — rather than accumulating fractional paise across lines —
 * is what keeps an invoice's parts summing exactly to its total.
 */
export function percentOf(value: Money, percent: number): Money {
  const raw = (value.amount * percent) / 100
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw)
  return { amount: rounded, currency: value.currency }
}

/** Never returns a negative amount — a discount can zero a total, not invert it. */
export function applyDiscount(
  gross: Money,
  discount: { type: 'percentage' | 'fixed'; value: number },
): { net: Money; discountAmount: Money } {
  const discountAmount =
    discount.type === 'percentage'
      ? percentOf(gross, discount.value)
      : { amount: Math.min(discount.value, gross.amount), currency: gross.currency }

  const capped: Money = {
    amount: Math.min(discountAmount.amount, gross.amount),
    currency: gross.currency,
  }

  return { net: subtractMoney(gross, capped), discountAmount: capped }
}

export function isZero(value: Money): boolean {
  return value.amount === 0
}

export function isPositive(value: Money): boolean {
  return value.amount > 0
}

function currencyMeta(code: CurrencyCode): CurrencyMeta {
  const meta = CURRENCIES[code]
  if (!meta) throw new Error(`Unsupported currency: ${code}`)
  return meta
}

export function currencySymbol(code: CurrencyCode): string {
  return currencyMeta(code).symbol
}

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES) as CurrencyCode[]
