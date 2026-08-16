import { NextResponse, type NextRequest } from 'next/server'
import { getPaymentProvider, PaymentsUnavailableError } from '@/lib/payments/provider'
import {
  applyProviderSubscription,
  businessForCustomer,
  claimEvent,
  finishEvent,
  recordProviderPayment,
} from '@/lib/payments/sync'
import { getDb, type Row, str } from '@/lib/db'

/**
 * The single payment webhook endpoint, for Stripe, Razorpay and PayPal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY PLACE MONEY CHANGES SUBSCRIPTION STATE.
 *
 * The browser's redirect back from checkout proves that a browser reached a
 * URL. Nothing more. It can be replayed, bookmarked, shared or hand-typed, so
 * marking a subscription active on redirect hands out a paid plan for free.
 * The success page therefore only says "we're confirming your payment"; the
 * entitlement changes here, after a signature has been verified.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Node runtime, not edge: signature verification needs node:crypto, and PayPal's
 * verification is an outbound API call.
 */

export const runtime = 'nodejs'
// A webhook must never be served from a cache, and must never be prerendered.
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const provider = getPaymentProvider()

  // Read the body as TEXT before anything else. Every provider signs the exact
  // bytes, so request.json() here would make verification impossible — and the
  // body can only be consumed once.
  const rawBody = await request.text()

  let event
  try {
    event = await provider.verifyWebhook(rawBody, request.headers)
  } catch (err) {
    if (err instanceof PaymentsUnavailableError) {
      // Nothing is configured, so this is either a misdirected request or an
      // attacker. 404 rather than 503: an unconfigured endpoint should not
      // confirm that it exists.
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // 400 tells the provider not to retry a request that will never verify.
    console.warn('[payments] signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const claim = claimEvent({
    id: event.id,
    provider: provider.id,
    type: event.rawType,
    payload: event.data,
  })

  // Already handled. Providers guarantee at-least-once delivery, so duplicates
  // are routine rather than exceptional — 200 stops the retry loop.
  if (!claim.fresh) {
    return NextResponse.json({ received: true, duplicate: true, status: claim.status })
  }

  try {
    const outcome = await handle(provider.id, event.type, event.data)
    finishEvent(event.id, outcome.handled ? 'processed' : 'ignored', outcome.reason)
    return NextResponse.json({ received: true, handled: outcome.handled })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unhandled error'
    finishEvent(event.id, 'failed', message)
    console.error('[payments] handler failed', event.rawType, message)

    // 500 asks the provider to retry. The event row stays 'failed' and the
    // primary key means the retry will not double-apply anything already done.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

type Outcome = { handled: boolean; reason?: string }

async function handle(providerId: string, type: string, data: unknown): Promise<Outcome> {
  if (type === 'unknown') {
    // Deliberately not an error. Providers send many events we never subscribed
    // to conceptually, and guessing at an unrecognised payment event is how
    // money goes missing.
    return { handled: false, reason: 'Event type is not one GENIE acts on.' }
  }

  const businessId = resolveBusiness(data)
  if (!businessId) {
    return { handled: false, reason: 'Could not attribute the event to a business.' }
  }

  const provider = getPaymentProvider()

  switch (type) {
    case 'subscription.activated':
    case 'subscription.updated':
    case 'subscription.cancelled': {
      const subscriptionId = subscriptionIdFrom(data)
      if (!subscriptionId) return { handled: false, reason: 'No subscription id on the event.' }

      // Re-read from the provider rather than trusting the event payload. Events
      // can arrive out of order — an `updated` from before a `cancelled` would
      // otherwise resurrect a cancelled subscription — and the API always
      // returns current truth.
      const remote = await provider.getSubscription(subscriptionId)
      const result = applyProviderSubscription(businessId, remote, providerId)
      return result.applied
        ? { handled: true }
        : { handled: false, reason: result.reason }
    }

    case 'payment.succeeded': {
      const payment = paymentFrom(data)
      if (!payment) return { handled: false, reason: 'No amount on the event.' }

      recordProviderPayment({
        businessId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        reference: payment.reference,
        paidAt: payment.paidAt,
      })
      return { handled: true }
    }

    case 'payment.failed': {
      const subscriptionId = subscriptionIdFrom(data)
      if (subscriptionId) {
        const remote = await provider.getSubscription(subscriptionId)
        applyProviderSubscription(businessId, remote, providerId)
      }
      return { handled: true }
    }

    default:
      return { handled: false, reason: `No handler for ${type}.` }
  }
}

/* ── attribution ────────────────────────────────────────────────────────── */

type Payload = Record<string, unknown>

/**
 * Finds which tenant an event belongs to.
 *
 * Three providers express this three ways, so each is tried in turn:
 *   Stripe    metadata.businessId, or the customer id we stored at checkout
 *   Razorpay  notes.businessId
 *   PayPal    custom_id, which we set to our own local customer id
 *
 * Falling back to the subscription row means a renewal still attributes even if
 * the metadata was lost — which happens when a subscription is edited in a
 * provider dashboard rather than through GENIE.
 */
function resolveBusiness(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const payload = data as Payload

  const metadata = (payload['metadata'] ?? payload['notes']) as Payload | undefined
  const fromMetadata = metadata?.['businessId']
  if (typeof fromMetadata === 'string' && fromMetadata) return fromMetadata

  const customId = payload['custom_id']
  if (typeof customId === 'string' && customId) {
    const local = customId.replace(/^paypal_local_/, '')
    if (local !== customId) return local
    const mapped = businessForCustomer(customId)
    if (mapped) return mapped
  }

  const customer = payload['customer'] ?? payload['customer_id']
  if (typeof customer === 'string' && customer) {
    const mapped = businessForCustomer(customer)
    if (mapped) return mapped
  }

  const subscriptionId = subscriptionIdFrom(data)
  if (subscriptionId) {
    const row = getDb()
      .prepare(`SELECT business_id FROM subscriptions WHERE provider_subscription_id = ?`)
      .get(subscriptionId) as Row | undefined
    if (row) return str(row, 'business_id')
  }

  return null
}

function subscriptionIdFrom(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const payload = data as Payload

  // Stripe checkout.session carries the new subscription under `subscription`;
  // a subscription object carries its own id under `id`.
  for (const key of ['subscription', 'subscription_id', 'id']) {
    const value = payload[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}

function paymentFrom(
  data: unknown,
): { amountMinor: number; currency: string; reference: string; paidAt: string } | null {
  if (typeof data !== 'object' || data === null) return null
  const payload = data as Payload

  // Stripe invoice: amount_paid in minor units. Razorpay payment: amount, also
  // minor units. PayPal sale: amount.value as a DECIMAL STRING in major units,
  // which is why it is converted rather than read directly — treating "12.00"
  // as 12 paise would under-record every PayPal payment by a factor of 100.
  const stripeOrRazorpay = payload['amount_paid'] ?? payload['amount']
  if (typeof stripeOrRazorpay === 'number') {
    return {
      amountMinor: stripeOrRazorpay,
      currency: String(payload['currency'] ?? 'INR').toUpperCase(),
      reference: String(payload['id'] ?? 'unknown'),
      paidAt: new Date().toISOString(),
    }
  }

  const amount = payload['amount'] as Payload | undefined
  const value = amount?.['value']
  if (typeof value === 'string') {
    const major = Number(value)
    if (!Number.isFinite(major)) return null
    return {
      amountMinor: Math.round(major * 100),
      currency: String(amount?.['currency_code'] ?? 'USD').toUpperCase(),
      reference: String(payload['id'] ?? 'unknown'),
      paidAt: String(payload['create_time'] ?? new Date().toISOString()),
    }
  }

  return null
}
