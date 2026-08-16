/**
 * WebXR Lighting Estimation.
 *
 * A separate W3C module from the core WebXR spec, and TypeScript's lib.dom does
 * not declare it. Declared here rather than cast away at the call site so the
 * shapes stay checked — the light estimate is read every frame, and a silent
 * `any` there would let a typo cost real-world lighting with no error.
 *
 * https://immersive-web.github.io/lighting-estimation/
 */

interface XRLightProbe extends EventTarget {
  readonly probeSpace: XRSpace
  onreflectionchange: ((this: XRLightProbe, ev: Event) => unknown) | null
}

interface XRLightEstimate {
  /** 27 floats: 9 coefficients across 3 colour channels. */
  readonly sphericalHarmonicsCoefficients: Float32Array
  readonly primaryLightDirection: DOMPointReadOnly
  readonly primaryLightIntensity: DOMPointReadOnly
}

interface XRLightProbeInit {
  reflectionFormat?: 'srgba8' | 'rgba16f'
}

interface XRSession {
  requestLightProbe?(options?: XRLightProbeInit): Promise<XRLightProbe>
}

interface XRFrame {
  getLightEstimate?(probe: XRLightProbe): XRLightEstimate | null
}
