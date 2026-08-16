import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PaymentProvider, ProviderSubscription, WebhookEvent } from '@/lib/payments/provider'
import { PaymentsUnavailableError } from '@/lib/payments/provider'

/**
 * Stripe, over plain HTTPS.
 *
 * Written against Stripe's published REST API (2024+ shapes). NOT EXECUTED
 * against the live API — no account was available — so this is honest,
 * complete integration code that has never handled a real card. Treat the
 * first run in Stripe test mode as the real test; see docs/deployment.md.
 *
 * Everything is server-side. The secret key must never appear in a client
 * bundle, which is why this module is `server-only` and why the checkout flow
 * hands the browser a Stripe-hosted URL rather than doing anything with the key
 * in the page.
 */

const API = 'https://api.stripe.com/v1'

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new PaymentsUnavailableError('STRIPE_SECRET_KEY is not set.')
  return key
}

/**
 * Stripe takes form-encoded bodies with bracket notation for nested values —
 * `metadata[businessId]=abc`, `items[0][price]=price_123`. Nothing about that
 * is JSON, and sending JSON gets a 400 that reads like an auth failure.
 */
function encode(params: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = []

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const name = prefix ? `${prefix}[${key}]` : key

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object' && item !== null) {
          parts.push(...encode(item as Record<string, unknown>, `${name}[${index}]`))
        } else {
          parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`)
        }
      })
    } else if (typeof value === 'object') {
      parts.push(...encode(value as Record<string, unknown>, name))
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts
}

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: Record<string, unknown>; idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  // Stripe retries and network timeouts both produce duplicate requests. An
  // idempotency key is what stops a flaky connection from creating two
  // subscriptions for one click.
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey

  const response = await fetch(`${API}${path}`, {
    method: init.method,
    headers,
    body: init.body ? encode(init.body).join('&') : undefined,
  })

  const text = await response.text()
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`Stripe returned a non-JSON response (${response.status}).`)
  }

  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } })?.error?.message ??
      `Stripe request failed with ${response.status}.`
    throw new Error(message)
  }
  return payload as T
}

/* ── response shapes (only the fields actually used) ────────────────────── */

type StripeSubscription = {
  id: string
  customer: string
  status: string
  current_period_start: number
  current_period_end: number
  cancel_at_period_end: boolean
  items?: { data?: { price?: { id?: string } }[] }
}

function toSubscription(s: StripeSubscription): ProviderSubscription {
  return {
    providerSubscriptionId: s.id,
    providerCustomerId: s.customer,
    status: s.status,
    // Stripe sends Unix seconds; the rest of the codebase stores ISO strings.
    currentPeriodStart: new Date(s.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: s.cancel_at_period_end,
    priceId: s.items?.data?.[0]?.price?.id ?? null,
  }
}

/* ── the provider ───────────────────────────────────────────────────────── */

const EVENT_MAP: Record<string, string> = {
  'checkout.session.completed': 'subscription.activated',
  'customer.subscription.created': 'subscription.updated',
  'customer.subscription.updated': 'subscription.updated',
  'customer.subscription.deleted': 'subscription.cancelled',
  'invoice.paid': 'payment.succeeded',
  'invoice.payment_succeeded': 'payment.succeeded',
  'invoice.payment_failed': 'payment.failed',
}

export const StripeProvider: PaymentProvider = {
  id: 'stripe',
  label: 'Stripe',

  capabilities: {
    hostedPortal: true,
    trials: true,
    cancelAtPeriodEnd: true,
    // Stripe supports far more than this; these are the ones GENIE prices in
    // and has plan configuration for.
    currencies: ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'],
  },

  isConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET)
  },

  async ensureCustomer({ businessId, email, name, existingCustomerId }) {
    if (existingCustomerId) {
      try {
        const existing = await call<{ id: string; deleted?: boolean }>(
          `/customers/${existingCustomerId}`,
          { method: 'GET' },
        )
        // A customer deleted in the Stripe dashboard still resolves, with
        // deleted: true. Reusing it would fail at checkout with a confusing
        // error, so a fresh one is created instead.
        if (!existing.deleted) return { customerId: existing.id }
      } catch {
        // Fall through and create a new one rather than blocking the upgrade.
      }
    }

    const created = await call<{ id: string }>('/customers', {
      method: 'POST',
      body: { email, name, metadata: { businessId } },
      idempotencyKey: `customer:${businessId}`,
    })
    return { customerId: created.id }
  },

  async createCheckout({ customerId, priceId, successUrl, cancelUrl, trialDays, metadata }) {
    const session = await call<{ id: string; url: string | null }>('/checkout/sessions', {
      method: 'POST',
      body: {
        mode: 'subscription',
        customer: customerId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [{ price: priceId, quantity: 1 }],
        // Metadata is set on BOTH the session and the subscription. The
        // checkout.session.completed event carries the session's; every later
        // subscription.* event carries only the subscription's, and without it
        // there is no way to attribute a renewal to a tenant.
        metadata,
        subscription_data: trialDays ? { trial_period_days: trialDays, metadata } : { metadata },
        allow_promotion_codes: true,
      },
    })

    if (!session.url) throw new Error('Stripe did not return a checkout URL.')
    return { id: session.id, url: session.url }
  },

  async createPortal({ customerId, returnUrl }) {
    const session = await call<{ url: string }>('/billing_portal/sessions', {
      method: 'POST',
      body: { customer: customerId, return_url: returnUrl },
    })
    return { url: session.url }
  },

  async getSubscription(subscriptionId) {
    return toSubscription(
      await call<StripeSubscription>(`/subscriptions/${subscriptionId}`, { method: 'GET' }),
    )
  },

  async cancelSubscription(subscriptionId, atPeriodEnd) {
    // Cancelling at period end is an UPDATE, not a DELETE — DELETE ends the
    // subscription immediately and the customer loses access they have paid
    // for, which is a refund conversation nobody wanted.
    const updated = atPeriodEnd
      ? await call<StripeSubscription>(`/subscriptions/${subscriptionId}`, {
          method: 'POST',
          body: { cancel_at_period_end: true },
        })
      : await call<StripeSubscription>(`/subscriptions/${subscriptionId}`, {
          method: 'POST',
          body: { cancel_at_period_end: false, cancel_at: 'now' },
        })
    return toSubscription(updated)
  },

  async verifyWebhook(rawBody, headers): Promise<WebhookEvent> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new PaymentsUnavailableError('STRIPE_WEBHOOK_SECRET is not set.')

    const signature = headers.get('stripe-signature')
    if (!signature) throw new Error('Missing Stripe-Signature header.')

    const parts = Object.fromEntries(
      signature.split(',').map((piece) => {
        const [k, v] = piece.split('=')
        return [k?.trim() ?? '', v?.trim() ?? '']
      }),
    )

    const timestamp = Number(parts['t'])
    const provided = parts['v1']
    if (!Number.isFinite(timestamp) || !provided) {
      throw new Error('Malformed Stripe-Signature header.')
    }

    // Without a freshness window a captured webhook stays replayable forever,
    // and replaying invoice.paid is a free subscription.
    if (Math.abs(Date.now() / 1000 - timestamp) > 300) {
      throw new Error('Webhook timestamp is outside the tolerance window.')
    }

    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(provided, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Webhook signature does not match.')
    }

    const event = JSON.parse(rawBody) as { id: string; type: string; data: { object: unknown } }
    return {
      id: event.id,
      type: EVENT_MAP[event.type] ?? 'unknown',
      rawType: event.type,
      data: event.data.object,
    }
  },
}

/** Exported for the webhook handler's tests. */
export { toSubscription as __toSubscription }
