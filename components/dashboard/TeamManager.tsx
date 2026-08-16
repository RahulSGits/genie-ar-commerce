'use client'

import { useActionState, useTransition } from 'react'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import {
  Alert, Badge, Button, Card, Field, Input, Select, Table, TBody, TD, TH, THead, TR,
} from '@/components/ui'
import { addMemberAction, changeRoleAction, removeMemberAction } from '@/lib/actions/team'
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  PERMISSIONS,
  permissionsFor,
  type Role,
} from '@/lib/auth/permissions'
import type { BusinessMember } from '@/types/domain'

/**
 * Team management (§35).
 *
 * The permission grid is generated from the same matrix the server enforces —
 * a hand-written table beside a separate implementation is a documentation
 * page that goes stale the first time a permission moves.
 */
export default function TeamManager({
  members,
  assignable,
  selfUserId,
  canManage,
  seatsUsed,
  seatLimit,
}: {
  members: BusinessMember[]
  assignable: Role[]
  selfUserId: string
  canManage: boolean
  seatsUsed: number
  seatLimit: number | null
}) {
  const [state, formAction, submitting] = useActionState(addMemberAction, null)
  const [pending, startTransition] = useTransition()

  const changeRole = (memberId: string, role: string) => {
    startTransition(async () => {
      const result = await changeRoleAction(memberId, role)
      toast[result.ok ? 'success' : 'error'](result.ok ? 'Role updated.' : result.error)
    })
  }

  const remove = (memberId: string, name: string) => {
    if (!confirm(`Remove ${name} from this workspace?`)) return
    startTransition(async () => {
      const result = await removeMemberAction(memberId)
      toast[result.ok ? 'success' : 'error'](result.ok ? 'Member removed.' : result.error)
    })
  }

  const atLimit = seatLimit !== null && seatsUsed >= seatLimit

  return (
    <div className="space-y-6">
      <Card className="p-0">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="text-sm font-semibold">Members</h2>
          <span className="text-muted-foreground text-xs tabular-nums">
            {seatsUsed} of {seatLimit === null ? 'unlimited' : seatLimit} seats
          </span>
        </div>

        <Table>
          <THead>
            <TR>
              <TH>Person</TH>
              <TH>Role</TH>
              <TH>Last signed in</TH>
              {canManage && <TH className="text-right">Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {members.map((member) => (
              <TR key={member.id}>
                <TD>
                  <span className="block font-medium">{member.fullName || member.email}</span>
                  <span className="text-muted-foreground text-xs">{member.email}</span>
                </TD>
                <TD>
                  {canManage && assignable.length > 0 && member.userId !== selfUserId ? (
                    <Select
                      defaultValue={member.role}
                      aria-label={`Role for ${member.email}`}
                      disabled={pending}
                      onChange={(e) => changeRole(member.id, e.target.value)}
                    >
                      {assignable.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge variant={member.role === 'owner' ? 'default' : 'muted'}>
                      {ROLE_LABELS[member.role]}
                      {member.userId === selfUserId && ' · you'}
                    </Badge>
                  )}
                </TD>
                <TD className="text-muted-foreground text-xs">
                  {member.lastLoginAt
                    ? new Date(member.lastLoginAt).toLocaleDateString()
                    : 'Never'}
                </TD>
                {canManage && (
                  <TD className="text-right">
                    {member.userId !== selfUserId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={pending}
                        onClick={() => remove(member.id, member.fullName || member.email)}
                      >
                        Remove
                      </Button>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {canManage && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="size-4" aria-hidden />
            Add someone
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            GENIE has no email transport configured on this deployment, so this adds a person who
            already has a GENIE account rather than sending an invitation that would never arrive.
          </p>

          {atLimit && (
            <Alert variant="warning" className="mt-3">
              You are using every seat on your plan. Upgrade to add more people.
            </Alert>
          )}

          <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
            <Field label="Email" htmlFor="member-email">
              <Input
                id="member-email"
                name="email"
                type="email"
                required
                placeholder="colleague@example.com"
                disabled={atLimit}
              />
            </Field>
            <Field label="Role" htmlFor="member-role">
              <Select id="member-role" name="role" defaultValue="viewer" disabled={atLimit}>
                {assignable.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={submitting || atLimit}>
                {submitting ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </form>

          {state?.ok === false && (
            <p className="text-destructive mt-2 text-sm" role="alert">
              {state.error}
            </p>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold">What each role can do</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Generated from the permission matrix the server checks, so this table cannot drift from
          what is actually enforced.
        </p>

        <div className="scroll-x mt-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3 text-left font-medium">Permission</th>
                {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                  <th key={role} className="px-2 py-2 text-center font-medium">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((permission) => (
                <tr key={permission} className="border-b last:border-0">
                  <td className="text-muted-foreground py-1.5 pr-3 font-mono">{permission}</td>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                    <td key={role} className="px-2 py-1.5 text-center">
                      {permissionsFor(role).includes(permission) ? (
                        <span className="text-success" aria-label="allowed">
                          ●
                        </span>
                      ) : (
                        <span className="text-muted-foreground/30" aria-label="not allowed">
                          ·
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="mt-4 space-y-1.5 text-xs">
          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
            <div key={role} className="flex gap-2">
              <dt className="w-20 shrink-0 font-medium">{ROLE_LABELS[role]}</dt>
              <dd className="text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  )
}
