/**
 * A real WebXR immersive-AR session.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR, AND THE PLATFORM FACT THAT SHAPES IT
 *
 * The brief asks for a full-screen camera experience with GENIE's own overlay:
 * "move your phone slowly", "surface detected", "tap to place", then rotate /
 * scale / move controls and a CTA — all drawn over the live camera.
 *
 * That is only possible on WebXR, which today means Android Chrome with ARCore.
 * On iOS there is no WebXR: Safari's only AR path is AR Quick Look, which is an
 * OS handoff. Apple renders the entire experience, and a web page cannot draw
 * over it, read its hit tests, or know whether the user placed anything. That
 * is a platform boundary, not a gap in this implementation, and it is why the
 * iOS path keeps model-viewer's Quick Look handoff and says plainly that the
 * in-page controls are not available there.
 *
 * So: this module is the Android/WebXR engine. `components/ar/ArExperience`
 * picks between it, Quick Look and the 3D viewer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type XrPhase =
  | 'idle'
  | 'requesting'
  | 'scanning'
  | 'ready-to-place'
  | 'placed'
  | 'ended'
  | 'failed'

export type XrFailure =
  | 'unsupported'
  | 'permission-denied'
  | 'insecure-context'
  | 'no-gesture'
  | 'session-failed'
  | 'model-failed'

export type XrCapabilityReport = {
  supported: boolean
  /** Hit testing is what makes placement real rather than guessed. */
  hitTest: boolean
  /** Anchors keep an object pinned as tracking refines. Not on every device. */
  anchors: boolean
  /** DOM overlay is what lets GENIE draw its own UI over the camera. */
  domOverlay: boolean
  /** Real-world lighting applied to the model. */
  lightEstimation: boolean
  /** Occlusion by real geometry. Rare — most devices cannot do this. */
  depthSensing: boolean
  reason?: string
}

const OPTIONAL_FEATURES = [
  'hit-test',
  'dom-overlay',
  'anchors',
  'light-estimation',
  'depth-sensing',
] as const

/**
 * What this device can actually do.
 *
 * Deliberately probes each optional feature separately rather than asking once
 * and assuming. `isSessionSupported('immersive-ar')` returning true says only
 * that *some* AR session can start — a device can support immersive-ar and have
 * no hit-test, in which case there is no way to find a surface and "tap to
 * place" would be a lie.
 */
export async function probeXr(): Promise<XrCapabilityReport> {
  const empty: XrCapabilityReport = {
    supported: false,
    hitTest: false,
    anchors: false,
    domOverlay: false,
    lightEstimation: false,
    depthSensing: false,
  }

  if (typeof navigator === 'undefined') return { ...empty, reason: 'No browser environment.' }

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    // WebXR is hard-gated on a secure context. Over plain http on a LAN address
    // navigator.xr is simply absent, which reads as "unsupported device" unless
    // this is checked first.
    return { ...empty, reason: 'AR requires https.' }
  }

  const xr = (navigator as Navigator & { xr?: XRSystem }).xr
  if (!xr?.isSessionSupported) return { ...empty, reason: 'This browser has no WebXR.' }

  let supported = false
  try {
    supported = await xr.isSessionSupported('immersive-ar')
  } catch {
    return { ...empty, reason: 'This browser has no WebXR.' }
  }
  if (!supported) {
    return { ...empty, reason: 'This device cannot start an AR session.' }
  }

  // There is no API to ask "do you support hit-test?" without starting a
  // session, so the features are inferred from the XR module's own surface.
  // Being wrong here is recoverable: session creation lists them as OPTIONAL,
  // so an unsupported one is dropped rather than failing the request.
  const globalXr = window as unknown as Record<string, unknown>
  return {
    supported: true,
    hitTest: 'XRHitTestSource' in globalXr,
    anchors: 'XRAnchor' in globalXr,
    domOverlay: 'XRDOMOverlayState' in globalXr,
    lightEstimation: 'XRLightProbe' in globalXr,
    depthSensing: 'XRDepthInformation' in globalXr,
  }
}

export type SessionHandles = {
  session: XRSession
  /** Which optional features the runtime actually granted. */
  granted: {
    hitTest: boolean
    anchors: boolean
    domOverlay: boolean
    lightEstimation: boolean
    depthSensing: boolean
  }
}

/**
 * Starts the session.
 *
 * MUST be called synchronously from inside a user gesture handler. Chrome
 * rejects `requestSession` outside one, and awaiting anything first — a fetch
 * for the model, a capability probe — consumes the gesture and the request
 * fails with a message that reads like the device is unsupported. Everything
 * that can be prepared beforehand is prepared by the caller.
 */
export async function startSession(overlayRoot: HTMLElement): Promise<SessionHandles> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr
  if (!xr) throw new XrError('unsupported', 'This browser has no WebXR.')

  // `required` is deliberately minimal: hit-test is the only thing the
  // experience cannot work without, and demanding anchors or light estimation
  // would fail the session outright on devices that would otherwise be fine.
  const init: XRSessionInit = {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures: ['anchors', 'light-estimation', 'depth-sensing', 'dom-overlay'],
    domOverlay: { root: overlayRoot },
  }

  let session: XRSession
  try {
    session = await xr.requestSession('immersive-ar', init)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/denied|permission|NotAllowed/i.test(message)) {
      throw new XrError('permission-denied', 'Camera access was denied.')
    }
    if (/gesture|activation/i.test(message)) {
      throw new XrError('no-gesture', 'AR must be started by tapping a button.')
    }
    // `local-floor` is not universal. Retrying without it costs one round trip
    // and rescues devices that only offer `local` — placement is then relative
    // to the headset origin rather than the floor, which for tabletop objects
    // is indistinguishable.
    try {
      session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['anchors', 'light-estimation', 'dom-overlay'],
        domOverlay: { root: overlayRoot },
      })
    } catch {
      throw new XrError('session-failed', 'The AR session could not be started.')
    }
  }

  const enabled = session.enabledFeatures ?? []
  const has = (feature: string) =>
    // enabledFeatures is not implemented everywhere. When it is missing the
    // honest answer for the optional extras is "unknown", and treating unknown
    // as absent means the UI never claims a capability that is not there.
    enabled.length > 0 ? enabled.includes(feature) : feature === 'hit-test'

  return {
    session,
    granted: {
      hitTest: has('hit-test'),
      anchors: has('anchors'),
      domOverlay: has('dom-overlay'),
      lightEstimation: has('light-estimation'),
      depthSensing: has('depth-sensing'),
    },
  }
}

export class XrError extends Error {
  constructor(
    readonly kind: XrFailure,
    message: string,
  ) {
    super(message)
    this.name = 'XrError'
  }
}

/** Human copy for each failure. Never blames the user for a platform gap. */
export const FAILURE_COPY: Record<XrFailure, { title: string; body: string }> = {
  unsupported: {
    title: 'AR isn’t available on this device',
    body: 'Your browser doesn’t support in-page AR. You can still explore the product in 3D.',
  },
  'permission-denied': {
    title: 'Camera access is required for AR',
    body: 'AR needs the camera to see your surroundings. Nothing is recorded or uploaded.',
  },
  'insecure-context': {
    title: 'AR needs a secure connection',
    body: 'This page must be served over https for the camera to be available.',
  },
  'no-gesture': {
    title: 'Tap to start AR',
    body: 'Your browser needs a tap before it can open the camera.',
  },
  'session-failed': {
    title: 'AR couldn’t start on this device',
    body: 'Something went wrong opening the camera. You can still explore the product in 3D.',
  },
  'model-failed': {
    title: 'The 3D model couldn’t load',
    body: 'Check your connection and try again.',
  },
}
