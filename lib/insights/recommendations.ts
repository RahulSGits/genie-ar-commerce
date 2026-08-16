import 'server-only'

import { getDb, type Row, str, num } from '@/lib/db'
import { getBusinessStats, getFunnel } from '@/lib/db/repositories/analytics'
import type { Entitlements } from '@/lib/billing/entitlements'

/**
 * Insights and recommendations (§29, §55).
 *
 * Two categories, deliberately labelled differently in the UI:
 *
 *   fact           — a count or a ratio read straight from the events table.
 *   recommendation — an inference about what to do about it.
 *
 * The distinction matters commercially. "AR engagement is 38% higher than your
 * average" is checkable; "improve the product image" is a guess. Presenting the
 * second in the same voice as the first is how an analytics product loses a
 * customer's trust the first time the guess is wrong.
 *
 * Every comparison is gated on a minimum sample. With nine scans, a product
 * that happens to have two AR launches is not "outperforming by 122%" — it is
 * noise, and reporting it as a finding would send a restaurant owner off to
 * rephotograph a dish for no reason.
 */

/** Below this, differences between products are indistinguishable from noise. */
const MIN_SAMPLE = 30

/** A gap smaller than this is not worth a business owner's attention. */
const MATERIAL_DIFFERENCE = 0.2

export type InsightKind = 'fact' | 'recommendation' | 'warning'

export type Insight = {
  id: string
  kind: InsightKind
  title: string
  body: string
  /** Where to act on it. */
  href?: string
  actionLabel?: string
  /** Set on facts: the numbers the statement was computed from. */
  evidence?: string
}

export type InsightBundle = {
  insights: Insight[]
  /** True when there is simply not enough traffic yet to say anything. */
  insufficientData: boolean
  sampleSize: number
}

export function buildInsights(
  businessId: string,
  entitlements: Entitlements,
  days = 30,
): InsightBundle {
  const db = getDb()
  const stats = getBusinessStats(businessId, days)
  const funnel = getFunnel(businessId, days)
  const insights: Insight[] = []

  // `product_loaded` is the denominator for every rate here: it is the moment
  // a real customer's phone rendered the page, which `qr_scanned` is not — a
  // scan that never finishes loading is not an audience.
  const views = funnel.product_loaded
  const arSessions = funnel.ar_session_started
  const modelViews = funnel.viewer_3d_opened
  const placements = funnel.ar_object_placed
  const ctaClicks = funnel.cta_clicked
  const sampleSize = views

  /* ── catalogue health: true regardless of traffic ─────────────────────── */

  const gaps = db
    .prepare(
      `SELECT
         SUM(CASE WHEN model_id IS NULL THEN 1 ELSE 0 END) AS no_model,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts,
         SUM(CASE WHEN image_url IS NULL THEN 1 ELSE 0 END) AS no_image
       FROM products WHERE business_id = ? AND deleted_at IS NULL`,
    )
    .get(businessId) as Row | undefined

  const noModel = num(gaps ?? {}, 'no_model')
  const drafts = num(gaps ?? {}, 'drafts')
  const noImage = num(gaps ?? {}, 'no_image')

  if (noModel > 0) {
    insights.push({
      id: 'no-model',
      kind: 'recommendation',
      title: `${noModel} product${noModel === 1 ? ' has' : 's have'} no 3D model`,
      body:
        noModel === 1
          ? 'It will show as a photo only — customers cannot open it in AR.'
          : 'They will show as photos only. AR is the reason customers scan.',
      href: '/dashboard/products',
      actionLabel: 'Add 3D models',
    })
  }

  if (drafts > 0) {
    insights.push({
      id: 'drafts',
      kind: 'warning',
      title: `${drafts} product${drafts === 1 ? '' : 's'} still in draft`,
      body: 'Drafts are invisible to customers, including through a printed QR code.',
      href: '/dashboard/products?status=draft',
      actionLabel: 'Review drafts',
    })
  }

  if (noImage > 0) {
    insights.push({
      id: 'no-image',
      kind: 'recommendation',
      title: `${noImage} product${noImage === 1 ? ' is' : 's are'} missing a photo`,
      body: 'The photo is what loads first, before the 3D model finishes downloading.',
      href: '/dashboard/products',
      actionLabel: 'Add photos',
    })
  }

  const qrless = num(
    (db
      .prepare(
        `SELECT COUNT(*) AS c FROM products p
          WHERE p.business_id = ? AND p.deleted_at IS NULL AND p.status = 'published'
            AND NOT EXISTS (SELECT 1 FROM qr_codes q
                             WHERE q.product_id = p.id AND q.deleted_at IS NULL)`,
      )
      .get(businessId) as Row) ?? {},
    'c',
  )

  if (qrless > 0) {
    insights.push({
      id: 'no-qr',
      kind: 'recommendation',
      title: `${qrless} published product${qrless === 1 ? ' has' : 's have'} no QR code`,
      body: 'A published product with no code has no way for a customer in the room to reach it.',
      href: '/dashboard/qr',
      actionLabel: 'Create QR codes',
    })
  }

  /* ── traffic-dependent findings ───────────────────────────────────────── */

  if (sampleSize < MIN_SAMPLE) {
    return {
      insights,
      insufficientData: true,
      sampleSize,
    }
  }

  const arRate = views > 0 ? arSessions / views : 0
  const ctaRate = views > 0 ? ctaClicks / views : 0

  insights.push({
    id: 'ar-rate',
    kind: 'fact',
    title: `${pct(arRate)} of visitors opened AR`,
    body:
      arRate >= 0.25
        ? 'That is strong. AR is doing the work of convincing people.'
        : arRate >= 0.1
          ? 'Roughly in line with what a clear "View in AR" button produces.'
          : 'Low. Most visitors are leaving without trying AR at all.',
    evidence: `${arSessions.toLocaleString()} AR launches from ${views.toLocaleString()} page views, last ${days} days`,
  })

  if (arSessions >= MIN_SAMPLE) {
    const completionRate = placements / arSessions
    insights.push({
      id: 'ar-completion',
      kind: 'fact',
      title: `${pct(completionRate)} of AR sessions ended with the product placed`,
      body:
        completionRate >= 0.6
          ? 'Most people who open AR successfully place the product in their space.'
          : 'Many sessions end before placement — usually poor lighting or a surface the phone cannot detect.',
      evidence: `${placements.toLocaleString()} placements from ${arSessions.toLocaleString()} AR launches`,
    })
  }

  if (arRate < 0.1 && modelViews > 0) {
    insights.push({
      id: 'ar-low',
      kind: 'recommendation',
      title: 'Few visitors are reaching AR',
      body:
        'People are viewing the 3D model but not launching AR. That usually means the AR ' +
        'button is below the fold on their phone, or their device does not support it.',
      href: '/dashboard/analytics',
      actionLabel: 'See the funnel',
    })
  }

  if (ctaClicks === 0 && views >= MIN_SAMPLE) {
    const withoutCta = num(
      (db
        .prepare(
          `SELECT COUNT(*) AS c FROM products
            WHERE business_id = ? AND deleted_at IS NULL AND status = 'published'
              AND (cta_url IS NULL OR cta_url = '')`,
        )
        .get(businessId) as Row) ?? {},
      'c',
    )

    insights.push({
      id: 'no-cta',
      kind: withoutCta > 0 ? 'recommendation' : 'warning',
      title: 'No call-to-action clicks yet',
      body:
        withoutCta > 0
          ? `${withoutCta} published product${withoutCta === 1 ? ' has' : 's have'} no action link set, so there is nothing for an interested customer to tap.`
          : 'Visitors are arriving but none have tapped through. The action may not be visible enough on a phone.',
      href: '/dashboard/products',
      actionLabel: 'Set actions',
    })
  } else if (ctaRate > 0) {
    insights.push({
      id: 'cta-rate',
      kind: 'fact',
      title: `${pct(ctaRate)} of visitors tapped your action button`,
      body: `${ctaClicks.toLocaleString()} clicks over the last ${days} days.`,
      evidence: `${ctaClicks.toLocaleString()} of ${views.toLocaleString()} page views`,
    })
  }

  /* ── per-product outliers ─────────────────────────────────────────────── */

  const perProduct = db
    .prepare(
      `SELECT p.id, p.name,
              SUM(CASE WHEN e.event_type = 'product_loaded' THEN 1 ELSE 0 END) AS views,
              SUM(CASE WHEN e.event_type = 'ar_session_started' THEN 1 ELSE 0 END) AS ar
         FROM analytics_events e
         JOIN products p ON p.id = e.product_id
        WHERE e.business_id = ? AND e.day >= date('now', ?)
        GROUP BY p.id
       HAVING views >= ?
        ORDER BY views DESC LIMIT 10`,
    )
    .all(businessId, `-${days} days`, MIN_SAMPLE) as Row[]

  if (perProduct.length >= 2) {
    const scored = perProduct.map((row) => ({
      id: str(row, 'id'),
      name: str(row, 'name'),
      views: num(row, 'views'),
      rate: num(row, 'views') > 0 ? num(row, 'ar') / num(row, 'views') : 0,
    }))

    const average = scored.reduce((sum, p) => sum + p.rate, 0) / scored.length

    const best = scored.reduce((a, b) => (b.rate > a.rate ? b : a))
    const worst = scored.reduce((a, b) => (b.rate < a.rate ? b : a))

    if (average > 0 && best.rate - average > MATERIAL_DIFFERENCE) {
      insights.push({
        id: `top-${best.id}`,
        kind: 'fact',
        title: `${best.name} is your strongest AR product`,
        body: `${pct(best.rate)} of its visitors opened AR, against ${pct(average)} across your products with enough traffic to compare.`,
        evidence: `${best.views.toLocaleString()} views, last ${days} days`,
        href: `/dashboard/products/${best.id}`,
        actionLabel: 'Open product',
      })
    }

    if (average > 0 && average - worst.rate > MATERIAL_DIFFERENCE && worst.id !== best.id) {
      insights.push({
        id: `low-${worst.id}`,
        kind: 'recommendation',
        title: `${worst.name} gets views but little AR`,
        body:
          `${pct(worst.rate)} of its visitors opened AR, against ${pct(average)} on average. ` +
          'A weak product photo or a model that loads slowly are the usual causes — both are worth checking before rewriting the description.',
        href: `/dashboard/products/${worst.id}`,
        actionLabel: 'Review product',
      })
    }
  }

  /* ── plan headroom ────────────────────────────────────────────────────── */

  const scanLimit = entitlements.limits.maxMonthlyScans
  if (scanLimit !== null && scanLimit > 0 && stats.totalScans / scanLimit > 0.8) {
    insights.push({
      id: 'scan-limit',
      kind: 'warning',
      title: 'Approaching your monthly scan limit',
      body: `${stats.totalScans.toLocaleString()} of ${scanLimit.toLocaleString()} scans used. Public pages stop serving once the limit is reached.`,
      href: '/dashboard/billing',
      actionLabel: 'Review plan',
    })
  }

  return { insights, insufficientData: false, sampleSize }
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`
}
