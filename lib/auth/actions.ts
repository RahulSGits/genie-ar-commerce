'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb, now, uuid, type Row, str, toBool } from '@/lib/db'
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/auth/password'
import { createSession, destroySession, sweepExpiredSessions } from '@/lib/auth/session'
import { requireUser } from '@/lib/auth/guards'
import {
  addMember, createBusiness, createSubscription, listBusinessesForUser,
  listPlans, slugAvailable,
} from '@/lib/db/repositories/businesses'
import { recordAudit } from '@/lib/db/repositories/platform'
import { slugify } from '@/lib/utils'
import { BUSINESS_CATEGORIES } from '@/config/terminology'
import type { ActionResult } from '@/lib/auth/errors'

/**
 * Authentication server actions.
 *
 * Deliberately uniform failure messages on sign-in: distinguishing "no such
 * account" from "wrong password" turns the login form into an account
 * enumeration oracle.
 */

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

export async function signIn(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details.' }
  }

  const wantsAdmin = formData.get('admin') === 'true'
  const { email, password } = parsed.data

  const row = getDb()
    .prepare(
      `SELECT id, password_hash, is_super_admin FROM users
        WHERE lower(email) = ? AND deleted_at IS NULL`,
    )
    .get(email) as Row | undefined

  // Always run a verification, even when no user matched, so the response time
  // does not reveal whether the address exists.
  const hash = row ? str(row, 'password_hash') : '$dummy$'
  const valid = await verifyPassword(password, hash)

  if (!row || !valid) {
    return { ok: false, error: 'Email or password is incorrect.' }
  }

  const isSuperAdmin = toBool(row.is_super_admin)
  if (wantsAdmin && !isSuperAdmin) {
    // Same message again — a business user probing /admin/login learns nothing.
    return { ok: false, error: 'Email or password is incorrect.' }
  }

  sweepExpiredSessions()
  await createSession(str(row, 'id'))

  recordAudit({
    actorId: str(row, 'id'),
    actorEmail: email,
    action: 'auth.sign_in',
    entityType: 'user',
    entityId: str(row, 'id'),
  })

  redirect(isSuperAdmin && wantsAdmin ? '/admin' : '/dashboard')
}

export async function signOut(): Promise<void> {
  await destroySession()
  redirect('/login')
}

const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string(),
  businessName: z.string().trim().min(2, 'Enter your business name.').max(80),
  category: z.enum(BUSINESS_CATEGORIES),
})

/**
 * Creates the user, their business, membership and a trial subscription in one
 * transaction — a half-created tenant would be unusable and hard to repair.
 */
export async function signUp(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    businessName: formData.get('businessName'),
    category: formData.get('category'),
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? 'Check your details.', field: String(issue?.path[0] ?? '') }
  }

  const { fullName, email, password, businessName, category } = parsed.data

  const strength = validatePasswordStrength(password)
  if (!strength.ok) return { ok: false, error: strength.error, field: 'password' }

  const db = getDb()
  const existing = db
    .prepare(`SELECT id FROM users WHERE lower(email) = ? AND deleted_at IS NULL`)
    .get(email) as Row | undefined
  if (existing) {
    return { ok: false, error: 'An account with that email already exists.', field: 'email' }
  }

  // Slug collisions are resolved by suffixing rather than rejecting the signup.
  let slug = slugify(businessName)
  if (!slug) slug = `business-${Date.now().toString(36)}`
  let attempt = slug
  let n = 1
  while (!slugAvailable(attempt)) attempt = `${slug}-${++n}`

  const passwordHash = await hashPassword(password)
  const plans = listPlans({ publicOnly: true })
  const starter = plans[0]

  const userId = uuid()
  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, is_super_admin, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
    ).run(userId, email, passwordHash, fullName, now(), now())

    const businessId = createBusiness({ name: businessName, slug: attempt, category, email })
    addMember(businessId, userId, 'owner')

    if (starter) {
      createSubscription({
        businessId,
        planId: starter.id,
        status: 'trialing',
        trialDays: starter.trialDays,
      })
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[signup]', err)
    return { ok: false, error: 'Could not create your account. Please try again.' }
  }

  await createSession(userId)
  redirect('/dashboard')
}

/**
 * Creates the business for a user who has an account but no tenant — the state
 * `requireBusiness()` redirects to. Kept separate from `signUp` because a user
 * can legitimately arrive here later (invited, or a failed first attempt).
 */
export async function completeOnboardingAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await requireUser()

  const parsed = z
    .object({
      businessName: z.string().trim().min(2, 'Enter your business name.').max(80),
      category: z.enum(BUSINESS_CATEGORIES),
      city: z.string().trim().max(80).optional().nullable(),
    })
    .safeParse({
      businessName: formData.get('businessName'),
      category: formData.get('category'),
      city: formData.get('city') || null,
    })

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue?.message ?? 'Check your details.',
      field: String(issue?.path[0] ?? ''),
    }
  }

  // Guard against a double submit creating a second tenant.
  if (listBusinessesForUser(user.id).length > 0) redirect('/dashboard')

  const { businessName, category, city } = parsed.data

  let base = slugify(businessName) || `business-${Date.now().toString(36)}`
  let slug = base
  let n = 1
  while (!slugAvailable(slug)) slug = `${base}-${++n}`

  const plans = listPlans({ publicOnly: true })
  const starter = plans[0]

  const db = getDb()
  db.exec('BEGIN')
  try {
    const businessId = createBusiness({
      name: businessName,
      slug,
      category,
      email: user.email,
      city,
    })
    addMember(businessId, user.id, 'owner')
    if (starter) {
      createSubscription({
        businessId,
        planId: starter.id,
        status: 'trialing',
        trialDays: starter.trialDays,
      })
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    console.error('[onboarding]', err)
    return { ok: false, error: 'Could not create your business. Please try again.' }
  }

  redirect('/dashboard')
}
