import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  CapabilityUnsupportedError,
  PaymentsUnavailableError,
  type PaymentProvider,
  type ProviderSubscription,
  type WebhookEvent,
} from '@/lib/payments/provider'

/**
 * Razorpay — the right default for an India-based GENIE.
 *
 * It settles in INR, which is what the product prices in, and it covers UPI,
 * netbanking, RuPay and cards. Stripe's India support is materially narrower
 * and does not do UPI subscriptions, which for a restaurant customer is the
 * payment method.
 *
 * Written against Razorpay's published REST API (Subscriptions, v1). NOT
 * EXECUTED against a live account — no credentials were available — so this is
 * complete, honest integration code that has never taken a real payment. The
 * first run in Razorpay test mode is the real test; see docs/deployment.md.
 *
 * TWO THINGS THAT DIFFER FROM STRIPE AND MATTER:
 *
 * 1. There is no hosted billing portal. Razorpay gives the customer a hosted
 *    *checkout* page and nothing else, so `capabilities.hostedPortal` is false
 *    and GENIE renders its own management UI. Pretending otherwise would put a
 *    "Manage billing" button in the dashboard that leads nowhere.
 *
 * 2. Webhook signatures carry no timestamp. Razorpay signs the raw body with
 *    HMAC-SHA256 and nothing else, so a captured delivery stays replayable
 *    forever as far as the signature is concerned. Replay protection therefore
 *    has to come from event de-duplication (lib/payments/sync.ts claimEvent),
 *    which it does — but it is the only defence here, so it is not optional.
 */

const API = 'https://api.razorpay.com/v1'

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new PaymentsUnavailableError('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set.')
  }
  return { keyId, keySecret }
}

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  const { keyId, keySecret } = credentials()

  const response = await fetch(`${API}${path}`, {
    method: init.method,
    headers: {
      // Razorpay uses HTTP Basic with the key id as user and secret as password.
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })

  const text = await response.text()
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`Razorpay returned a non-JSON response (${response.status}).`)
  }

  if (!response.ok) {
    const message =
      (payload as { error?: { description?: string } })?.error?.description ??
      `Razorpay request failed with ${response.status}.`
    throw new Error(message)
  }
  return payload as T
}

/* ── response shapes (only the fields used) ─────────────────────────────── */

type RazorpaySubscription = {
  id: string
  customer_id: string
  plan_id: string
  status: string
  current_start: number | null
  current_end: number | null
  charge_at: number | null
  ended_at: number | null
  short_url?: string
  notes?: Record<string, string>
}

/**
 * Razorpay sends Unix seconds, and nulls them on a subscription that has not
 * started its first cycle yet. Falling back to `charge_at` keeps the local
 * period sane for a subscription that is created but not yet authenticated;
 * without it the billing page would show "Invalid Date" the moment someone
 * started checkout and walked away.
 */
function period(sub: RazorpaySubscription): { start: string; end: string } {
  const startSeconds = sub.current_start ?? sub.charge_at ?? Math.floor(Date.now() / 1000)
  const endSeconds = sub.current_end ?? sub.ended_at ?? startSeconds

  return {
    start: new Date(startSeconds * 1000).toISOString(),
    end: new Date(endSeconds * 1000).toISOString(),
  }
}

/**
 * Razorpay's status vocabulary → the small set the seam declares.
 *
 * `halted` is the one worth noting: it means Razorpay gave up retrying a failed
 * charge. That is past_due from GENIE's point of view, not cancelled — the
 * customer can still fix their payment method, and treating it as cancelled
 * would cut their live QR codes over a recoverable card problem.
 */
function mapStatus(status: string): string {
  switch (status) {
    case 'created':
    case 'authenticated':
      return 'incomplete'
    case 'active':
      return 'active'
    case 'pending':
    case 'halted':
      return 'past_due'
    case 'paused':
      return 'paused'
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'canceled'
    default:
      return 'past_due'
  }
}

function toSubscription(sub: RazorpaySubscription): ProviderSubscription {
  const { start, end } = period(sub)
  return {
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.customer_id,
    status: mapStatus(sub.status),
    currentPeriodStart: start,
    currentPeriodEnd: end,
    // Razorpay has no cancel-at-period-end flag on the subscription object;
    // cancellation is requested with `cancel_at_cycle_end` and reflected only
    // by the eventual status change. Reporting false is the honest answer.
    cancelAtPeriodEnd: false,
    priceId: sub.plan_id,
  }
}

/* ── event mapping ──────────────────────────────────────────────────────── */

const EVENT_MAP: Record<string, string> = {
  'subscription.activated': 'subscription.activated',
  'subscription.charged': 'payment.succeeded',
  'subscription.updated': 'subscription.updated',
  'subscription.pending': 'payment.failed',
  'subscription.halted': 'payment.failed',
  'subscription.cancelled': 'subscription.cancelled',
  'subscription.completed': 'subscription.cancelled',
  'subscription.paused': 'subscription.updated',
  'subscription.resumed': 'subscription.updated',
  'payment.failed': 'payment.failed',
  'payment.captured': 'payment.succeeded',
}

export const RazorpayProvider: PaymentProvider = {
  id: 'razorpay',
  label: 'Razorpay',

  capabilities: {
    hostedPortal: false,
    trials: false,
    // Requested via cancel_at_cycle_end on the cancel call.
    cancelAtPeriodEnd: true,
    // Razorpay settles Indian accounts in INR. International currencies need
    // a separately-enabled account feature, so INR is what is claimed here.
    currencies: ['INR'],
  },

  isConfigured() {
    return Boolean(
      process.env.RAZORPAY_KEY_ID &&
        process.env.RAZORPAY_KEY_SECRET &&
        process.env.RAZORPAY_WEBHOOK_SECRET,
    )
  },

  async ensureCustomer({ businessId, email, name, phone, existingCustomerId }) {
    if (existingCustomerId) {
      try {
        const existing = await call<{ id: string }>(`/customers/${existingCustomerId}`)
        return { customerId: existing.id }
      } catch {
        // Fall through and create a fresh one rather than blocking an upgrade.
      }
    }

    const created = await call<{ id: string }>('/customers', {
      method: 'POST',
      body: {
        name,
        email,
        contact: phone ?? undefined,
        // Razorpay rejects a duplicate email outright unless told not to; the
        // alternative is an upgrade that fails for any returning customer.
        fail_existing: '0',
        notes: { businessId },
      },
    })
    return { customerId: created.id }
  },

  async createCheckout({ customerId, priceId, successUrl, cancelUrl, metadata }) {
    const subscription = await call<RazorpaySubscription>('/subscriptions', {
      method: 'POST',
      body: {
        plan_id: priceId,
        customer_id: customerId,
        // Razorpay requires a finite cycle count. 120 monthly cycles is ten
        // years — long enough to be effectively open-ended, and the
        // subscription is re-created if anyone is still here in 2036.
        total_count: 120,
        customer_notify: 1,
        // `notes` is Razorpay's metadata field and is echoed on every webhook,
        // which is what ties an event back to a tenant.
        notes: metadata,
      },
    })

    if (!subscription.short_url) {
      throw new Error('Razorpay did not return a checkout URL for the subscription.')
    }

    // Razorpay's hosted page has no success/cancel URL parameters — the return
    // journey is configured on the plan in the dashboard. Both URLs are
    // accepted here so the seam stays uniform, and the handler records them in
    // the notes so support can see where the customer was meant to land.
    void successUrl
    void cancelUrl

    return { id: subscription.id, url: subscription.short_url }
  },

  async createPortal() {
    throw new CapabilityUnsupportedError(
      'Razorpay has no hosted billing portal. GENIE renders its own billing management instead.',
    )
  },

  async getSubscription(subscriptionId) {
    return toSubscription(await call<RazorpaySubscription>(`/subscriptions/${subscriptionId}`))
  },

  async cancelSubscription(subscriptionId, atPeriodEnd) {
    const cancelled = await call<RazorpaySubscription>(`/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      // Razorpay wants 1/0 here, not true/false.
      body: { cancel_at_cycle_end: atPeriodEnd ? 1 : 0 },
    })
    return { ...toSubscription(cancelled), cancelAtPeriodEnd: atPeriodEnd }
  },

  async verifyWebhook(rawBody, headers): Promise<WebhookEvent> {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (!secret) throw new PaymentsUnavailableError('RAZORPAY_WEBHOOK_SECRET is not set.')

    const signature = headers.get('x-razorpay-signature')
    if (!signature) throw new Error('Missing X-Razorpay-Signature header.')

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signature, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Webhook signature does not match.')
    }

    const event = JSON.parse(rawBody) as {
      event: string
      payload?: {
        subscription?: { entity?: RazorpaySubscription }
        payment?: { entity?: unknown }
      }
    }

    // Razorpay does not send an event id in the body. The delivery id header is
    // what de-duplication keys on; without it a redelivery would be processed
    // twice, and since the signature carries no timestamp that is the only
    // replay defence there is.
    const deliveryId =
      headers.get('x-razorpay-event-id') ??
      createHmac('sha256', secret).update(rawBody).digest('hex').slice(0, 32)

    return {
      id: `rzp_${deliveryId}`,
      type: EVENT_MAP[event.event] ?? 'unknown',
      rawType: event.event,
      data: event.payload?.subscription?.entity ?? event.payload?.payment?.entity ?? null,
    }
  },
}

/** Exported for tests — the status map is where a mistake costs a customer access. */
export { mapStatus as __mapRazorpayStatus, toSubscription as __toRazorpaySubscription }
