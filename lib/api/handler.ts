import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { verifyApiKey, touchApiKey, type ApiScope, type VerifiedKey } from '@/lib/api/keys'
import { checkRateLimit, rateLimitHeaders, type RateLimitName } from '@/lib/api/rateLimit'
import { getEntitlements } from '@/lib/db/repositories/businesses'
import { isFeatureEnabled } from '@/lib/db/repositories/platform'

/**
 * The single entry path for every public API route.
 *
 * Authentication, scope checking, plan entitlement and rate limiting all happen
 * here rather than in each handler. Six routes each doing their own auth is six
 * chances to forget one, and the one that gets forgotten is never the one
 * anyone reviews.
 */

export type ApiContext<P = Record<string, never>> = {
  key: VerifiedKey
  businessId: string
  request: NextRequest
  /** Resolved dynamic route segments, e.g. `{ id }` for /products/[id]. */
  params: P
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'rate_limited'
  | 'plan_required'
  | 'server_error'

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 422,
  rate_limited: 429,
  plan_required: 402,
  server_error: 500,
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status: STATUS[code] })
}

export function apiOk(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init)
}

/**
 * Wraps a route handler with auth, scope, entitlement and rate limiting.
 *
 * `api_access` is a plan feature, so the API is not a back door around the
 * plan the customer is paying for: a Starter key authenticates correctly and
 * is then refused with 402 and a message naming the reason.
 */
export function withApiKey<P = Record<string, never>>(
  scope: ApiScope,
  handler: (ctx: ApiContext<P>) => Promise<NextResponse>,
  opts: { rateLimit?: RateLimitName } = {},
) {
  // Next 15 hands dynamic segments to the second argument as a Promise, so the
  // wrapper has to accept and await it rather than ignore it — otherwise every
  // `[id]` route would have to re-implement auth to get at its own id.
  return async (
    request: NextRequest,
    context?: { params: Promise<P> },
  ): Promise<NextResponse> => {
    const verified = verifyApiKey(request.headers.get('authorization'))

    if (!verified.ok) {
      // Deliberately one message for every failure mode. Distinguishing
      // "unknown key" from "revoked key" tells an attacker which guesses hit.
      return apiError('unauthorized', 'Invalid or missing API key.')
    }

    const { key } = verified

    if (!key.scopes.includes(scope)) {
      return apiError('forbidden', `This key does not have the "${scope}" scope.`, {
        requiredScope: scope,
      })
    }

    const limitName: RateLimitName = opts.rateLimit ?? 'api'
    const limit = checkRateLimit(limitName, key.businessId)
    const headers = rateLimitHeaders(limit)

    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: `Rate limit exceeded. Retry in ${limit.retryAfter}s.`,
          },
        },
        { status: 429, headers },
      )
    }

    const entitlements = getEntitlements(key.businessId)

    if (!entitlements.isActive) {
      return apiError('plan_required', 'This workspace’s subscription is not active.')
    }
    if (!entitlements.features.api_access) {
      return apiError('plan_required', 'The API is not included in your current plan.', {
        plan: entitlements.planName,
      })
    }
    if (!isFeatureEnabled('public_api')) {
      return apiError('forbidden', 'The public API is currently disabled on this deployment.')
    }

    touchApiKey(key.keyId)

    try {
      const params = ((await context?.params) ?? {}) as P
      const response = await handler({ key, businessId: key.businessId, request, params })
      for (const [header, value] of Object.entries(headers)) response.headers.set(header, value)
      return response
    } catch (err) {
      // Never leak an internal message or stack to an API consumer.
      console.error('[api]', request.nextUrl.pathname, err)
      return apiError('server_error', 'Something went wrong handling this request.')
    }
  }
}

/** Parses a JSON body, returning a typed failure rather than throwing. */
export async function readJson(
  request: NextRequest,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { ok: false, response: apiError('invalid_request', 'Body must be a JSON object.') }
    }
    return { ok: true, body: body as Record<string, unknown> }
  } catch {
    return { ok: false, response: apiError('invalid_request', 'Body is not valid JSON.') }
  }
}

/** Clamps a `?limit=` query parameter into a sane range. */
export function pageLimit(request: NextRequest, fallback = 50, max = 200): number {
  const raw = Number(request.nextUrl.searchParams.get('limit'))
  if (!Number.isFinite(raw) || raw <= 0) return fallback
  return Math.min(Math.floor(raw), max)
}
