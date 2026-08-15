import Link from 'next/link'
import { Check, Minus, PackageOpen } from 'lucide-react'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { formatLimit } from '@/lib/billing/entitlements'
import type { FeatureKey } from '@/lib/billing/entitlements'
import type { SubscriptionPlan } from '@/types/domain'
import { formatMoney } from '@/utils/money'
import { cn, formatBytes } from '@/lib/utils'

/**
 * Public plan comparison.
 *
 * Every number here is read off the plan record — nothing branches on a plan's
 * name or slug, so the super admin can rename plans, re-price them or invent a
 * fourth one without this component changing.
 */

const FEATURE_LABELS: Record<FeatureKey, string> = {
  advanced_analytics: 'Advanced analytics',
  custom_branding: 'Custom branding',
  white_label: 'White label',
  custom_domain: 'Custom domain',
  team_members: 'Team accounts',
  api_access: 'API access',
  priority_support: 'Priority support',
  model_generation: 'We build your 3D models',
}

const FEATURE_ORDER = Object.keys(FEATURE_LABELS) as FeatureKey[]

export default function PricingTable({ plans }: { plans: SubscriptionPlan[] }) {
  if (plans.length === 0) {
    return (
      <EmptyState
        icon={<PackageOpen />}
        title="Plans are being updated"
        description="Our pricing is between revisions right now. Talk to us and we'll quote you directly."
        action={
          <Button asChild size="sm">
            <Link href="/signup">Get in touch</Link>
          </Button>
        }
      />
    )
  }

  // The middle plan is highlighted positionally rather than by name, so the
  // emphasis follows whatever ladder the operator publishes.
  const highlighted = Math.floor((plans.length - 1) / 2)

  return (
    <div
      className={cn(
        'grid gap-4',
        plans.length === 1 ? 'max-w-sm' : plans.length === 2 ? 'sm:grid-cols-2' : 'md:grid-cols-3',
      )}
    >
      {plans.map((plan, i) => {
        const featured = i === highlighted
        return (
          <Card
            key={plan.id}
            className={cn('relative flex flex-col', featured && 'border-primary shadow-md')}
          >
            {featured && (
              <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">Most popular</Badge>
            )}

            <div className="flex flex-1 flex-col p-6">
              <h3 className="font-semibold">{plan.name}</h3>
              <p className="text-muted-foreground mt-1 min-h-10 text-sm">
                {plan.description ?? 'Everything you need to publish AR products.'}
              </p>

              <p className="mt-4">
                <span className="text-3xl font-bold tracking-tight">
                  {formatMoney({ amount: plan.priceMinor, currency: plan.currency })}
                </span>
                <span className="text-muted-foreground text-sm">
                  /{plan.billingInterval === 'yearly' ? 'year' : 'month'}
                </span>
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {plan.setupFeeMinor > 0
                  ? `+ ${formatMoney({ amount: plan.setupFeeMinor, currency: plan.currency })} one-time setup`
                  : 'No setup fee'}
                {plan.trialDays > 0 && ` · ${plan.trialDays}-day trial`}
              </p>

              <dl className="mt-5 space-y-2 border-t pt-5 text-sm">
                <LimitRow label="Products" value={formatLimit(plan.limits.maxProducts)} />
                <LimitRow label="AR models" value={formatLimit(plan.limits.maxArModels)} />
                <LimitRow label="QR codes" value={formatLimit(plan.limits.maxQrCodes)} />
                <LimitRow label="Team members" value={formatLimit(plan.limits.maxTeamMembers)} />
                <LimitRow
                  label="Scans / month"
                  value={
                    plan.limits.maxMonthlyScans === null
                      ? 'Unlimited'
                      : plan.limits.maxMonthlyScans.toLocaleString('en-IN')
                  }
                />
                <LimitRow
                  label="Model storage"
                  value={
                    plan.limits.maxStorageBytes === null
                      ? 'Unlimited'
                      : formatBytes(plan.limits.maxStorageBytes)
                  }
                />
              </dl>

              <ul className="mt-5 space-y-2 border-t pt-5 text-sm">
                {FEATURE_ORDER.map((key) => {
                  const on = plan.features[key]
                  return (
                    <li
                      key={key}
                      className={cn(
                        'flex items-center gap-2',
                        on ? 'text-foreground' : 'text-muted-foreground/60',
                      )}
                    >
                      {on ? (
                        <Check className="text-success size-4 shrink-0" aria-hidden />
                      ) : (
                        <Minus className="size-4 shrink-0" aria-hidden />
                      )}
                      <span className={cn(!on && 'line-through')}>{FEATURE_LABELS[key]}</span>
                      <span className="sr-only">{on ? 'included' : 'not included'}</span>
                    </li>
                  )
                })}
              </ul>

              <Button
                asChild
                className="mt-6 w-full"
                size="lg"
                variant={featured ? 'default' : 'outline'}
              >
                <Link href="/signup">Get started</Link>
              </Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
