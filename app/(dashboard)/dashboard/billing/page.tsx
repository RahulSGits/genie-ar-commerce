import Link from 'next/link'
import { FileText, Mail } from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById, getPlan, getSubscription } from '@/lib/db/repositories/businesses'
import { getBillingSummary, listInvoices, markOverdueInvoices } from '@/lib/db/repositories/billing'
import { getBranding } from '@/lib/db/repositories/platform'
import { formatMoney } from '@/utils/money'
import { formatDate } from '@/lib/utils'
import { invoiceDueMinor, type InvoiceStatus } from '@/types/domain'
import type { SubscriptionStatus } from '@/lib/billing/entitlements'
import {
  Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Separator, Stat, TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'
import type { BadgeProps } from '@/components/ui'

export const metadata = { title: 'Billing' }
export const dynamic = 'force-dynamic'

type BadgeVariant = NonNullable<BadgeProps['variant']>

const INVOICE_VARIANTS: Record<InvoiceStatus, BadgeVariant> = {
  draft: 'muted',
  sent: 'default',
  partial: 'warning',
  paid: 'success',
  overdue: 'destructive',
  cancelled: 'muted',
}

const SUBSCRIPTION_VARIANTS: Record<SubscriptionStatus, BadgeVariant> = {
  trialing: 'default',
  active: 'success',
  past_due: 'warning',
  grace: 'warning',
  suspended: 'destructive',
  cancelled: 'destructive',
}

export default async function BillingPage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!

  // Lazy sweep: with no cron worker, statuses are brought up to date on read.
  markOverdueInvoices()

  const subscription = getSubscription(ctx.businessId)
  const plan = subscription ? getPlan(subscription.planId) : null
  const summary = getBillingSummary(ctx.businessId)
  const invoices = listInvoices({ businessId: ctx.businessId })
  const branding = getBranding()

  const currency = business.currency
  const priceMinor =
    subscription && plan ? (subscription.negotiatedPriceMinor ?? plan.priceMinor) : null

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground text-sm">
          Your plan, your invoices, and what is still outstanding.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subscription</CardTitle>
          <CardDescription>Changes to your plan are arranged with support.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!subscription || !plan ? (
            <EmptyState
              title="No active subscription"
              description={`Your account has no plan attached yet. Write to ${branding.supportEmail} and we will set one up.`}
              className="border-0"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{plan.name}</p>
                  {plan.description && (
                    <p className="text-muted-foreground text-sm">{plan.description}</p>
                  )}
                </div>
                <Badge
                  variant={SUBSCRIPTION_VARIANTS[subscription.status]}
                  className="capitalize"
                >
                  {subscription.status.replace('_', ' ')}
                </Badge>
              </div>

              <Separator />

              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Price
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {formatMoney({ amount: priceMinor ?? 0, currency })}
                    <span className="text-muted-foreground ml-1 text-sm font-normal">
                      / {subscription.billingInterval === 'yearly' ? 'year' : 'month'}
                    </span>
                  </dd>
                  {subscription.negotiatedPriceMinor !== null && (
                    <dd className="text-muted-foreground text-xs">Negotiated rate for your account.</dd>
                  )}
                </div>

                <div>
                  <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Current period ends
                  </dt>
                  <dd className="text-lg font-semibold">
                    {formatDate(subscription.currentPeriodEnd, business.timezone)}
                  </dd>
                </div>

                {subscription.status === 'trialing' && subscription.trialEndsAt && (
                  <div>
                    <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                      Trial ends
                    </dt>
                    <dd className="text-lg font-semibold">
                      {formatDate(subscription.trialEndsAt, business.timezone)}
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Total billed"
          value={formatMoney({ amount: summary.totalBilledMinor, currency })}
          hint={`${summary.invoiceCount} invoice${summary.invoiceCount === 1 ? '' : 's'}`}
        />
        <Stat
          label="Paid"
          value={formatMoney({ amount: summary.totalPaidMinor, currency })}
        />
        <Stat
          label="Outstanding"
          value={formatMoney({ amount: summary.outstandingMinor, currency })}
        />
        <Stat
          label="Overdue"
          value={formatMoney({ amount: summary.overdueMinor, currency })}
          hint={summary.overdueMinor > 0 ? 'Past its due date' : 'Nothing past due'}
        />
      </div>

      <Alert>
        <div className="flex flex-wrap items-center gap-2">
          <Mail className="size-4 shrink-0" aria-hidden />
          <span>
            Payment is arranged directly with us — there is no card on file and no online gateway.
            Send proof of transfer or ask any billing question at{' '}
            <Link
              href={`mailto:${branding.supportEmail}`}
              className="text-primary font-medium hover:underline"
            >
              {branding.supportEmail}
            </Link>
            .
          </span>
        </div>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
          <CardDescription>
            Issued by us and shown here as a record. Raise anything that looks wrong with support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="No invoices yet"
              description="Your first invoice appears here once a billing period closes."
              className="border-0"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Issued</TH>
                  <TH>Due date</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Paid</TH>
                  <TH className="text-right">Balance</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {invoices.map((invoice) => (
                  <TR key={invoice.id}>
                    <TD className="font-mono text-xs font-medium">{invoice.number}</TD>
                    <TD className="whitespace-nowrap">
                      {formatDate(invoice.issueDate, business.timezone)}
                    </TD>
                    <TD className="whitespace-nowrap">
                      {formatDate(invoice.dueDate, business.timezone)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney({ amount: invoice.totalMinor, currency: invoice.currency })}
                    </TD>
                    <TD className="text-muted-foreground text-right tabular-nums">
                      {formatMoney({ amount: invoice.paidMinor, currency: invoice.currency })}
                    </TD>
                    <TD className="text-right font-medium tabular-nums">
                      {formatMoney({
                        amount: invoiceDueMinor(invoice),
                        currency: invoice.currency,
                      })}
                    </TD>
                    <TD>
                      <Badge variant={INVOICE_VARIANTS[invoice.status]} className="capitalize">
                        {invoice.status}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
