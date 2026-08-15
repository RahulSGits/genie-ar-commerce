import Link from 'next/link'
import {
  AlertTriangle, BadgePercent, Boxes, Building2, Check, CheckCircle2, FileText,
  IndianRupee, ScanLine, Sparkles, UserPlus,
} from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { getPlatformStats } from '@/lib/db/repositories/analytics'
import { getBillingSummary, getMonthlyRevenue } from '@/lib/db/repositories/billing'
import { maybeRunBillingTick } from '@/lib/billing/engine'
import { getPipelineSummary, listTasks } from '@/lib/db/repositories/crm'
import { completeTaskAction } from '@/lib/actions/admin'
import { CRM_STAGES, CRM_STAGE_LABELS } from '@/types/domain'
import { formatMoney } from '@/utils/money'
import { formatDate } from '@/lib/utils'
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Stat,
} from '@/components/ui'
import RevenueChart from '@/components/admin/RevenueChart'

export const metadata = { title: 'Platform overview' }
export const dynamic = 'force-dynamic'

export default async function AdminOverview() {
  await requireSuperAdmin()

  // The floor beneath the scheduled trigger: an admin opening this page is
  // enough to keep billing current even with no cron configured at all.
  // Rate-limited internally and safe to call on every render.
  maybeRunBillingTick()

  const stats = getPlatformStats()
  const billing = getBillingSummary()
  const revenue = getMonthlyRevenue(12)
  const pipeline = getPipelineSummary()
  const tasks = listTasks({ openOnly: true })

  const byStage = new Map(pipeline.map((p) => [p.stage, p]))
  const pipelineValue = pipeline.reduce((sum, p) => sum + p.valueMinor, 0)
  const today = new Date().toISOString()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform overview</h1>
          <p className="text-muted-foreground text-sm">
            Every business, every rupee, all time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/admin/businesses/new">
              <Building2 className="size-4" aria-hidden />
              Add business
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/invoices">
              <FileText className="size-4" aria-hidden />
              Create invoice
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/crm">
              <UserPlus className="size-4" aria-hidden />
              Add lead
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/offers">
              <BadgePercent className="size-4" aria-hidden />
              Create offer
            </Link>
          </Button>
        </div>
      </header>

      {billing.overdueMinor > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center gap-3 pt-5">
            <AlertTriangle className="text-destructive size-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {formatMoney({ amount: billing.overdueMinor, currency: 'INR' })} overdue
              </p>
              <p className="text-muted-foreground text-sm">
                Past its due date across all clients. Chase it before it ages further.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/invoices">View invoices</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── businesses ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Businesses"
          value={stats.totalBusinesses.toLocaleString('en-IN')}
          icon={<Building2 />}
        />
        <Stat
          label="Active"
          value={stats.activeBusinesses.toLocaleString('en-IN')}
          icon={<CheckCircle2 />}
        />
        <Stat
          label="On trial"
          value={stats.trialBusinesses.toLocaleString('en-IN')}
          icon={<Sparkles />}
        />
        <Stat
          label="Suspended"
          value={stats.suspendedBusinesses.toLocaleString('en-IN')}
          icon={<AlertTriangle />}
        />
      </div>

      {/* ── catalog & revenue ───────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Products"
          value={stats.totalProducts.toLocaleString('en-IN')}
          hint={`${stats.totalQrCodes.toLocaleString('en-IN')} QR codes`}
          icon={<Boxes />}
        />
        <Stat
          label="AR products"
          value={stats.totalArProducts.toLocaleString('en-IN')}
          hint="Live with a 3D model"
          icon={<Boxes />}
        />
        <Stat
          label="QR scans"
          value={stats.totalScans.toLocaleString('en-IN')}
          icon={<ScanLine />}
        />
        <Stat
          label="Outstanding"
          value={formatMoney({ amount: billing.outstandingMinor, currency: 'INR' })}
          hint={
            billing.overdueMinor > 0
              ? `${formatMoney({ amount: billing.overdueMinor, currency: 'INR' })} overdue`
              : 'Nothing overdue'
          }
          icon={<IndianRupee />}
        />
      </div>

      {/* ── revenue chart ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collected revenue</CardTitle>
          <CardDescription>
            Payments recorded, by month. Billed but unpaid amounts are not counted here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {revenue.length === 0 ? (
            <EmptyState
              icon={<IndianRupee />}
              title="No payments recorded yet"
              description="Record a payment against an invoice and it will show up here."
              action={
                <Button asChild size="sm">
                  <Link href="/admin/invoices">Go to invoices</Link>
                </Button>
              }
              className="border-0"
            />
          ) : (
            <RevenueChart data={revenue} />
          )}
        </CardContent>
      </Card>

      {/* ── pipeline + tasks ────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales pipeline</CardTitle>
            <CardDescription>
              {formatMoney({ amount: pipelineValue, currency: 'INR' })} of expected value across all
              open and closed leads.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pipeline.length === 0 ? (
              <EmptyState
                icon={<UserPlus />}
                title="No leads yet"
                description="Add the businesses you are talking to and track them through to signed."
                action={
                  <Button asChild size="sm">
                    <Link href="/admin/crm">Open CRM</Link>
                  </Button>
                }
                className="border-0"
              />
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CRM_STAGES.map((stage) => {
                  const entry = byStage.get(stage)
                  return (
                    <li key={stage} className="bg-muted/40 rounded-lg px-3 py-2.5">
                      <p className="text-xl font-semibold tabular-nums">{entry?.count ?? 0}</p>
                      <p className="text-muted-foreground text-xs">{CRM_STAGE_LABELS[stage]}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open follow-ups</CardTitle>
            <CardDescription>Tasks nobody has closed out yet.</CardDescription>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 />}
                title="Nothing outstanding"
                description="Every follow-up on the board is done."
                className="border-0"
              />
            ) : (
              <ul className="divide-y">
                {tasks.slice(0, 8).map((task) => {
                  const overdue = task.dueAt !== null && task.dueAt < today
                  return (
                    <li key={task.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{task.title}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {task.leadName ?? 'No lead'}
                          {task.dueAt && ` · due ${formatDate(task.dueAt)}`}
                        </p>
                      </div>
                      {overdue && <Badge variant="destructive">Overdue</Badge>}
                      <form action={completeTaskAction.bind(null, task.id)}>
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                          aria-label={`Complete ${task.title}`}
                        >
                          <Check className="size-4" aria-hidden />
                        </Button>
                      </form>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
