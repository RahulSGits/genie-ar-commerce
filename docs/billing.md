# Billing

## Manual first

No payment gateway is required, and none is wired up. The super admin raises
invoices and records payments as they arrive — bank transfer, UPI, cash. This is
how small-business SaaS in this segment is actually sold, and it keeps the MVP
free to operate.

Razorpay/Stripe are behind the `payments` feature flag as a future integration.

## Money

Integer minor units (paise) everywhere. `utils/money.ts`:

- refuses non-integer construction — a float amount is a bug, caught loudly
- refuses to mix currencies
- caps discounts at the gross, so a coupon can zero a total but never invert it
- rounds tax **once on the taxable base**, never per line

That last point is what makes an invoice's parts sum exactly to its total.
16 unit tests cover it.

## The `paid_minor` invariant

`invoices.paid_minor` always equals the sum of that invoice's payments.

It is denormalised for fast dashboard reads, so every write that could change it
happens inside a transaction that **recomputes it from the payments table**
rather than incrementing a counter. That is why partial payments accumulate
correctly and why a retried request cannot double-count.

## Subscription lifecycle

```
trialing → active → past_due → grace → suspended
                 ↘ cancelled
```

`past_due` and `grace` **remain usable**. Cutting a paying restaurant's live QR
codes the morning a payment is late means their customers hit a dead page
mid-service. Suspension is a deliberate admin action at the end of the grace
period, never an automatic side effect. `autoSuspend` defaults to **off**.

An admin suspension of the *business* outranks whatever the subscription says —
`getEntitlements` resolves that.

## Overdue detection without a scheduler

`markOverdueInvoices()` is called lazily on dashboard read. With no background
worker available on a free deployment, an on-demand sweep keeps status honest
without inventing infrastructure. It is idempotent.

## Entitlements

**Nothing anywhere branches on a plan's name.** `if (plan.slug === 'starter')`
is a bug: it hardcodes commercial policy into application code, so the admin can
no longer change what a plan includes without a deploy, and a custom negotiated
plan silently behaves like whatever branch it happens to miss.

Instead: limits and features are **data on the plan row**, optionally overridden
per subscription, merged by `getEntitlements()`, and checked through
`checkLimit` / `checkFeature`. `null` means unlimited.

19 unit tests cover the gates, including that suspension blocks creation
regardless of headroom.

## Negotiated pricing

`subscriptions.negotiated_price_minor` holds a per-business price. The shared
plan is never edited to give one client a discount. The seed demonstrates this:
Urban Bites pays ₹1,499 against the ₹1,999 Growth plan.

Same mechanism for `limits_override` and `features_override`.

## Reminders

`reminder_rules` holds editable offsets (−7, −3, 0, +3, +7 days relative to due
date), subjects and bodies. `notification_logs` has a unique index on
`(invoice_id, rule_id)`, which makes sending **idempotent** — re-running the
engine cannot send the same reminder twice.

**The dispatcher is not built.** Rules and logging exist; the job that walks due
invoices and fires them does not. Without an email provider configured it would
write `skipped_no_provider` rows anyway.

## Tax

Fully configurable — name, percent, tax id — and **no rate is assumed**. Default
is disabled. Set it in `/admin/settings`.
