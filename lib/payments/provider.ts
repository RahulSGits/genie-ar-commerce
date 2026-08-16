import 'server-only'

/**
 * Payments: the provider seam.
 *
 * Same rule as AI generation (lib/ai3d/provider.ts): with nothing configured,
 * `getPaymentProvider()` returns a provider whose every method throws. There is
 * no path that reports a subscription as paid when no money moved.
 *
 * That matters more here than anywhere else in the codebase. A fake generation
 * wastes someone's afternoon; a fake payment state means a customer is served
 * without being billed, or billed without being served, and neither is
 * discovered until it is a support conversation about money.
 *
 * THREE PROVIDERS, ONE INTERFACE:
 *   stripe   — international cards. Hosted checkout and a hosted billing portal.
 *   razorpay — India: UPI, netbanking, RuPay, cards. Settles in INR, which is
 *              what GENIE prices in. No hosted portal exists.
 *   paypal   — international wallet coverage. No hosted portal for merchants;
 *              webhook verification is an API round-trip, not a local HMAC.
 *
 * WHY NO VENDOR SDKS: between them the three SDKs are ~30 MB and none of them
 * is needed — every call used here is a plain HTTPS request. On a serverless
 * deployment that weight is paid on every cold start.
 *
 * The interface is shaped around what all three can actually do. Where one
 * cannot do something the others can, it is declared in `capabilities` and the
 * UI adapts, rather than a method quietly returning something useless.
 */

import { StripeProvider } from '@/lib/payments/providers/stripe'
import { RazorpayProvider } from '@/lib/payments/providers/razorpay'
import { PayPalProvider } from '@/lib/payments/providers/paypal'

export type ProviderId = 'none' | 'stripe' | 'razorpay' | 'paypal'

export type ProviderCapabilities = {
  /**
   * The provider hosts a page where the customer manages their own card and
   * invoices. Only Stripe does. For the others GENIE has to render its own
   * management UI, so this flag is what stops the dashboard offering a
   * "Manage billing" button that leads nowhere.
   */
  hostedPortal: boolean
  /** Free trials can be expressed to the provider rather than tracked locally. */
  trials: boolean
  /** The provider can cancel at period end rather than immediately. */
  cancelAtPeriodEnd: boolean
  /** Currencies the provider will accept for a subscription, ISO-4217. */
  currencies: string[]
}

export type CheckoutSession = {
  id: string
  /** Where to send the browser. Never construct this URL yourself. */
  url: string
}

export type PortalSession = { url: string }

export type ProviderSubscription = {
  providerSubscriptionId: string
  providerCustomerId: string
  /** The provider's own status word, already mapped by the adapter. */
  status: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  priceId: string | null
}

export type WebhookEvent = {
  id: string
  /** Normalised across providers — see NORMALISED_EVENTS. */
  type: string
  /** The provider's own event name, kept for the audit trail. */
  rawType: string
  data: unknown
}

/**
 * One vocabulary for three providers.
 *
 * Each adapter maps its own event names onto these, so the webhook handler has
 * a single switch instead of three. Anything unrecognised maps to null and is
 * recorded as `ignored` rather than being guessed at — acting on a
 * misidentified payment event is how money goes missing.
 */
export const NORMALISED_EVENTS = [
  'subscription.activated',
  'subscription.updated',
  'subscription.cancelled',
  'payment.succeeded',
  'payment.failed',
] as const

export type NormalisedEvent = (typeof NORMALISED_EVENTS)[number]

export type PaymentProvider = {
  id: ProviderId
  label: string
  capabilities: ProviderCapabilities
  isConfigured(): boolean

  /** Creates (or reuses) the provider-side customer for a business. */
  ensureCustomer(input: {
    businessId: string
    email: string
    name: string
    phone?: string | null
    existingCustomerId?: string | null
  }): Promise<{ customerId: string }>

  /** Hosted checkout for a new subscription. Returns a URL to redirect to. */
  createCheckout(input: {
    customerId: string
    /** The provider-side plan/price identifier. */
    priceId: string
    successUrl: string
    cancelUrl: string
    trialDays?: number
    /** Echoed back on the webhook so the event can be tied to a tenant. */
    metadata: Record<string, string>
  }): Promise<CheckoutSession>

  /**
   * Hosted billing portal. Throws when `capabilities.hostedPortal` is false —
   * callers must check first rather than catch.
   */
  createPortal(input: { customerId: string; returnUrl: string }): Promise<PortalSession>

  getSubscription(subscriptionId: string): Promise<ProviderSubscription>

  cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<ProviderSubscription>

  /**
   * Verifies a webhook and returns the parsed event.
   *
   * Takes the RAW body, because every provider signs the exact bytes — anything
   * that has been through JSON.parse and re-serialised fails to verify, usually
   * after someone has "helpfully" tidied the handler.
   *
   * Async because PayPal verifies by calling its own API rather than by
   * checking a local HMAC; Stripe and Razorpay resolve immediately.
   */
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent>
}

export class PaymentsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentsUnavailableError'
  }
}

export class CapabilityUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityUnsupportedError'
  }
}

const UNAVAILABLE =
  'No payment provider is configured. Set PAYMENT_PROVIDER to stripe, razorpay or paypal ' +
  'along with that provider’s credentials, then enable the `payments` feature flag in ' +
  '/admin/settings.'

const NullProvider: PaymentProvider = {
  id: 'none',
  label: 'Not configured',
  capabilities: {
    hostedPortal: false,
    trials: false,
    cancelAtPeriodEnd: false,
    currencies: [],
  },
  isConfigured: () => false,
  ensureCustomer: () => {
    throw new PaymentsUnavailableError(UNAVAILABLE)
  },
  createCheckout: () => {
    throw new PaymentsUnavailableError(UNAVAILABLE)
  },
  createPortal: () => {
    throw new PaymentsUnavailableError(UNAVAILABLE)
  },
  getSubscription: () => {
    throw new PaymentsUnavailableError(UNAVAILABLE)
  },
  cancelSubscription: () => {
    throw new PaymentsUnavailableError(UNAVAILABLE)
  },
  verifyWebhook: () => {
    throw new PaymentsUnavailableError(UNAVAILABLE)
  },
}

export const PAYMENT_PROVIDERS: Record<ProviderId, PaymentProvider> = {
  none: NullProvider,
  stripe: StripeProvider,
  razorpay: RazorpayProvider,
  paypal: PayPalProvider,
}

/**
 * The provider this deployment uses.
 *
 * Deliberately a single choice rather than a per-business one. Supporting
 * several simultaneously means reconciling three sources of subscription truth
 * against one local table, and the failure mode — two providers both believing
 * they own a customer's subscription — is a billing incident. A deployment
 * serving India uses Razorpay; one serving the US uses Stripe.
 */
export function getPaymentProvider(): PaymentProvider {
  const requested = (process.env.PAYMENT_PROVIDER ?? 'none') as ProviderId
  const provider = PAYMENT_PROVIDERS[requested]
  if (!provider || !provider.isConfigured()) return NullProvider
  return provider
}

/** Every provider that could be selected, for the admin settings screen. */
export function providerStatuses(): Array<{
  id: ProviderId
  label: string
  configured: boolean
  capabilities: ProviderCapabilities
}> {
  return (Object.keys(PAYMENT_PROVIDERS) as ProviderId[])
    .filter((id) => id !== 'none')
    .map((id) => {
      const provider = PAYMENT_PROVIDERS[id]
      return {
        id,
        label: provider.label,
        configured: provider.isConfigured(),
        capabilities: provider.capabilities,
      }
    })
}

export type PaymentsAvailability = { available: true } | { available: false; reason: string }

/**
 * Both conditions are required, deliberately.
 *
 * The env vars supply credentials; the feature flag is the operator's explicit
 * acknowledgement that this deployment now charges real cards. Having only the
 * keys present is how a staging environment ends up billing live customers.
 */
export function paymentsAvailable(flagEnabled: boolean): PaymentsAvailability {
  const provider = getPaymentProvider()

  if (!provider.isConfigured()) return { available: false, reason: UNAVAILABLE }
  if (!flagEnabled) {
    return {
      available: false,
      reason:
        `${provider.label} credentials are present but the \`payments\` feature flag is off. ` +
        'Turn it on in /admin/settings to start charging.',
    }
  }
  return { available: true }
}
