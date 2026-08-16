/**
 * API scopes — the client-safe half of the API key module.
 *
 * Deliberately NOT `server-only`, and deliberately separate from
 * lib/api/keys.ts, which is. The scope-picker UI is a client component and
 * needs this list; importing it from the server-only module pulls
 * `node:crypto` and the database into the browser bundle, which fails the
 * build. Splitting the constants out is the fix, and it is the same shape as
 * lib/webhooks/events.ts for the same reason.
 *
 * Nothing here is a secret. The names of the permissions a key can hold are
 * public API surface — they appear in the docs and in every 403 response.
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

/**
 * An API key as the dashboard sees it.
 *
 * There is no field here for the key itself — the server stores only a
 * SHA-256 hash, so there is nothing to send. `prefix` is what identifies a key
 * in a list.
 */
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
