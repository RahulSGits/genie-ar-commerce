import { requirePermission } from '@/lib/auth/guards'
import { listMembers, getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { assignableRoles, can } from '@/lib/auth/permissions'
import TeamManager from '@/components/dashboard/TeamManager'

export const metadata = { title: 'Team' }
export const dynamic = 'force-dynamic'

export default async function TeamPage() {
  const ctx = await requirePermission('team:read')

  const entitlements = getEntitlements(ctx.businessId)
  const usage = getUsage(ctx.businessId)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Six roles, from Owner down to Viewer. Permissions are checked on the server for every
          action — hiding a button is convenience, not access control.
        </p>
      </header>

      <TeamManager
        members={listMembers(ctx.businessId)}
        assignable={assignableRoles(ctx.role)}
        selfUserId={ctx.user.id}
        canManage={can(ctx.role, 'team:manage')}
        seatsUsed={usage.teamMembers}
        seatLimit={entitlements.limits.maxTeamMembers}
      />
    </div>
  )
}
