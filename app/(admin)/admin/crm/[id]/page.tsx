import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { getLead, listActivity, listNotes, listTasks } from '@/lib/db/repositories/crm'
import { listPlans } from '@/lib/db/repositories/businesses'
import { CRM_STAGE_LABELS } from '@/types/domain'
import { Badge, Button } from '@/components/ui'
import LeadDetail from '@/components/admin/LeadDetail'

export const metadata = { title: 'Lead' }
export const dynamic = 'force-dynamic'

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin()
  const { id } = await params

  const lead = getLead(id)
  if (!lead) notFound()

  const notes = listNotes(lead.id)
  const tasks = listTasks({ leadId: lead.id })
  const activity = listActivity(lead.id)
  const plans = listPlans()

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/admin/crm">
            <ArrowLeft className="size-4" aria-hidden />
            Pipeline
          </Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">{lead.businessName}</h1>
          <p className="text-muted-foreground text-sm">
            {lead.name}
            {lead.businessType && ` · ${lead.businessType}`}
          </p>
        </div>
        <Badge variant={lead.stage === 'won' ? 'success' : lead.stage === 'lost' ? 'destructive' : 'secondary'}>
          {CRM_STAGE_LABELS[lead.stage]}
        </Badge>
      </header>

      <LeadDetail lead={lead} notes={notes} tasks={tasks} activity={activity} plans={plans} />
    </div>
  )
}
