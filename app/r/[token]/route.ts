import { NextResponse, type NextRequest } from 'next/server'
import { resolveQrToken, recordScan } from '@/lib/db/repositories/qr'
import { recordEvent } from '@/lib/db/repositories/analytics'

/**
 * QR redirect layer.
 *
 * Every printed code points here — `/r/<token>` — never directly at a product
 * URL. That indirection is what lets a business re-point, rename or deactivate
 * a code without reprinting anything that's already stuck to a table.
 *
 * Anonymous by design: no session, no account, no cookie required. The token
 * is the only credential, and it is unguessable rather than an enumerable id.
 */

export const dynamic = 'force-dynamic'

/** Coarse device bucketing from the UA. Never stored raw — buckets only. */
function classify(userAgent: string): { deviceType: string; browser: string; os: string } {
  const deviceType = /Mobi|Android|iPhone|iPod/.test(userAgent)
    ? 'mobile'
    : /iPad|Tablet/.test(userAgent)
      ? 'tablet'
      : 'desktop'

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Other'

  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Other'

  return { deviceType, browser, os }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const origin = request.nextUrl.origin

  // Reject anything that isn't token-shaped before touching the database.
  if (!/^[0-9a-z]{8,64}$/.test(token)) {
    return NextResponse.redirect(new URL('/qr-not-found', origin))
  }

  const resolved = resolveQrToken(token)
  if (!resolved) {
    // Covers unknown, deactivated, deleted, and suspended-business codes alike —
    // the visitor gets one friendly page and learns nothing about which it was.
    return NextResponse.redirect(new URL('/qr-not-found', origin))
  }

  const { qr, businessSlug, productSlug, businessWebsite, businessMenuUrl } = resolved
  const ua = request.headers.get('user-agent') ?? ''
  const { deviceType, browser, os } = classify(ua)

  // Fire-and-forget: a failed analytics write must never block the redirect.
  try {
    recordScan(qr.id)
    recordEvent({
      businessId: qr.businessId,
      productId: qr.productId,
      qrCodeId: qr.id,
      eventType: 'qr_scanned',
      deviceType,
      browser,
      os,
      campaign: qr.campaign,
      // Per-scan, not per-person: enough to join a funnel, useless for tracking.
      sessionKey: crypto.randomUUID(),
    })
  } catch (err) {
    console.error('[qr] analytics write failed', err)
  }

  const destination = (() => {
    switch (qr.destination) {
      case 'ar':
      case 'product':
        return productSlug
          ? `/ar/${businessSlug}/${productSlug}`
          : `/ar/${businessSlug}`
      case 'menu':
        return businessMenuUrl ?? `/ar/${businessSlug}`
      case 'website':
        return businessWebsite ?? `/ar/${businessSlug}`
      case 'custom':
        return qr.customUrl ?? `/ar/${businessSlug}`
      default:
        return `/ar/${businessSlug}`
    }
  })()

  // Relative destinations resolve against our origin; absolute ones (the
  // business's own site) pass through untouched.
  const target = destination.startsWith('http')
    ? destination
    : new URL(`${destination}?src=qr&qr=${qr.id}`, origin).toString()

  // 307 rather than 308: the mapping is intentionally mutable, so it must never
  // be cached permanently by a browser or intermediary.
  return NextResponse.redirect(target, 307)
}
