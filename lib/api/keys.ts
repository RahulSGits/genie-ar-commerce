import 'server-only'

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getDb, now, uuid, type Row, str, num, parseJson, toJson, param } from '@/lib/db'

/**
 * API keys for the public API.
 *
 * Only the SHA-256 of a key is stored, exactly as with session tokens: a
 * database dump — or a support engineer with read access — yields nothing that
 * can be replayed against the API. The plaintext exists once, in the HTTP
 * response that created it, and is unrecoverable afterwards.
 *
 * A plain hash (not scrypt) is correct here and not an oversight. API keys are
 * 256 bits of CSPRNG output with no human-memorable structure, so there is no
 * dictionary to attack and nothing for a slow KDF to defend against — while a
 * slow KDF on every API request would make rate limiting the least of the
 * platform's problems.
 */

export type ApiScope =
  | 'products:read'
  | 'products:write'
  | 'generation:run'
  | 'qr:read'
  | 'qr:write'
  | 'analytics:read'

export const API_SCOPES: ApiScope[] = [
  'products:read',
  'products:write',
  'generation:run',
  'qr:read',
  'qr:write',
  'analytics:read',
]

export const SCOPE_LABELS: Record<ApiScope, string> = {
  'products:read': 'Read products',
  'products:write': 'Create and update products',
  'generation:run': 'Start 3D generation (consumes credits)',
  'qr:read': 'Read QR codes',
  'qr:write': 'Create and update QR codes',
  'analytics:read': 'Read analytics',
}

export type ApiKey = {
  id: string
  businessId: string
  name: string
  prefix: string
  scopes: ApiScope[]
  lastUsedAt: string | null
  requestCount: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

const PREFIX = 'gk_live_'

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/* ── issue ──────────────────────────────────────────────────────────────── */

export type IssuedKey = { key: ApiKey; /** Shown once. Never stored. */ token: string }

export function createApiKey(input: {
  businessId: string
  name: string
  scopes: ApiScope[]
  createdBy?: string | null
  expiresAt?: string | null
}): IssuedKey {
  // 32 bytes → 43 base64url chars. base64url and not hex so the key is short
  // enough to paste into a header without wrapping.
  const secret = randomBytes(32).toString('base64url')
  const token = `${PREFIX}${secret}`
  const prefix = token.slice(0, 16)

  const id = uuid()
  const timestamp = now()
  const scopes = input.scopes.filter((s) => API_SCOPES.includes(s))

  getDb()
    .prepare(
      `INSERT INTO api_keys (id, business_id, name, prefix, token_hash, scopes,
                             expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.businessId,
      input.name,
      prefix,
      hash(token),
      toJson(scopes) ?? '[]',
      param(input.expiresAt ?? null),
      param(input.createdBy ?? null),
      timestamp,
    )

  return {
    token,
    key: {
      id,
      businessId: input.businessId,
      name: input.name,
      prefix,
      scopes,
      lastUsedAt: null,
      requestCount: 0,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      createdAt: timestamp,
    },
  }
}

/* ── verify ─────────────────────────────────────────────────────────────── */

export type VerifiedKey = { keyId: string; businessId: string; scopes: ApiScope[] }

export type VerifyFailure =
  | 'missing'
  | 'malformed'
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'business_inactive'

/**
 * Resolves an `Authorization: Bearer <token>` header to a business.
 *
 * Returns a discriminated result rather than throwing, so a route handler
 * chooses the status code and the caller never gets a stack trace. The failure
 * reason is deliberately NOT echoed to the client verbatim — distinguishing
 * "unknown key" from "revoked key" tells an attacker which guesses landed.
 */
export function verifyApiKey(header: string | null):
  | { ok: true; key: VerifiedKey }
  | { ok: false; reason: VerifyFailure } {
  if (!header) return { ok: false, reason: 'missing' }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  if (!token || !token.startsWith(PREFIX)) return { ok: false, reason: 'malformed' }

  const digest = hash(token)
  const row = getDb()
    .prepare(
      `SELECT k.id, k.business_id, k.token_hash, k.scopes, k.revoked_at, k.expires_at,
              b.status AS business_status
         FROM api_keys k
         JOIN businesses b ON b.id = k.business_id
        WHERE k.token_hash = ? AND b.deleted_at IS NULL`,
    )
    .get(digest) as Row | undefined

  if (!row) return { ok: false, reason: 'unknown' }

  // The lookup already matched on the hash, so this comparison is belt-and-
  // braces — but it costs nothing and keeps the comparison constant-time if
  // the lookup is ever loosened to a prefix scan.
  const stored = Buffer.from(str(row, 'token_hash'), 'utf8')
  const given = Buffer.from(digest, 'utf8')
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) {
    return { ok: false, reason: 'unknown' }
  }

  if (row['revoked_at']) return { ok: false, reason: 'revoked' }

  const expiresAt = row['expires_at']
  if (typeof expiresAt === 'string' && expiresAt !== '' && expiresAt <= now()) {
    return { ok: false, reason: 'expired' }
  }

  // A suspended business's keys stop working. Without this, cancelling an
  // account would close the dashboard and leave the API wide open.
  if (str(row, 'business_status') !== 'active') return { ok: false, reason: 'business_inactive' }

  return {
    ok: true,
    key: {
      keyId: str(row, 'id'),
      businessId: str(row, 'business_id'),
      scopes: parseJson<ApiScope[]>(row['scopes'], []),
    },
  }
}

/** Fire-and-forget usage stamp. Never blocks or fails a request. */
export function touchApiKey(keyId: string): void {
  try {
    getDb()
      .prepare(`UPDATE api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE id = ?`)
      .run(now(), keyId)
  } catch {
    // Usage accounting must never be the reason an API call fails.
  }
}

/* ── manage ─────────────────────────────────────────────────────────────── */

export function listApiKeys(businessId: string): ApiKey[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM api_keys WHERE business_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC`,
    )
    .all(businessId) as Row[]
  return rows.map(mapKey)
}

export function revokeApiKey(businessId: string, keyId: string): void {
  getDb()
    .prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND business_id = ? AND revoked_at IS NULL`)
    .run(now(), keyId, businessId)
}

function mapKey(row: Row): ApiKey {
  return {
    id: str(row, 'id'),
    businessId: str(row, 'business_id'),
    name: str(row, 'name'),
    prefix: str(row, 'prefix'),
    scopes: parseJson<ApiScope[]>(row['scopes'], []),
    lastUsedAt: typeof row['last_used_at'] === 'string' ? row['last_used_at'] : null,
    requestCount: num(row, 'request_count'),
    expiresAt: typeof row['expires_at'] === 'string' ? row['expires_at'] : null,
    revokedAt: typeof row['revoked_at'] === 'string' ? row['revoked_at'] : null,
    createdAt: str(row, 'created_at'),
  }
}
