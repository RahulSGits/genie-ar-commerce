import Link from 'next/link'
import {
  AlertTriangle, ArrowRight, Boxes, Eye, MousePointerClick,
  QrCode, ScanLine, Sparkles,
} from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById, getEntitlements, getUsage, getSubscription, getPlan } from '@/lib/db/repositories/businesses'
import { getBusinessStats, getDailySeries, getFunnel, getTopProducts } from '@/lib/db/repositories/analytics'
import { getBillingSummary } from '@/lib/db/repositories/billing'
import { maybeRunBillingTick } from '@/lib/billing/engine'
import { listProducts } from '@/lib/db/repositories/catalog'
import { usageBars } from '@/lib/billing/entitlements'
import { getTerminology } from '@/config/terminology'
import { formatMoney } from '@/utils/money'
import { formatDate, percentage } from '@/lib/utils'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress, Stat } from '@/components/ui'
import ScansChart from '@/components/dashboard/ScansChart'

export const metadata = { title: 'Overview' }
export const dynamic = 'force-dynamic'

export default async function DashboardOverview() {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const terminology = getTerminology(business.category)

  // Keeps this business's invoice statuses and reminders current without a
  // job runner. Rate-limited internally.
  maybeRunBillingTick()

  const stats = getBusinessStats(ctx.businessId, 30)
  const series = getDailySeries(ctx.businessId, 30)
  const funnel = getFunnel(ctx.businessId, 30)
  const topProducts = getTopProducts(ctx.businessId, 30, 5)
  const entitlements = getEntitlements(ctx.businessId)
  const usage = getUsage(ctx.businessId)
  const billing = getBillingSummary(ctx.businessId)
  const subscription = getSubscription(ctx.businessId)
  const plan = subscription ? getPlan(subscription.planId) : null
  const { rows: products } = listProducts(ctx.businessId, { limit: 1 })

  const bars = usageBars(entitlements, usage).filter((b) =>
    ['products', 'AR models', 'QR codes'].includes(b.label),
  )

  const arRate = percentage(funnel.ar_session_started, funnel.product_loaded)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground text-sm">
            {business.name} · last 30 days
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/models">Upload model</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard/products/new">Add {terminology.itemSingular.toLowerCase()}</Link>
          </Button>
        </div>
      </header>

      {/* ── billing alert ───────────────────────────────────────────────── */}
      {billing.overdueMinor > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center gap-3 pt-5">
            <AlertTriangle className="text-destructive size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Payment overdue</p>
              <p className="text-muted-foreground text-sm">
                {formatMoney({ amount: billing.overdueMinor, currency: business.currency })} is past
                its due date. Your AR pages stay live — settle it to avoid interruption.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/billing">View invoices</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {subscription?.status === 'trialing' && subscription.trialEndsAt && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-3 pt-5">
            <Sparkles className="text-primary size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Trial ends {formatDate(subscription.trialEndsAt, business.timezone)}
              </p>
              <p className="text-muted-foreground text-sm">
                You’re on {plan?.name ?? 'a trial'}. Contact us to activate a plan.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── stats ───────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="QR scans" value={stats.totalScans.toLocaleString('en-IN')} icon={<ScanLine />} />
        <Stat label="AR sessions" value={stats.arSessions.toLocaleString('en-IN')} icon={<Eye />}
          hint={`${arRate}% of product views`} />
        <Stat label="CTA clicks" value={stats.ctaClicks.toLocaleString('en-IN')} icon={<MousePointerClick />}
          hint={`${stats.conversionRate}% of scans`} />
        <Stat label="Live AR products" value={`${stats.arProducts} / ${stats.totalProducts}`} icon={<Boxes />} />
      </div>

      {/* ── chart + funnel ──────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.totalScans === 0 ? (
              <EmptyState
                icon={<ScanLine />}
                title="No scans yet"
                description="Print a QR code and put it on a table — scans will appear here."
                action={
                  <Button asChild size="sm">
                    <Link href="/dashboard/qr">Create a QR code</Link>
                  </Button>
                }
                className="border-0"
              />
            ) : (
              <ScansChart data={series} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversion funnel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ['Scanned', funnel.qr_scanned],
              ['Product opened', funnel.product_loaded],
              ['Viewed in 3D', funnel.viewer_3d_opened],
              ['Tapped AR', funnel.ar_clicked],
              ['AR session', funnel.ar_session_started],
              ['Clicked CTA', funnel.cta_clicked],
            ].map(([label, count]) => {
              // No substitute denominator. `|| 1` turned a period with zero
              // scans into every stage reading as count x 100%.
              const top = funnel.qr_scanned
              const pct = top > 0 ? percentage(Number(count), top, 0) : null
              return (
                <div key={String(label)}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums">
                      {Number(count).toLocaleString('en-IN')}
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        {pct === null ? '—' : `${pct}%`}
                      </span>
                    </span>
                  </div>
                  <Progress value={pct ?? 0} />
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      {/* ── top products + usage ────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top {terminology.itemPlural.toLowerCase()}</CardTitle>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              products.length === 0 ? (
                <EmptyState
                  icon={<Boxes />}
                  title={`No ${terminology.itemPlural.toLowerCase()} yet`}
                  description="Add your first product and attach a 3D model to start."
                  action={
                    <Button asChild size="sm">
                      <Link href="/dashboard/products/new">
                        Add {terminology.itemSingular.toLowerCase()}
                      </Link>
                    </Button>
                  }
                  className="border-0"
                />
              ) : (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No views in this period yet.
                </p>
              )
            ) : (
              <ul className="space-y-3">
                {topProducts.map((p, i) => (
                  <li key={p.productId} className="flex items-center gap-3">
                    <span className="text-muted-foreground w-4 text-sm tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {p.views.toLocaleString('en-IN')} views
                    </span>
                    <Badge variant="secondary" className="tabular-nums">
                      {p.arSessions} AR
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plan usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{entitlements.planName}</span>
              <Badge variant={entitlements.isActive ? 'success' : 'warning'} className="capitalize">
                {entitlements.status}
              </Badge>
            </div>

            {bars.map((bar) => (
              <div key={bar.label}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground capitalize">{bar.label}</span>
                  <span className="tabular-nums">
                    {bar.current} / {bar.limit === null ? '∞' : bar.limit}
                  </span>
                </div>
                <Progress
                  value={bar.percent}
                  indicatorClassName={bar.nearLimit ? 'bg-warning' : undefined}
                />
              </div>
            ))}

            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/dashboard/billing">
                Billing & invoices
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
