import { CheckSquare } from 'lucide-react'
import { requirePermission } from '@/lib/auth/guards'
import { listPendingApprovalsAction } from '@/lib/actions/workflow'
import { can } from '@/lib/auth/permissions'
import { EmptyState } from '@/components/ui'
import ApprovalQueue from '@/components/dashboard/ApprovalQueue'

export const metadata = { title: 'Approvals' }
export const dynamic = 'force-dynamic'

export default async function ApprovalsPage() {
  const ctx = await requirePermission('products:read')
  const { items, requiresApproval } = await listPendingApprovalsAction()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          {requiresApproval
            ? 'Editors submit changes here instead of publishing straight to your customers. Managers and above decide.'
            : 'This workspace publishes directly. Turn on approvals in Settings if you want an editor’s changes reviewed first.'}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckSquare />}
          title="Nothing waiting"
          description={
            requiresApproval
              ? 'Everything submitted has been decided.'
              : 'Approvals are switched off for this workspace.'
          }
        />
      ) : (
        <ApprovalQueue items={items} canDecide={can(ctx.role, 'approvals:decide')} />
      )}
    </div>
  )
}
