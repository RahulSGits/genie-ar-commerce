import { Check, Layers } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { listPlans } from '@/lib/db/repositories/businesses'
import { formatLimit } from '@/lib/billing/entitlements'
import { formatMoney } from '@/utils/money'
import { formatBytes } from '@/lib/utils'
import {
  Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Separator,
} from '@/components/ui'
import PlanEditor from '@/components/admin/PlanEditor'
import type { SubscriptionPlan } from '@/types/domain'

export const metadata = { title: 'Pricing' }
export const dynamic = 'force-dynamic'

const FEATURE_LABELS: Record<keyof SubscriptionPlan['features'], string> = {
  advanced_analytics: 'Advanced analytics',
  custom_branding: 'Custom branding',
  white_label: 'White label',
  custom_domain: 'Custom domain',
  team_members: 'Team members',
  api_access: 'API access',
  priority_support: 'Priority support',
  model_generation: 'Model generation',
}

export default async function AdminPricingPage() {
  await requireSuperAdmin()

  const plans = listPlans({ includeArchived: true })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pricing</h1>
        <p className="text-muted-foreground text-sm">
          Plans, limits and features — all editable without a deploy.
        </p>
      </header>

      <Alert variant="warning">
        Limits and features are data, not code. Editing a plan immediately changes what every
        business already on it can do, so lowering a ceiling below a client&rsquo;s current usage
        will block their next upload. To change terms for one client only, set a negotiated price or
        override on that business instead.
      </Alert>

      {plans.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No plans yet"
          description="Create the first plan below — it is what every new business gets attached to."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {plan.archived && <Badge variant="muted">Archived</Badge>}
                  {!plan.isPublic && <Badge variant="outline">Hidden</Badge>}
                </div>
                <CardDescription>{plan.description ?? plan.slug}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold tracking-tight tabular-nums">
                    {formatMoney({ amount: plan.priceMinor, currency: plan.currency })}
                  </span>
                  <span className="text-muted-foreground text-sm">/ {plan.billingInterval}</span>
                </div>

                <p className="text-muted-foreground text-xs">
                  Setup {formatMoney({ amount: plan.setupFeeMinor, currency: plan.currency })} ·{' '}
                  {plan.trialDays > 0 ? `${plan.trialDays}-day trial` : 'No trial'}
                </p>

                <Separator />

                <dl className="space-y-1 text-sm">
                  {[
                    ['Products', formatLimit(plan.limits.maxProducts)],
                    ['AR models', formatLimit(plan.limits.maxArModels)],
                    ['QR codes', formatLimit(plan.limits.maxQrCodes)],
                    ['Team members', formatLimit(plan.limits.maxTeamMembers)],
                    [
                      'Storage',
                      plan.limits.maxStorageBytes === null
                        ? 'Unlimited'
                        : formatBytes(plan.limits.maxStorageBytes),
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>

                <ul className="space-y-1">
                  {(Object.keys(FEATURE_LABELS) as Array<keyof SubscriptionPlan['features']>)
                    .filter((key) => plan.features[key])
                    .map((key) => (
                      <li key={key} className="flex items-center gap-1.5 text-sm">
                        <Check className="text-success size-3.5 shrink-0" aria-hidden />
                        {FEATURE_LABELS[key]}
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan editor</CardTitle>
          <CardDescription>
            Pick an existing plan to edit it, or leave it on “New plan” to create one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlanEditor plans={plans} />
        </CardContent>
      </Card>
    </div>
  )
}
