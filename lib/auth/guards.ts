import 'server-only'

import { redirect } from 'next/navigation'
import { getDb, type Row, str } from '@/lib/db'
import { getSessionUser, type SessionUser } from '@/lib/auth/session'

/**
 * Server-side authorization guards.
 *
 * These are the primary access control in the system — not the UI, not route
 * naming. A hidden nav link is not security; every server entry point that
 * touches tenant data calls one of these first, and every repository read then
 * takes the resolved businessId explicitly.
 */

export type BusinessRole = 'owner' | 'admin' | 'member'

export type BusinessContext = {
  user: SessionUser
  businessId: string
  businessName: string
  businessSlug: string
  role: BusinessRole
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
            `SELECT b.id, b.name, b.slug, m.role
               FROM business_members m
               JOIN businesses b ON b.id = m.business_id
              WHERE m.user_id = ? AND m.business_id = ? AND b.deleted_at IS NULL`,
          )
          .get(user.id, businessId)
      : db
          .prepare(
            `SELECT b.id, b.name, b.slug, m.role
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
    role: (str(row, 'role') || 'member') as BusinessRole,
  }
}

/**
 * Same as requireBusiness but additionally demands a minimum role.
 * owner > admin > member.
 */
export async function requireBusinessRole(
  minimum: BusinessRole,
  businessId?: string,
): Promise<BusinessContext> {
  const ctx = await requireBusiness(businessId)
  const rank: Record<BusinessRole, number> = { member: 1, admin: 2, owner: 3 }

  if (rank[ctx.role] < rank[minimum]) {
    const { forbidden } = await import('@/lib/auth/errors')
    forbidden(`This action requires the ${minimum} role.`)
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
