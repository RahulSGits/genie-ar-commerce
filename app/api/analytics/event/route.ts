import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { recordEvent } from '@/lib/db/repositories/analytics'
import { getBusinessBySlug } from '@/lib/db/repositories/businesses'

/**
 * Public analytics ingest.
 *
 * Anonymous and unauthenticated — it has to be, since the customers this
 * measures never sign in. That makes it the most exposed write in the system,
 * so it is deliberately narrow:
 *
 *   · a closed allow-list of event types (no arbitrary strings)
 *   · business resolved by public slug, never by an id the caller supplies
 *   · device fields clamped to short strings and coarse buckets
 *   · nothing identifying is accepted or stored — no IP, no UA, no fingerprint
 *
 * The worst a malicious caller can do is inflate a business's own counters,
 * which is a data-quality nuisance rather than a security or privacy breach.
 */

export const dynamic = 'force-dynamic'

const EVENT_TYPES = [
  'product_loaded',
  'viewer_3d_opened',
  'ar_clicked',
  'ar_session_started',
  'ar_object_placed',
  'cta_clicked',
] as const

const short = z.string().trim().max(24).optional().nullable()

const bodySchema = z.object({
  businessSlug: z.string().trim().min(1).max(64),
  productId: z.string().uuid().optional().nullable(),
  qrCodeId: z.string().uuid().optional().nullable(),
  eventType: z.enum(EVENT_TYPES),
  deviceType: short,
  browser: short,
  os: short,
  arTier: short,
  campaign: z.string().trim().max(64).optional().nullable(),
  sessionKey: z.string().trim().max(64).optional().nullable(),
})

export async function POST(request: NextRequest) {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const input = parsed.data
  const business = getBusinessBySlug(input.businessSlug)
  // Silent 204 for an unknown business: this endpoint should never become a
  // probe for which slugs exist.
  if (!business || business.status !== 'active') {
    return new NextResponse(null, { status: 204 })
  }

  try {
    recordEvent({
      businessId: business.id,
      productId: input.productId ?? null,
      qrCodeId: input.qrCodeId ?? null,
      eventType: input.eventType,
      deviceType: input.deviceType ?? null,
      browser: input.browser ?? null,
      os: input.os ?? null,
      arTier: input.arTier ?? null,
      campaign: input.campaign ?? null,
      sessionKey: input.sessionKey ?? null,
    })
  } catch (err) {
    console.error('[analytics] write failed', err)
    // Analytics failure must never surface to a customer mid-experience.
    return new NextResponse(null, { status: 204 })
  }

  return new NextResponse(null, { status: 204 })
}
