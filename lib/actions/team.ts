'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/guards'
import { guarded, badRequest, forbidden, type ActionResult } from '@/lib/auth/errors'
import { getDb, now, uuid, type Row, str } from '@/lib/db'
import { listMembers } from '@/lib/db/repositories/businesses'
import { getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { canInviteTeamMember } from '@/lib/billing/entitlements'
import { assignableRoles, normalizeRole, ROLE_LABELS, type Role } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/db/repositories/platform'

/**
 * Team management (§35).
 *
 * Membership changes are the highest-privilege operation a workspace has —
 * getting one wrong hands over the whole account — so each is audited and each
 * is bounded by what the actor's own role can grant.
 */

export async function listTeamAction() {
  const ctx = await requirePermission('team:read')
  return {
    members: listMembers(ctx.businessId),
    assignable: assignableRoles(ctx.role),
    selfUserId: ctx.user.id,
  }
}

/**
 * Adds an existing GENIE user to this workspace.
 *
 * Deliberately not an email invitation: sending one needs a mail transport,
 * which this deployment does not have configured. Rather than render an
 * "Invite sent" toast for a message that was never sent, the form adds a user
 * who already has an account and says so plainly.
 */
export async function addMemberAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('team:manage')

    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const requestedRole = String(formData.get('role') ?? 'viewer')

    if (!email) badRequest('Enter the email address of an existing GENIE user.')

    const allowedRoles = assignableRoles(ctx.role)
    if (!allowedRoles.includes(requestedRole as Role)) {
      // An admin minting another owner is privilege escalation dressed up as
      // an invite, so the set of grantable roles is bounded by the actor's own.
      forbidden(`Your role cannot grant ${ROLE_LABELS[normalizeRole(requestedRole)]}.`)
    }

    const seats = canInviteTeamMember(getEntitlements(ctx.businessId), getUsage(ctx.businessId))
    if (!seats.allowed) badRequest(seats.message)

    const db = getDb()
    const user = db.prepare(`SELECT id FROM users WHERE lower(email) = ?`).get(email) as
      | Row
      | undefined

    if (!user) {
      badRequest(
        `No GENIE account exists for ${email}. Ask them to sign up first, then add them here.`,
      )
    }

    const userId = str(user as Row, 'id')
    const existing = db
      .prepare(`SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ?`)
      .get(ctx.businessId, userId)
    if (existing) badRequest('That person is already in this workspace.')

    db.prepare(
      `INSERT INTO business_members (id, business_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(uuid(), ctx.businessId, userId, requestedRole, now())

    recordAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'team.member_added',
      entityType: 'business_member',
      entityId: userId,
      businessId: ctx.businessId,
      after: { email, role: requestedRole },
    })

    revalidatePath('/dashboard/team')
    return null
  })
}

export async function changeRoleAction(
  memberId: string,
  role: string,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('team:manage')

    if (!assignableRoles(ctx.role).includes(role as Role)) {
      forbidden(`Your role cannot grant ${ROLE_LABELS[normalizeRole(role)]}.`)
    }

    const db = getDb()
    const member = db
      .prepare(`SELECT * FROM business_members WHERE id = ? AND business_id = ?`)
      .get(memberId, ctx.businessId) as Row | undefined
    if (!member) badRequest('That member is no longer in this workspace.')

    const target = member as Row
    const previous = normalizeRole(str(target, 'role'))

    // Demoting the last owner leaves a workspace nobody can bill, transfer or
    // delete. The check counts owners rather than trusting the UI to hide the
    // control, because the action is reachable directly.
    if (previous === 'owner' && role !== 'owner' && countOwners(ctx.businessId) <= 1) {
      badRequest('This is the only owner. Promote someone else to owner first.')
    }

    db.prepare(`UPDATE business_members SET role = ? WHERE id = ? AND business_id = ?`).run(
      role,
      memberId,
      ctx.businessId,
    )

    recordAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'team.role_changed',
      entityType: 'business_member',
      entityId: memberId,
      businessId: ctx.businessId,
      before: { role: previous },
      after: { role },
    })

    revalidatePath('/dashboard/team')
    return null
  })
}

export async function removeMemberAction(memberId: string): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('team:manage')

    const db = getDb()
    const member = db
      .prepare(`SELECT * FROM business_members WHERE id = ? AND business_id = ?`)
      .get(memberId, ctx.businessId) as Row | undefined
    if (!member) return null

    const target = member as Row
    if (normalizeRole(str(target, 'role')) === 'owner' && countOwners(ctx.businessId) <= 1) {
      badRequest('This is the only owner. Promote someone else to owner first.')
    }

    db.prepare(`DELETE FROM business_members WHERE id = ? AND business_id = ?`).run(
      memberId,
      ctx.businessId,
    )

    recordAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'team.member_removed',
      entityType: 'business_member',
      entityId: memberId,
      businessId: ctx.businessId,
      before: { userId: str(target, 'user_id'), role: str(target, 'role') },
    })

    revalidatePath('/dashboard/team')
    return null
  })
}

function countOwners(businessId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM business_members WHERE business_id = ? AND role = 'owner'`)
    .get(businessId) as Row | undefined
  return typeof row?.c === 'number' ? row.c : 0
}
