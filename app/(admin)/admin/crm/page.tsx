import { Search } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { listLeads, getPipelineSummary } from '@/lib/db/repositories/crm'
import { CRM_STAGES } from '@/types/domain'
import { formatMoney } from '@/utils/money'
import { Button, Input, Stat } from '@/components/ui'
import CrmBoard from '@/components/admin/CrmBoard'

export const metadata = { title: 'Pipeline' }
export const dynamic = 'force-dynamic'

export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requireSuperAdmin()
  const { q } = await searchParams

  const leads = listLeads({ search: q })
  const summary = getPipelineSummary()

  const byStage = new Map(summary.map((row) => [row.stage, row]))
  // Won and lost are outcomes, not pipeline — counting them would flatter the forecast.
  const openStages = CRM_STAGES.filter((stage) => stage !== 'won' && stage !== 'lost')
  const openValue = openStages.reduce((sum, stage) => sum + (byStage.get(stage)?.valueMinor ?? 0), 0)
  const openCount = openStages.reduce((sum, stage) => sum + (byStage.get(stage)?.count ?? 0), 0)
  const wonValue = byStage.get('won')?.valueMinor ?? 0

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-muted-foreground text-sm">
            Every prospect, from first call to signed client.
          </p>
        </div>

        <form className="flex gap-2" action="/admin/crm">
          <Input
            name="q"
            type="search"
            defaultValue={q ?? ''}
            placeholder="Search leads"
            className="w-48 sm:w-64"
            aria-label="Search leads"
          />
          <Button type="submit" variant="outline" size="icon" aria-label="Search">
            <Search className="size-4" aria-hidden />
          </Button>
        </form>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open leads" value={openCount.toLocaleString('en-IN')} />
        <Stat
          label="Pipeline value"
          value={formatMoney({ amount: openValue, currency: 'INR' })}
          hint="Expected value of everything still in play"
        />
        <Stat label="Won" value={formatMoney({ amount: wonValue, currency: 'INR' })} />
      </div>

      <CrmBoard leads={leads} />
    </div>
  )
}
