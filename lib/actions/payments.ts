'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePermission } from '@/lib/auth/guards'
import { guarded, badRequest, type ActionResult } from '@/lib/auth/errors'
import {
  getPaymentProvider,
  paymentsAvailable,
  CapabilityUnsupportedError,
  PaymentsUnavailableError,
} from '@/lib/payments/provider'
import {
  getCustomerId,
  saveCustomerId,
  providerLinkage,
  applyProviderSubscription,
} from '@/lib/payments/sync'
import { getBusinessById, getSubscription, getPlan } from '@/lib/db/repositories/businesses'
import { getFeatureFlags } from '@/lib/db/repositories/platform'
import { recordAudit } from '@/lib/db/repositories/platform'
import { checkRateLimit } from '@/lib/api/rateLimit'
import { getDb, type Row, str } from '@/lib/db'

/**
 * Customer-facing billing actions.
 *
 * Everything here hands the browser off to a provider-hosted page. GENIE never
 * sees a card number, which keeps the whole application out of PCI scope — the
 * moment a card field is rendered in our own UI, that stops being true.
 *
 * Note what is NOT here: nothing that marks a subscription paid. Entitlement
 * changes only in app/api/webhooks/payments, after a verified signature. See
 * the comment at the top of that file.
 */

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

export async function billingOverviewAction() {
  const ctx = await requirePermission('billing:read')

  const flags = getFeatureFlags()
  const provider = getPaymentProvider()
  const availability = paymentsAvailable(flags.payments)
  const subscription = getSubscription(ctx.businessId)
  const plan = subscription ? getPlan(subscription.planId) : null

  return {
    provider: { id: provider.id, label: provider.label, capabilities: provider.capabilities },
    available: availability.available,
    unavailableReason: availability.available ? null : availability.reason,
    linkage: providerLinkage(ctx.businessId),
    subscription,
    plan,
    canManage: ctx.role === 'owner',
  }
}

/**
 * Starts hosted checkout and redirects.
 *
 * The plan's provider price id is configuration, not something the client
 * sends — accepting a price id from the browser would let anyone subscribe at
 * any price the provider has ever had, including a £0 test price.
 */
export async function startCheckoutAction(planId: string): Promise<ActionResult<never>> {
  const ctx = await requirePermission('billing:manage')

  const flags = getFeatureFlags()
  const availability = paymentsAvailable(flags.payments)
  if (!availability.available) badRequest(availability.reason)

  // Checkout creates a provider-side object on every call. Without a limit a
  // stuck retry loop in a browser tab could create hundreds of abandoned
  // subscriptions on the account.
  const limit = checkRateLimit('publicWrite', `checkout:${ctx.businessId}`)
  if (!limit.allowed) {
    badRequest(`Too many checkout attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`)
  }

  const business = getBusinessById(ctx.businessId)
  if (!business) badRequest('This workspace no longer exists.')

  const plan = getPlan(planId)
  if (!plan) badRequest('That plan no longer exists.')

  const priceId = providerPriceId(planId)
  if (!priceId) {
    badRequest(
      `${plan?.name ?? 'That plan'} has no price configured for ${getPaymentProvider().label}. ` +
        'A super admin needs to link it in /admin/pricing before it can be purchased.',
    )
  }

  const provider = getPaymentProvider()
  let url: string

  try {
    const { customerId } = await provider.ensureCustomer({
      businessId: ctx.businessId,
      email: business?.email ?? ctx.user.email,
      name: business?.name ?? ctx.user.email,
      phone: business?.phone ?? null,
      existingCustomerId: getCustomerId(ctx.businessId),
    })
    saveCustomerId(ctx.businessId, provider.id, customerId)

    const session = await provider.createCheckout({
      customerId,
      priceId: priceId as string,
      successUrl: `${appUrl()}/dashboard/billing?checkout=complete`,
      cancelUrl: `${appUrl()}/dashboard/billing?checkout=cancelled`,
      // Only send a trial the provider can actually express; otherwise the
      // local trial continues to govern and the provider bills immediately.
      trialDays: provider.capabilities.trials ? (plan?.trialDays ?? 0) || undefined : undefined,
      metadata: { businessId: ctx.businessId, planId },
    })
    url = session.url
  } catch (err) {
    if (err instanceof PaymentsUnavailableError) badRequest(err.message)
    badRequest(
      err instanceof Error
        ? `${provider.label} could not start checkout: ${err.message}`
        : 'Checkout could not be started.',
    )
  }

  recordAudit({
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
    action: 'billing.checkout_started',
    entityType: 'subscription',
    businessId: ctx.businessId,
    metadata: { planId, provider: provider.id },
  })

  // redirect() throws a Next sentinel, so nothing after it runs.
  redirect(url!)
}

export async function openBillingPortalAction(): Promise<ActionResult<never>> {
  const ctx = await requirePermission('billing:manage')
  const provider = getPaymentProvider()

  if (!provider.capabilities.hostedPortal) {
    badRequest(
      `${provider.label} has no hosted billing portal. Manage your subscription from this page instead.`,
    )
  }

  const customerId = getCustomerId(ctx.businessId)
  if (!customerId) badRequest('This workspace has no billing account yet.')

  let url: string
  try {
    const session = await provider.createPortal({
      customerId: customerId as string,
      returnUrl: `${appUrl()}/dashboard/billing`,
    })
    url = session.url
  } catch (err) {
    if (err instanceof CapabilityUnsupportedError) badRequest(err.message)
    badRequest('The billing portal could not be opened.')
  }

  redirect(url!)
}

export async function cancelSubscriptionAction(
  atPeriodEnd = true,
): Promise<ActionResult<{ status: string }>> {
  return guarded(async () => {
    const ctx = await requirePermission('billing:manage')

    const linkage = providerLinkage(ctx.businessId)
    if (!linkage.subscriptionId) {
      badRequest(
        'This workspace has no provider subscription to cancel. If you are on a manually ' +
          'invoiced plan, contact support instead.',
      )
    }

    const provider = getPaymentProvider()
    const remote = await provider.cancelSubscription(
      linkage.subscriptionId as string,
      atPeriodEnd && provider.capabilities.cancelAtPeriodEnd,
    )

    // Applied immediately rather than waiting for the webhook: the customer
    // just clicked cancel and needs to see it took effect. The webhook will
    // arrive shortly and apply the same state, which is idempotent.
    const result = applyProviderSubscription(ctx.businessId, remote, provider.id)

    recordAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'billing.cancelled',
      entityType: 'subscription',
      businessId: ctx.businessId,
      metadata: { atPeriodEnd, provider: provider.id },
    })

    revalidatePath('/dashboard/billing')
    return { status: result.applied ? result.status : 'unknown' }
  })
}

/**
 * Reconciles local state against the provider, on demand.
 *
 * Exists because webhooks can be missed — a deploy during delivery, an endpoint
 * misconfigured for a day — and when they are, the customer's entitlement is
 * wrong and nothing self-corrects. This is the "I paid but it still says
 * unpaid" button, and it reads from the provider rather than trusting anything
 * local.
 */
export async function syncSubscriptionAction(): Promise<ActionResult<{ status: string }>> {
  return guarded(async () => {
    const ctx = await requirePermission('billing:read')

    const linkage = providerLinkage(ctx.businessId)
    if (!linkage.subscriptionId) badRequest('There is no provider subscription to sync.')

    const provider = getPaymentProvider()
    const remote = await provider.getSubscription(linkage.subscriptionId as string)
    const result = applyProviderSubscription(ctx.businessId, remote, provider.id)

    revalidatePath('/dashboard/billing')
    if (!result.applied) badRequest(result.reason)
    return { status: result.status }
  })
}

/**
 * The provider price id for a plan.
 *
 * Stored in system_settings rather than on the plan row so the same plan can be
 * pointed at a different price without a schema change when a provider is
 * switched or a price is superseded.
 */
function providerPriceId(planId: string): string | null {
  const provider = getPaymentProvider()
  const row = getDb()
    .prepare(`SELECT value FROM system_settings WHERE key = ?`)
    .get(`price_map_${provider.id}`) as Row | undefined

  if (!row) return null
  try {
    const map = JSON.parse(str(row, 'value')) as Record<string, string>
    return map[planId] ?? null
  } catch {
    return null
  }
}
