import 'server-only'

import {
  CapabilityUnsupportedError,
  PaymentsUnavailableError,
  type PaymentProvider,
  type ProviderSubscription,
  type WebhookEvent,
} from '@/lib/payments/provider'

/**
 * PayPal Subscriptions (Billing v1).
 *
 * Written against PayPal's published REST API. NOT EXECUTED against a live or
 * sandbox account — no credentials were available — so this is complete,
 * honest integration code that has never taken a real payment.
 *
 * FOUR WAYS PAYPAL IS NOT STRIPE, all of which shape this file:
 *
 * 1. NO MERCHANT-SIDE CUSTOMER OBJECT. PayPal attaches a `subscriber` to each
 *    subscription rather than exposing a customer you can create and reuse.
 *    `ensureCustomer` therefore mints a LOCAL identifier and stores the
 *    business id in it; there is no remote object behind it. Saying otherwise
 *    would be a lie the first time someone went looking for it in the PayPal
 *    dashboard.
 *
 * 2. NO CANCEL-AT-PERIOD-END FLAG. PayPal's cancel stops future billing
 *    immediately; the period already paid for simply runs out. That is the same
 *    outcome as cancel-at-period-end, so `cancelSubscription` reports it as
 *    such — but there is no flag to read back, which is why `cancelAtPeriodEnd`
 *    comes from the local record rather than from PayPal.
 *
 * 3. WEBHOOK VERIFICATION IS A NETWORK CALL. There is no local HMAC. PayPal
 *    signs with a certificate and expects you to POST the event back to
 *    /v1/notifications/verify-webhook-signature for a verdict. That is why the
 *    seam's verifyWebhook is async, and it means webhook handling fails closed
 *    if PayPal is unreachable — which is correct: an unverifiable payment event
 *    must never be acted on.
 *
 * 4. NO INR. PayPal discontinued domestic payments within India in 2021, so an
 *    India-based merchant cannot use it to charge Indian customers in rupees.
 *    GENIE prices in INR, so PayPal is only useful for international customers
 *    billed in a supported currency — the plan must be created in PayPal in
 *    that currency, and `capabilities.currencies` says so.
 */

function base(): string {
  // Sandbox and live are different hosts entirely, so this is not a flag on a
  // request — getting it wrong means credentials that simply do not exist.
  return process.env.PAYPAL_ENVIRONMENT === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'
}

function credentials(): { clientId: string; secret: string } {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !secret) {
    throw new PaymentsUnavailableError('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set.')
  }
  return { clientId, secret }
}

/* ── OAuth ──────────────────────────────────────────────────────────────── */

let cachedToken: { value: string; expiresAt: number } | null = null

/**
 * Client-credentials token, cached until shortly before it expires.
 *
 * PayPal tokens last ~9 hours and every API call needs one. Fetching a fresh
 * token per call would triple the latency of every billing operation and would
 * rate-limit under any real load. The 60-second safety margin covers clock skew
 * and a slow request that starts just before expiry.
 */
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const { clientId, secret } = credentials()
  const response = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    throw new Error(`PayPal rejected the credentials (${response.status}).`)
  }

  const token = (await response.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    value: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  }
  return token.access_token
}

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; requestId?: string } = { method: 'GET' },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
  }
  // PayPal's idempotency header. Without it a retried create produces a second
  // subscription and the customer is charged twice.
  if (init.requestId) headers['PayPal-Request-Id'] = init.requestId

  const response = await fetch(`${base()}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  })

  // Cancel and suspend return 204 with an empty body.
  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`PayPal returned a non-JSON response (${response.status}).`)
  }

  if (!response.ok) {
    const error = payload as { message?: string; details?: { description?: string }[] }
    throw new Error(
      error.details?.[0]?.description ?? error.message ?? `PayPal request failed with ${response.status}.`,
    )
  }
  return payload as T
}

/* ── response shapes (only the fields used) ─────────────────────────────── */

type PayPalSubscription = {
  id: string
  plan_id: string
  status: string
  start_time?: string
  billing_info?: {
    next_billing_time?: string
    last_payment?: { time?: string; amount?: { value?: string; currency_code?: string } }
  }
  subscriber?: { email_address?: string }
  custom_id?: string
  links?: { href: string; rel: string; method: string }[]
}

/**
 * PayPal's status vocabulary → the seam's.
 *
 * `SUSPENDED` maps to past_due rather than suspended: PayPal suspends a
 * subscription after failed payment retries, which is a payment problem the
 * customer can fix, not an operator decision to cut them off. Mapping it to
 * suspended would bypass the grace period the billing engine exists to provide.
 */
function mapStatus(status: string): string {
  switch (status) {
    case 'APPROVAL_PENDING':
    case 'APPROVED':
      return 'incomplete'
    case 'ACTIVE':
      return 'active'
    case 'SUSPENDED':
      return 'past_due'
    case 'CANCELLED':
    case 'EXPIRED':
      return 'canceled'
    default:
      return 'past_due'
  }
}

function toSubscription(sub: PayPalSubscription): ProviderSubscription {
  const start = sub.billing_info?.last_payment?.time ?? sub.start_time ?? new Date().toISOString()
  // PayPal reports when the NEXT charge falls due, which is exactly the end of
  // the current period. On a cancelled subscription there is no next billing
  // time, so the last known start is used rather than inventing a future date.
  const end = sub.billing_info?.next_billing_time ?? start

  return {
    providerSubscriptionId: sub.id,
    providerCustomerId: sub.custom_id ?? '',
    status: mapStatus(sub.status),
    currentPeriodStart: new Date(start).toISOString(),
    currentPeriodEnd: new Date(end).toISOString(),
    cancelAtPeriodEnd: false,
    priceId: sub.plan_id,
  }
}

/* ── event mapping ──────────────────────────────────────────────────────── */

const EVENT_MAP: Record<string, string> = {
  'BILLING.SUBSCRIPTION.ACTIVATED': 'subscription.activated',
  'BILLING.SUBSCRIPTION.CREATED': 'subscription.updated',
  'BILLING.SUBSCRIPTION.UPDATED': 'subscription.updated',
  'BILLING.SUBSCRIPTION.RE-ACTIVATED': 'subscription.updated',
  'BILLING.SUBSCRIPTION.CANCELLED': 'subscription.cancelled',
  'BILLING.SUBSCRIPTION.EXPIRED': 'subscription.cancelled',
  'BILLING.SUBSCRIPTION.SUSPENDED': 'payment.failed',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': 'payment.failed',
  'PAYMENT.SALE.COMPLETED': 'payment.succeeded',
  'PAYMENT.CAPTURE.COMPLETED': 'payment.succeeded',
  'PAYMENT.SALE.DENIED': 'payment.failed',
}

export const PayPalProvider: PaymentProvider = {
  id: 'paypal',
  label: 'PayPal',

  capabilities: {
    hostedPortal: false,
    // PayPal expresses a trial as a zero-price first billing cycle on the plan
    // itself, not as a parameter at checkout, so it cannot be set per customer.
    trials: false,
    cancelAtPeriodEnd: true,
    // Deliberately excludes INR — see the note at the top of this file.
    currencies: ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED'],
  },

  isConfigured() {
    return Boolean(
      process.env.PAYPAL_CLIENT_ID &&
        process.env.PAYPAL_CLIENT_SECRET &&
        process.env.PAYPAL_WEBHOOK_ID,
    )
  },

  async ensureCustomer({ businessId }) {
    // No remote call: PayPal has no merchant-side customer object. The id is
    // local and is passed through as `custom_id` on the subscription, which is
    // what every later webhook echoes back and how an event is tied to a tenant.
    return { customerId: `paypal_local_${businessId}` }
  },

  async createCheckout({ customerId, priceId, successUrl, cancelUrl, metadata }) {
    const subscription = await call<PayPalSubscription>('/v1/billing/subscriptions', {
      method: 'POST',
      requestId: `${customerId}:${priceId}`,
      body: {
        plan_id: priceId,
        custom_id: customerId,
        application_context: {
          brand_name: 'GENIE',
          user_action: 'SUBSCRIBE_NOW',
          // Without SET_PROVIDED_ADDRESS PayPal asks for a shipping address
          // for a purely digital subscription, which loses conversions.
          shipping_preference: 'NO_SHIPPING',
          return_url: successUrl,
          cancel_url: cancelUrl,
        },
      },
    })

    const approve = subscription.links?.find((link) => link.rel === 'approve')
    if (!approve) {
      throw new Error('PayPal did not return an approval link for the subscription.')
    }

    void metadata // Carried as custom_id above; PayPal has no metadata map.
    return { id: subscription.id, url: approve.href }
  },

  async createPortal() {
    throw new CapabilityUnsupportedError(
      'PayPal has no merchant-hosted billing portal. Customers manage subscriptions from their ' +
        'own PayPal account, and GENIE renders its own billing management.',
    )
  },

  async getSubscription(subscriptionId) {
    return toSubscription(
      await call<PayPalSubscription>(`/v1/billing/subscriptions/${subscriptionId}`),
    )
  },

  async cancelSubscription(subscriptionId, atPeriodEnd) {
    await call(`/v1/billing/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      body: { reason: 'Cancelled by the customer in GENIE.' },
    })

    // PayPal's cancel is immediate for future billing, so the subscription now
    // reads CANCELLED. The customer keeps what they have already paid for,
    // which is what atPeriodEnd means here — reported from the request rather
    // than read back, because there is no flag on the object to read.
    const cancelled = await call<PayPalSubscription>(
      `/v1/billing/subscriptions/${subscriptionId}`,
    )
    return { ...toSubscription(cancelled), cancelAtPeriodEnd: atPeriodEnd }
  },

  async verifyWebhook(rawBody, headers): Promise<WebhookEvent> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID
    if (!webhookId) throw new PaymentsUnavailableError('PAYPAL_WEBHOOK_ID is not set.')

    const required = [
      'paypal-transmission-id',
      'paypal-transmission-time',
      'paypal-cert-url',
      'paypal-auth-algo',
      'paypal-transmission-sig',
    ] as const

    const supplied: Record<string, string> = {}
    for (const name of required) {
      const value = headers.get(name)
      if (!value) throw new Error(`Missing ${name} header.`)
      supplied[name] = value
    }

    const verdict = await call<{ verification_status: string }>(
      '/v1/notifications/verify-webhook-signature',
      {
        method: 'POST',
        body: {
          transmission_id: supplied['paypal-transmission-id'],
          transmission_time: supplied['paypal-transmission-time'],
          cert_url: supplied['paypal-cert-url'],
          auth_algo: supplied['paypal-auth-algo'],
          transmission_sig: supplied['paypal-transmission-sig'],
          webhook_id: webhookId,
          // PayPal requires the event as a JSON VALUE here, not as a string.
          // Re-parsing the raw body is deliberate: the signature was computed
          // over these exact bytes, and any re-serialisation on our side would
          // be verified against PayPal's copy, not ours.
          webhook_event: JSON.parse(rawBody),
        },
      },
    )

    if (verdict.verification_status !== 'SUCCESS') {
      // Fails closed. An unverifiable payment event must never be acted on,
      // even if that means dropping a legitimate one during a PayPal outage —
      // PayPal retries for three days.
      throw new Error('PayPal could not verify the webhook signature.')
    }

    const event = JSON.parse(rawBody) as { id: string; event_type: string; resource?: unknown }

    return {
      id: `pp_${event.id}`,
      type: EVENT_MAP[event.event_type] ?? 'unknown',
      rawType: event.event_type,
      data: event.resource ?? null,
    }
  },
}

export { mapStatus as __mapPayPalStatus, toSubscription as __toPayPalSubscription }
