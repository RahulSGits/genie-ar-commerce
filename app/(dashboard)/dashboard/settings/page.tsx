import Link from 'next/link'
import { ArrowRight, Users } from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import {
  getBusinessById, getEntitlements, getPlan, getSubscription, getUsage, listMembers,
} from '@/lib/db/repositories/businesses'
import { getBranding } from '@/lib/db/repositories/platform'
import { usageBars, formatLimit } from '@/lib/billing/entitlements'
import { BUSINESS_CATEGORY_LABELS } from '@/config/terminology'
import { formatMoney } from '@/utils/money'
import { formatBytes, formatDate } from '@/lib/utils'
import {
  Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Progress, Separator, TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'

export const metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const entitlements = getEntitlements(ctx.businessId)
  const usage = getUsage(ctx.businessId)
  const subscription = getSubscription(ctx.businessId)
  const plan = subscription ? getPlan(subscription.planId) : null
  const members = listMembers(ctx.businessId)
  const branding = getBranding()

  const bars = usageBars(entitlements, usage)
  const includedFeatures = (Object.keys(entitlements.features) as Array<
    keyof typeof entitlements.features
  >).filter((key) => entitlements.features[key])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          What your account currently includes. Nothing on this page is editable here.
        </p>
      </header>

      <Alert>
        Plan changes, extra limits and new team members are arranged with us directly — write to{' '}
        <Link
          href={`mailto:${branding.supportEmail}`}
          className="text-primary font-medium hover:underline"
        >
          {branding.supportEmail}
        </Link>{' '}
        or open a ticket from{' '}
        <Link href="/dashboard/support" className="text-primary font-medium hover:underline">
          Help
        </Link>
        . Everything you can edit yourself lives on your{' '}
        <Link href="/dashboard/business" className="text-primary font-medium hover:underline">
          Business Profile
        </Link>
        .
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan</CardTitle>
            <CardDescription>What you are subscribed to today.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-lg font-semibold">{entitlements.planName}</span>
              <Badge variant={entitlements.isActive ? 'success' : 'warning'} className="capitalize">
                {entitlements.status.replace('_', ' ')}
              </Badge>
            </div>

            {subscription && plan && (
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Price
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {formatMoney({
                      amount: subscription.negotiatedPriceMinor ?? plan.priceMinor,
                      currency: business.currency,
                    })}
                    <span className="text-muted-foreground ml-1 text-sm font-normal">
                      / {subscription.billingInterval === 'yearly' ? 'year' : 'month'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Renews
                  </dt>
                  <dd className="font-medium">
                    {formatDate(subscription.currentPeriodEnd, business.timezone)}
                  </dd>
                </div>
              </dl>
            )}

            {includedFeatures.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    Included
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {includedFeatures.map((key) => (
                      <Badge key={key} variant="secondary" className="capitalize">
                        {key.replace(/_/g, ' ')}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/dashboard/billing">
                Billing &amp; invoices
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Limits</CardTitle>
            <CardDescription>Usage against what your plan allows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {bars.map((bar) => {
              const isStorage = bar.label === 'storage'
              const current = isStorage
                ? formatBytes(bar.current)
                : bar.current.toLocaleString('en-IN')
              const limit =
                bar.limit === null
                  ? formatLimit(bar.limit)
                  : isStorage
                    ? formatBytes(bar.limit)
                    : formatLimit(bar.limit)
              return (
                <div key={bar.label}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground capitalize">{bar.label}</span>
                    <span className="tabular-nums">
                      {current} / {limit}
                    </span>
                  </div>
                  <Progress
                    value={bar.percent}
                    indicatorClassName={bar.nearLimit ? 'bg-warning' : undefined}
                  />
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
          <CardDescription>
            People who can sign in to this dashboard. Ask support to add or remove someone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title="No team members"
              description="Your account has no members attached yet."
              className="border-0"
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Added</TH>
                </TR>
              </THead>
              <TBody>
                {members.map((member) => (
                  <TR key={member.id}>
                    <TD className="font-medium">{member.fullName}</TD>
                    <TD className="text-muted-foreground">{member.email}</TD>
                    <TD>
                      <Badge variant="secondary" className="capitalize">
                        {member.role}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {formatDate(member.createdAt, business.timezone)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regional</CardTitle>
          <CardDescription>
            Set when your account was created. Support can change these.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Timezone
              </dt>
              <dd className="font-medium">{business.timezone}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Currency
              </dt>
              <dd className="font-medium">{business.currency}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Business type
              </dt>
              <dd className="font-medium">{BUSINESS_CATEGORY_LABELS[business.category]}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
