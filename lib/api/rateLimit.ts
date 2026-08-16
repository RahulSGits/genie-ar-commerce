import 'server-only'

import { getDb } from '@/lib/db'

/**
 * Fixed-window rate limiting, backed by the database.
 *
 * Not an in-process Map. Next.js runs many instances — locally that is one
 * process, in production it is however many the platform decides to start — and
 * an in-memory counter silently multiplies the effective limit by that number.
 * A limiter that stops working exactly when traffic arrives is worse than none,
 * because it reports success while permitting everything.
 *
 * The window is fixed rather than sliding: a sliding log needs a row per
 * request, which turns the abuse-protection mechanism into its own abuse
 * vector. The cost is that a caller can burst across a window boundary, which
 * for API quota enforcement is an acceptable factor of two.
 */

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  /** Unix seconds when the current window resets. */
  resetAt: number
  /** Seconds to wait, for the Retry-After header. Only when blocked. */
  retryAfter: number
}

export type RateLimitRule = { limit: number; windowSeconds: number }

/**
 * Named rules, so limits are declared in one place rather than sprinkled
 * through route handlers as magic numbers.
 */
export const RATE_LIMITS = {
  /** General API traffic. */
  api: { limit: 120, windowSeconds: 60 },
  /** Generation costs real money per call, so it is capped far harder. */
  generation: { limit: 10, windowSeconds: 3600 },
  /** Public analytics ingest — one page-load fires several events. */
  ingest: { limit: 60, windowSeconds: 60 },
  /** Credential endpoints, keyed by IP. */
  auth: { limit: 10, windowSeconds: 900 },
  /** Outbound-cost endpoints a signed-out visitor can reach. */
  publicWrite: { limit: 20, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitName = keyof typeof RATE_LIMITS

export function checkRateLimit(
  name: RateLimitName,
  identifier: string,
  overrides?: Partial<RateLimitRule>,
): RateLimitResult {
  const rule = RATE_LIMITS[name]
  const limit = overrides?.limit ?? rule.limit
  const windowSeconds = overrides?.windowSeconds ?? rule.windowSeconds

  const seconds = Math.floor(Date.now() / 1000)
  const windowStart = seconds - (seconds % windowSeconds)
  const resetAt = windowStart + windowSeconds
  const bucket = `${name}:${identifier}`

  const db = getDb()

  // One statement, so two concurrent requests cannot both read N and both
  // write N+1. `excluded` is the row that would have been inserted.
  const row = db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, count)
       VALUES (?, ?, 1)
       ON CONFLICT (bucket, window_start)
       DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .get(bucket, windowStart) as { count?: number } | undefined

  const count = typeof row?.count === 'number' ? row.count : 1

  // Opportunistic cleanup. Rows from windows two full periods old can never be
  // read again; sweeping ~1% of the time keeps the table flat without a cron.
  if (count === 1 && Math.random() < 0.01) {
    try {
      db.prepare(`DELETE FROM rate_limits WHERE window_start < ?`).run(windowStart - windowSeconds * 2)
    } catch {
      // Housekeeping must never fail a request.
    }
  }

  const allowed = count <= limit
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfter: allowed ? 0 : Math.max(1, resetAt - seconds),
  }
}

/** Standard headers so a client can back off without guessing. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  }
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfter)
  return headers
}

/**
 * Best-effort client address.
 *
 * Only trusted where the platform sets it — `x-forwarded-for` is client-
 * supplied and trivially spoofed, so this is used for rate limiting (where the
 * worst case is a wasted bucket) and never for authorization or for anything
 * that gets stored against a person.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || headers.get('x-real-ip') || 'unknown'
}
