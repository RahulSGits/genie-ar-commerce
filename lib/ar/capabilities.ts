import type { ArTier } from '@/types/ar'

/**
 * Device/AR capability reporting.
 *
 * Since model-viewer became the primary AR surface, it owns the *decision* of
 * which AR path to take — `canActivateAR` is the authoritative answer, and it
 * accounts for things the web cannot otherwise detect (whether ARCore is
 * actually installed, whether Quick Look will really launch).
 *
 * What remains here is the *labelling* problem: analytics needs a coarse tier
 * to segment on, and the UI needs honest wording. Neither may claim more than
 * the device can do.
 */

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as MacIntel; touch points separate it from a real Mac.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/.test(navigator.userAgent)
}

/** getUserMedia and WebXR both require a secure context outside localhost. */
export function isSecureForAr(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

/**
 * Best-effort tier for analytics segmentation, resolved before model-viewer has
 * loaded. Treat it as a hint: the authoritative answer is `canActivateAR`.
 */
export async function probeArTier(assets: {
  hasGlb: boolean
  hasUsdz: boolean
}): Promise<ArTier> {
  if (!isSecureForAr()) return 'viewer'

  if (isIOS()) {
    // Quick Look is the only real AR path on iOS, and it needs a USDZ.
    return assets.hasUsdz && supportsQuickLook() ? 'quicklook' : 'viewer'
  }

  let hasWebXr = false
  try {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr
    if (xr?.isSessionSupported) hasWebXr = await xr.isSessionSupported('immersive-ar')
  } catch {
    hasWebXr = false
  }

  if (hasWebXr && assets.hasGlb) return 'webxr'
  // Android without WebXR can still hand off to Scene Viewer, but whether
  // ARCore is installed is undetectable from the web — so this stays a guess
  // until model-viewer reports back.
  if (isAndroid() && assets.hasGlb) return 'sceneviewer'
  return 'viewer'
}

/** Safari signals Quick Look by recognising the `ar` rel token. */
export function supportsQuickLook(): boolean {
  if (typeof document === 'undefined') return false
  const a = document.createElement('a')
  if (!a.relList?.supports) return false
  try {
    return a.relList.supports('ar') && isIOS()
  } catch {
    return false
  }
}

/** Coarse, non-identifying buckets for analytics. Never a full UA string. */
export function deviceProfile(): { deviceType: string; browser: string; os: string } {
  if (typeof navigator === 'undefined') {
    return { deviceType: 'unknown', browser: 'unknown', os: 'unknown' }
  }
  const ua = navigator.userAgent

  const deviceType = /Mobi|Android|iPhone|iPod/.test(ua)
    ? 'mobile'
    : /iPad|Tablet/.test(ua)
      ? 'tablet'
      : 'desktop'

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : 'Other'

  const os = isIOS()
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Other'

  return { deviceType, browser, os }
}

/**
 * User-facing copy per tier. Worded so nothing promises world tracking the
 * device may not have.
 */
export const TIER_COPY: Record<ArTier, { label: string; detail: string }> = {
  quicklook: {
    label: 'AR',
    detail: 'Opens in your iPhone’s AR viewer with full surface detection.',
  },
  sceneviewer: {
    label: 'AR',
    detail: 'Opens in Google’s AR viewer with full surface detection.',
  },
  webxr: {
    label: 'AR',
    detail: 'Detects real surfaces — walk around the product and it stays put.',
  },
  camera: {
    label: 'Camera preview',
    detail: 'Shows the product over your camera without full surface tracking.',
  },
  viewer: {
    label: '3D',
    detail: 'Interactive 3D preview — rotate, zoom and inspect from any angle.',
  },
}
