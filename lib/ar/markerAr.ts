/**
 * AR.js — optional marker/image-tracked AR module.
 *
 * NOT the primary AR engine, deliberately. The core product journey is
 * "place this dish on the customer's own table", which is surface-anchored
 * placement — model-viewer's WebXR / Scene Viewer / Quick Look paths do that
 * natively and with real world tracking.
 *
 * AR.js solves a different problem: anchoring content to a *specific printed
 * image*. That unlocks campaigns model-viewer cannot do, e.g.
 *
 *   · point the phone at the printed menu → the dish rises off the page
 *   · point at product packaging → an animated brand experience plays
 *   · point at a poster → a promo unlocks
 *
 * The dependency is installed and this module is the seam for it. It stays
 * behind the `marker_ar` feature flag and is dynamically imported, so its
 * bundle cost is never paid by the ordinary product page.
 */

import type { PublicArProduct } from '@/types/ar'

export type MarkerArSupport = {
  supported: boolean
  reason?: string
}

/**
 * Marker AR needs a camera and a secure context — the same constraints as any
 * getUserMedia feature. It does NOT need WebXR or ARCore, which is precisely
 * why it reaches devices the surface-tracking paths cannot.
 */
export function checkMarkerArSupport(): MarkerArSupport {
  if (typeof window === 'undefined') return { supported: false, reason: 'server' }

  const secure =
    window.isSecureContext ||
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

  if (!secure) {
    return { supported: false, reason: 'Marker AR needs an https connection to use the camera.' }
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { supported: false, reason: 'This browser does not expose a camera to web pages.' }
  }
  return { supported: true }
}

export type MarkerArConfig = {
  product: PublicArProduct
  /** '.patt' marker file, or an NFT image descriptor set. */
  markerUrl: string
  markerType: 'pattern' | 'barcode' | 'nft'
  container: HTMLElement
}

export type MarkerArSession = {
  stop: () => void
}

/**
 * Starts a marker-tracked AR session.
 *
 * AR.js is imported dynamically here — it registers A-Frame components and
 * touches `window` at module scope, so it can neither be server-rendered nor
 * bundled into the main chunk.
 *
 * Currently throws: enabling this needs marker assets (a `.patt` file or NFT
 * descriptor set) generated per campaign from the printed artwork, which is a
 * per-customer onboarding step rather than something the platform can
 * synthesise. The integration point is here and typed; what is missing is the
 * asset pipeline, not the code path.
 */
export async function startMarkerArSession(
  config: MarkerArConfig,
): Promise<MarkerArSession> {
  const support = checkMarkerArSupport()
  if (!support.supported) {
    throw new Error(support.reason ?? 'Marker AR is not supported here.')
  }
  if (!config.product.model?.glbUrl) {
    throw new Error('This product has no 3D model to anchor.')
  }

  throw new Error(
    'Marker AR is not enabled yet. It needs a marker asset generated from the printed ' +
      'artwork for this campaign. See docs/ar.md → "Marker AR (AR.js)".',
  )
}

/** Feature-flag key checked before any of the above is offered in the UI. */
export const MARKER_AR_FLAG = 'marker_ar' as const
