import type * as React from 'react'

/**
 * JSX typing for the <model-viewer> custom element.
 *
 * model-viewer is a web component, so React has no built-in knowledge of its
 * attributes. Declaring them here means typos are caught at compile time rather
 * than silently ignored by the DOM.
 */

export type ModelViewerArMode = 'webxr' | 'scene-viewer' | 'quick-look' | 'none'
export type ModelViewerArStatus =
  | 'not-presenting'
  | 'session-started'
  | 'object-placed'
  | 'failed'

export interface ModelViewerElement extends HTMLElement {
  /** True only when this device can actually enter AR with the loaded assets. */
  readonly canActivateAR: boolean
  activateAR(): Promise<void>
  /** Real-world size of the loaded model, in metres (glTF units are metres). */
  getDimensions(): { x: number; y: number; z: number }
  getCameraOrbit(): { theta: number; phi: number; radius: number }
  resetTurntableRotation(radians?: number): void
  readonly loaded: boolean
  readonly modelIsVisible: boolean
  cameraOrbit: string
  autoRotate: boolean
  src: string | null
  iosSrc: string | null
}

type ModelViewerAttributes = {
  src?: string
  'ios-src'?: string
  alt?: string
  poster?: string

  /** Presence of `ar` enables the AR button/flow at all. */
  ar?: boolean | ''
  /** Ordered preference list, e.g. "webxr scene-viewer quick-look". */
  'ar-modes'?: string
  /** "fixed" honours real-world size; "auto" lets the viewer rescale. */
  'ar-scale'?: 'auto' | 'fixed'
  'ar-placement'?: 'floor' | 'wall'
  'xr-environment'?: boolean | ''

  'camera-controls'?: boolean | ''
  'touch-action'?: 'pan-y' | 'pan-x' | 'none'
  'disable-zoom'?: boolean | ''
  'auto-rotate'?: boolean | ''
  'auto-rotate-delay'?: number | string
  'rotation-per-second'?: string
  'camera-orbit'?: string
  'min-camera-orbit'?: string
  'max-camera-orbit'?: string
  'field-of-view'?: string
  'interaction-prompt'?: 'auto' | 'when-focused' | 'none'

  'shadow-intensity'?: number | string
  'shadow-softness'?: number | string
  'environment-image'?: string
  'skybox-image'?: string
  exposure?: number | string
  'tone-mapping'?: string

  loading?: 'auto' | 'lazy' | 'eager'
  reveal?: 'auto' | 'manual' | 'interaction'
  'with-credentials'?: boolean | ''
  'seamless-poster'?: boolean | ''
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<ModelViewerElement> & ModelViewerAttributes,
        ModelViewerElement
      >
    }
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<ModelViewerElement> & ModelViewerAttributes,
        ModelViewerElement
      >
    }
  }
}

export {}
