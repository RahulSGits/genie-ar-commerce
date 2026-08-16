import 'server-only'

import { getDb, now, uuid, toJson, param, type Row, str, numOrNull } from '@/lib/db'
import { getSubscription, updateSubscription, listPlans } from '@/lib/db/repositories/businesses'
import { recordAudit, createNotification } from '@/lib/db/repositories/platform'
import { emitWebhook } from '@/lib/webhooks/dispatch'
import type { SubscriptionStatus } from '@/lib/billing/entitlements'
import type { ProviderSubscription } from '@/lib/payments/provider'

/**
 * Turning provider events into GENIE subscription state.
 *
 * THE RULE: the provider is the source of truth for whether money moved, and
 * webhooks are the only channel that carries that truth. A browser redirect
 * back from checkout proves the customer's browser reached a URL — nothing
 * more. It can be replayed, bookmarked, or hand-typed, so marking a
 * subscription active on redirect hands out a paid plan for free.
 *
 * Everything here is therefore driven by verified webhook events, and every
 * one is recorded by provider event id so a redelivery is a no-op.
 */

/* ── customer linkage ───────────────────────────────────────────────────── */

export function getCustomerId(businessId: string): string | null {
  const row = getDb()
    .prepare(`SELECT provider_customer_id FROM payment_customers WHERE business_id = ?`)
    .get(businessId) as Row | undefined
  return row ? str(row, 'provider_customer_id') : null
}

export function saveCustomerId(businessId: string, provider: string, customerId: string): void {
  const timestamp = now()
  getDb()
    .prepare(
      `INSERT INTO payment_customers (business_id, provider, provider_customer_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (business_id) DO UPDATE SET
         provider = excluded.provider,
         provider_customer_id = excluded.provider_customer_id,
         updated_at = excluded.updated_at`,
    )
    .run(businessId, provider, customerId, timestamp, timestamp)
}

export function businessForCustomer(customerId: string): string | null {
  const row = getDb()
    .prepare(`SELECT business_id FROM payment_customers WHERE provider_customer_id = ?`)
    .get(customerId) as Row | undefined
  return row ? str(row, 'business_id') : null
}

/* ── event de-duplication ───────────────────────────────────────────────── */

export type EventClaim = { fresh: true } | { fresh: false; status: string }

/**
 * Claims a provider event id, or reports that it has already been seen.
 *
 * The INSERT is the lock: the primary key means two concurrent deliveries of
 * the same event cannot both succeed, so exactly one of them does the work.
 * Checking-then-inserting would leave a window where both pass the check.
 */
export function claimEvent(input: {
  id: string
  provider: string
  type: string
  businessId?: string | null
  payload?: unknown
}): EventClaim {
  const db = getDb()
  try {
    db.prepare(
      `INSERT INTO payment_events (id, provider, type, business_id, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'received', ?)`,
    ).run(
      input.id,
      input.provider,
      input.type,
      param(input.businessId ?? null),
      param(toJson(input.payload ?? null)),
      now(),
    )
    return { fresh: true }
  } catch {
    const existing = db
      .prepare(`SELECT status FROM payment_events WHERE id = ?`)
      .get(input.id) as Row | undefined
    return { fresh: false, status: existing ? str(existing, 'status') : 'unknown' }
  }
}

export function finishEvent(id: string, status: 'processed' | 'ignored' | 'failed', error?: string): void {
  getDb()
    .prepare(`UPDATE payment_events SET status = ?, error = ?, processed_at = ? WHERE id = ?`)
    .run(status, param(error ?? null), now(), id)
}

/* ── status mapping ─────────────────────────────────────────────────────── */

/**
 * Stripe's subscription status vocabulary → ours.
 *
 * `unpaid` maps to `past_due` rather than `suspended` on purpose. Suspension is
 * an explicit decision by an operator at the end of the grace period, not an
 * automatic consequence of a failed charge — cutting a restaurant's live QR
 * codes mid-service because a card expired is a support disaster, and the
 * grace window exists precisely to avoid it.
 */
export function mapProviderStatus(providerStatus: string): SubscriptionStatus {
  switch (providerStatus) {
    case 'trialing':
      return 'trialing'
    case 'active':
      return 'active'
    case 'past_due':
    case 'unpaid':
      return 'past_due'
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled'
    case 'incomplete':
      // Checkout started but the first payment has not settled. Not yet
      // entitled to anything, and not yet a cancellation either.
      return 'past_due'
    case 'paused':
      return 'suspended'
    default:
      // An unrecognised status must not silently become 'active'. Treating the
      // unknown as past_due keeps the account usable during the grace window
      // while making the mismatch visible in the admin console.
      return 'past_due'
  }
}

/* ── the sync ───────────────────────────────────────────────────────────── */

export type SyncOutcome =
  | { applied: true; businessId: string; status: SubscriptionStatus }
  | { applied: false; reason: string }

/**
 * Applies a provider subscription to the local one.
 *
 * Deliberately does NOT create a subscription that does not exist: every
 * business gets one at signup, and a webhook arriving for a business with no
 * subscription row means the linkage is broken, which should be investigated
 * rather than papered over with a new row on a guessed plan.
 */
export function applyProviderSubscription(
  businessId: string,
  provider: ProviderSubscription,
  providerName = 'stripe',
): SyncOutcome {
  const local = getSubscription(businessId)
  if (!local) {
    return { applied: false, reason: `No local subscription for business ${businessId}.` }
  }

  const status = mapProviderStatus(provider.status)
  const planId = provider.priceId ? planForPrice(provider.priceId) : null

  updateSubscription(businessId, {
    status,
    currentPeriodStart: provider.currentPeriodStart,
    currentPeriodEnd: provider.currentPeriodEnd,
    ...(planId ? { planId } : {}),
    ...(status === 'cancelled' ? { cancelledAt: now() } : {}),
  })

  getDb()
    .prepare(
      `UPDATE subscriptions
          SET provider_subscription_id = ?, provider_price_id = ?, cancel_at_period_end = ?, updated_at = ?
        WHERE business_id = ?`,
    )
    .run(
      provider.providerSubscriptionId,
      param(provider.priceId),
      provider.cancelAtPeriodEnd ? 1 : 0,
      now(),
      businessId,
    )

  if (local.status !== status) {
    recordAudit({
      actorId: null,
      actorEmail: `${providerName}:webhook`,
      action: 'subscription.status_changed',
      entityType: 'subscription',
      entityId: local.id,
      businessId,
      before: { status: local.status },
      after: { status },
    })

    emitWebhook(businessId, 'subscription.updated', {
      status,
      currentPeriodEnd: provider.currentPeriodEnd,
      cancelAtPeriodEnd: provider.cancelAtPeriodEnd,
    })

    notifyStatusChange(businessId, status, provider.cancelAtPeriodEnd)
  }

  return { applied: true, businessId, status }
}

/**
 * Maps a provider price id back to a local plan.
 *
 * The mapping lives on the plan record (`provider_price_id` in its features
 * JSON is wrong; a dedicated lookup is clearer), so an operator can point a
 * plan at a different Stripe price without a deploy. Returns null when nothing
 * matches, and the caller then leaves the plan alone rather than guessing —
 * moving a customer to the wrong plan silently changes what they are entitled
 * to.
 */
function planForPrice(priceId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT id FROM subscription_plans
        WHERE json_extract(features, '$.providerPriceId') = ? AND archived = 0
        LIMIT 1`,
    )
    .get(priceId) as Row | undefined

  if (row) return str(row, 'id')

  // Fall back to a settings-level map for deployments that would rather keep
  // the association out of the plan row.
  const mapping = getDb()
    .prepare(`SELECT value FROM system_settings WHERE key = 'stripe_price_map'`)
    .get() as Row | undefined

  if (!mapping) return null
  try {
    const parsed = JSON.parse(str(mapping, 'value')) as Record<string, string>
    const planId = parsed[priceId]
    if (!planId) return null
    return listPlans({ includeArchived: true }).some((p) => p.id === planId) ? planId : null
  } catch {
    return null
  }
}

function notifyStatusChange(
  businessId: string,
  status: SubscriptionStatus,
  cancelAtPeriodEnd: boolean,
): void {
  const messages: Partial<Record<SubscriptionStatus, { title: string; body: string }>> = {
    active: {
      title: 'Subscription active',
      body: cancelAtPeriodEnd
        ? 'Your subscription is active and set to end at the close of this billing period.'
        : 'Payment received — thank you. Your subscription is active.',
    },
    past_due: {
      title: 'Payment problem',
      body:
        'We could not take payment. Your pages stay live during the grace period — please ' +
        'update your card to avoid interruption.',
    },
    cancelled: {
      title: 'Subscription cancelled',
      body: 'Your subscription has ended. Your data is retained; resubscribe any time to restore access.',
    },
    suspended: {
      title: 'Subscription paused',
      body: 'Your subscription is paused. Public pages are not being served.',
    },
  }

  const message = messages[status]
  if (!message) return

  createNotification({
    businessId,
    title: message.title,
    body: message.body,
    kind: 'billing',
    linkUrl: '/dashboard/billing',
  })
}

/** Records a settled provider invoice against the business, for the ledger. */
export function recordProviderPayment(input: {
  businessId: string
  amountMinor: number
  currency: string
  reference: string
  paidAt: string
}): void {
  getDb()
    .prepare(
      `INSERT INTO payments (id, business_id, invoice_id, amount_minor, currency, method,
                             reference, notes, paid_at, recorded_by, created_at)
       VALUES (?, ?, NULL, ?, ?, 'razorpay', ?, ?, ?, NULL, ?)`,
    )
    .run(
      uuid(),
      input.businessId,
      input.amountMinor,
      input.currency,
      input.reference,
      'Recorded automatically from a verified payment webhook.',
      input.paidAt,
      now(),
    )
}

/** Reads back what the provider linkage currently says, for the billing page. */
export function providerLinkage(businessId: string): {
  customerId: string | null
  subscriptionId: string | null
  cancelAtPeriodEnd: boolean
} {
  const row = getDb()
    .prepare(
      `SELECT provider_subscription_id, cancel_at_period_end FROM subscriptions WHERE business_id = ?`,
    )
    .get(businessId) as Row | undefined

  return {
    customerId: getCustomerId(businessId),
    subscriptionId: row ? (str(row, 'provider_subscription_id') || null) : null,
    cancelAtPeriodEnd: (numOrNull(row ?? {}, 'cancel_at_period_end') ?? 0) === 1,
  }
}
