import 'server-only'

import { redirect } from 'next/navigation'
import { getDb, type Row, str, toBool } from '@/lib/db'
import { getSessionUser, type SessionUser } from '@/lib/auth/session'
import { can, normalizeRole, type Permission, type Role } from '@/lib/auth/permissions'

/**
 * Server-side authorization guards.
 *
 * These are the primary access control in the system — not the UI, not route
 * naming. A hidden nav link is not security; every server entry point that
 * touches tenant data calls one of these first, and every repository read then
 * takes the resolved businessId explicitly.
 */

export type BusinessRole = Role

export type BusinessContext = {
  user: SessionUser
  businessId: string
  businessName: string
  businessSlug: string
  role: Role
  /** Whether this workspace routes edits through an approval step (§50). */
  requiresApproval: boolean
}

/** Signed-in user, or redirect to login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

/** Platform owner, or 404. */
export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/admin/login')
  if (!user.isSuperAdmin) {
    // 404 rather than 403: a non-admin should not learn that /admin exists.
    const { notFound } = await import('next/navigation')
    notFound()
  }
  return user
}

/**
 * Resolves which business the signed-in user is acting for.
 *
 * A user may belong to several businesses; the first by creation order is used
 * unless one is named. Passing an explicit `businessId` the user is not a
 * member of is treated as not-found — this is the IDOR gate for every
 * dashboard route.
 */
export async function requireBusiness(businessId?: string): Promise<BusinessContext> {
  const user = await requireUser()
  const db = getDb()

  const row = (
    businessId
      ? db
          .prepare(
            `SELECT b.id, b.name, b.slug, b.requires_approval, m.role
               FROM business_members m
               JOIN businesses b ON b.id = m.business_id
              WHERE m.user_id = ? AND m.business_id = ? AND b.deleted_at IS NULL`,
          )
          .get(user.id, businessId)
      : db
          .prepare(
            `SELECT b.id, b.name, b.slug, b.requires_approval, m.role
               FROM business_members m
               JOIN businesses b ON b.id = m.business_id
              WHERE m.user_id = ? AND b.deleted_at IS NULL
              ORDER BY m.created_at ASC
              LIMIT 1`,
          )
          .get(user.id)
  ) as Row | undefined

  if (!row) redirect('/onboarding')

  return {
    user,
    businessId: str(row, 'id'),
    businessName: str(row, 'name'),
    businessSlug: str(row, 'slug'),
    role: normalizeRole(str(row, 'role')),
    requiresApproval: toBool(row['requires_approval']),
  }
}

/**
 * Same as requireBusiness, but the caller must hold a specific capability.
 *
 * Capability rather than role rank: ranking roles on a single axis stops
 * working the moment two roles are peers with different powers, which is
 * exactly the case for Manager and Analyst. See lib/auth/permissions.ts.
 */
export async function requirePermission(
  permission: Permission,
  businessId?: string,
): Promise<BusinessContext> {
  const ctx = await requireBusiness(businessId)

  if (!can(ctx.role, permission)) {
    const { forbidden } = await import('@/lib/auth/errors')
    forbidden(`Your role (${ctx.role}) cannot ${permission.replace(':', ' ')}.`)
  }
  return ctx
}

/**
 * Super-admin acting on a specific business (impersonation-lite).
 *
 * Deliberately read-shaped and always audited by the caller — the admin sees
 * the business's data without acquiring its session, so there is no way to
 * accidentally act *as* a business user.
 */
export async function requireAdminBusiness(businessId: string): Promise<{
  admin: SessionUser
  businessId: string
  businessName: string
}> {
  const admin = await requireSuperAdmin()
  const row = getDb()
    .prepare(`SELECT id, name FROM businesses WHERE id = ? AND deleted_at IS NULL`)
    .get(businessId) as Row | undefined

  if (!row) {
    const { notFound } = await import('next/navigation')
    notFound()
  }

  // notFound() is `never`, but TS can't see that through the dynamic import.
  const found = row as Row
  return { admin, businessId: str(found, 'id'), businessName: str(found, 'name') }
}
