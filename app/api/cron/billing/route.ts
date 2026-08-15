import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { runBillingTick } from '@/lib/billing/engine'

/**
 * Scheduled trigger for the billing engine.
 *
 * Three ways in, all calling the same idempotent tick:
 *   · this endpoint (Vercel Cron, GitHub Actions, any external scheduler)
 *   · `npm run billing:tick` for a local or SSH-driven run
 *   · opportunistically on admin dashboard render, as the floor
 *
 * AUTH: a bearer token compared in constant time. Without CRON_SECRET set the
 * endpoint refuses every request rather than defaulting to open — an unguarded
 * endpoint that raises invoices is not something to leave to configuration.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided.length === 0) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  // timingSafeEqual throws on a length mismatch, which would itself leak length.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    // 404 rather than 401: an unauthenticated caller should not learn that a
    // billing endpoint exists here at all.
    return new NextResponse(null, { status: 404 })
  }

  try {
    const report = runBillingTick()
    console.info('[cron/billing]', JSON.stringify(report))
    return NextResponse.json(report)
  } catch (err) {
    console.error('[cron/billing] failed', err)
    return NextResponse.json({ error: 'Billing tick failed.' }, { status: 500 })
  }
}

// Some schedulers only issue POST.
export const POST = GET
