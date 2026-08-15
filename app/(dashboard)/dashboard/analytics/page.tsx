import Link from 'next/link'
import {
  Boxes, Eye, MousePointerClick, ScanLine, Smartphone,
} from 'lucide-react'
import { requireBusiness } from '@/lib/auth/guards'
import { getBusinessById } from '@/lib/db/repositories/businesses'
import {
  getBusinessStats, getDailySeries, getDeviceBreakdown, getFunnel, getTopProducts,
} from '@/lib/db/repositories/analytics'
import { getTerminology } from '@/config/terminology'
import { percentage } from '@/lib/utils'
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Progress, Stat, TBody, TD, TH, THead, TR, Table,
} from '@/components/ui'
import ScansChart from '@/components/dashboard/ScansChart'

export const metadata = { title: 'Analytics' }
export const dynamic = 'force-dynamic'

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const ctx = await requireBusiness()
  const business = getBusinessById(ctx.businessId)!
  const terminology = getTerminology(business.category)

  const requested = Number((await searchParams).days)
  const days: Range = RANGES.includes(requested as Range) ? (requested as Range) : 30

  const stats = getBusinessStats(ctx.businessId, days)
  const series = getDailySeries(ctx.businessId, days)
  const funnel = getFunnel(ctx.businessId, days)
  const topProducts = getTopProducts(ctx.businessId, days, 10)
  const devices = getDeviceBreakdown(ctx.businessId, days)

  // Every stage is measured against the scans that started it, so the numbers
  // read as drop-off rather than as six unrelated counts.
  const topOfFunnel = funnel.qr_scanned || 1
  const deviceTotal = devices.reduce((sum, d) => sum + d.count, 0) || 1

  const ranges = (
    <div className="flex gap-1.5">
      {RANGES.map((r) => (
        <Button
          key={r}
          asChild
          size="sm"
          variant={r === days ? 'default' : 'outline'}
        >
          <Link href={`/dashboard/analytics?days=${r}`}>{r}d</Link>
        </Button>
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground text-sm">
            {business.name} · last {days} days
          </p>
        </div>
        {ranges}
      </header>

      {stats.totalScans === 0 ? (
        <EmptyState
          icon={<ScanLine />}
          title="No activity in this period"
          description="Scans, AR sessions and clicks appear here once a printed QR code is used. Try a longer range, or put a code in front of customers."
          action={
            <Button asChild size="sm">
              <Link href="/dashboard/qr">Create a QR code</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="QR scans"
              value={stats.totalScans.toLocaleString('en-IN')}
              icon={<ScanLine />}
            />
            <Stat
              label="AR sessions"
              value={stats.arSessions.toLocaleString('en-IN')}
              hint={`${percentage(funnel.ar_session_started, funnel.product_loaded)}% of product views`}
              icon={<Eye />}
            />
            <Stat
              label="CTA clicks"
              value={stats.ctaClicks.toLocaleString('en-IN')}
              hint={`${stats.conversionRate}% of scans`}
              icon={<MousePointerClick />}
            />
            <Stat
              label="Live AR products"
              value={`${stats.arProducts} / ${stats.totalProducts}`}
              icon={<Boxes />}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
              <CardDescription>Scans, AR sessions and clicks per day.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScansChart data={series} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Conversion funnel</CardTitle>
                <CardDescription>Share of the scans that reached each step.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(
                  [
                    ['Scanned', funnel.qr_scanned],
                    ['Product opened', funnel.product_loaded],
                    ['Viewed in 3D', funnel.viewer_3d_opened],
                    ['Tapped AR', funnel.ar_clicked],
                    ['AR session', funnel.ar_session_started],
                    ['Clicked CTA', funnel.cta_clicked],
                  ] as const
                ).map(([label, count]) => {
                  const pct = percentage(count, topOfFunnel, 0)
                  return (
                    <div key={label}>
                      <div className="mb-1 flex items-baseline justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium tabular-nums">
                          {count.toLocaleString('en-IN')}
                          <span className="text-muted-foreground ml-1.5 text-xs">{pct}%</span>
                        </span>
                      </div>
                      <Progress value={pct} />
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Devices</CardTitle>
                <CardDescription>Coarse buckets only — nothing identifying.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {devices.length === 0 ? (
                  <EmptyState
                    icon={<Smartphone />}
                    title="No device data"
                    description="Device buckets are recorded alongside scans."
                    className="border-0"
                  />
                ) : (
                  devices.map((device) => {
                    const pct = percentage(device.count, deviceTotal, 0)
                    return (
                      <div key={device.label}>
                        <div className="mb-1 flex items-baseline justify-between text-sm">
                          <span className="text-muted-foreground capitalize">{device.label}</span>
                          <span className="font-medium tabular-nums">
                            {device.count.toLocaleString('en-IN')}
                            <span className="text-muted-foreground ml-1.5 text-xs">{pct}%</span>
                          </span>
                        </div>
                        <Progress value={pct} />
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Top {terminology.itemPlural.toLowerCase()}
              </CardTitle>
              <CardDescription>Ranked by product page views in this period.</CardDescription>
            </CardHeader>
            <CardContent>
              {topProducts.length === 0 ? (
                <EmptyState
                  icon={<Boxes />}
                  title="No product views yet"
                  description={`Scans reached your ${terminology.catalogNavLabel.toLowerCase()} but no individual ${terminology.itemSingular.toLowerCase()} was opened.`}
                  className="border-0"
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-10">#</TH>
                      <TH>{terminology.itemSingular}</TH>
                      <TH className="text-right">Views</TH>
                      <TH className="text-right">AR sessions</TH>
                      <TH className="text-right">AR rate</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {topProducts.map((product, i) => (
                      <TR key={product.productId}>
                        <TD className="text-muted-foreground tabular-nums">{i + 1}</TD>
                        <TD className="font-medium">{product.name}</TD>
                        <TD className="text-right tabular-nums">
                          {product.views.toLocaleString('en-IN')}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {product.arSessions.toLocaleString('en-IN')}
                        </TD>
                        <TD className="text-right">
                          <Badge variant="secondary" className="tabular-nums">
                            {percentage(product.arSessions, product.views, 0)}%
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
