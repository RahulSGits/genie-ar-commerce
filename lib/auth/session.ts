import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { getDb, now, uuid, type Row, str, toBool } from '@/lib/db'

/**
 * Session management.
 *
 * The cookie carries a 256-bit random token. Only its SHA-256 is stored, so a
 * database dump does not yield usable sessions — the same reasoning as password
 * hashing, applied to bearer tokens.
 */

const COOKIE_NAME = 'arview_session'
const SESSION_DAYS = 30

export type SessionUser = {
  id: string
  email: string
  fullName: string
  avatarUrl: string | null
  isSuperAdmin: boolean
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const db = getDb()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(uuid(), userId, hashToken(token), userAgent ?? null, expiresAt, now())

  db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(now(), userId)

  const store = await cookies()
  store.set(COOKIE_NAME, token, {
    httpOnly: true, // unreadable from JS — blunts XSS session theft
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // survives the QR → external → back navigation, blocks CSRF POSTs
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value

  if (token) {
    getDb().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token))
  }
  store.delete(COOKIE_NAME)
}

/**
 * Resolves the signed-in user, or null. Never throws — callers that require a
 * user use the guards in lib/auth/guards.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null

  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.avatar_url, u.is_super_admin, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND u.deleted_at IS NULL`,
    )
    .get(hashToken(token)) as Row | undefined

  if (!row) return null

  // Expiry is checked here rather than only by a cleanup job, so a stale cookie
  // is never honoured even if sweeping has not run.
  if (str(row, 'expires_at') < now()) {
    getDb().prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token))
    return null
  }

  return {
    id: str(row, 'id'),
    email: str(row, 'email'),
    fullName: str(row, 'full_name'),
    avatarUrl: (row.avatar_url as string | null) ?? null,
    isSuperAdmin: toBool(row.is_super_admin),
  }
}

/** Removes expired rows. Called opportunistically on login. */
export function sweepExpiredSessions(): void {
  getDb().prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now())
}
