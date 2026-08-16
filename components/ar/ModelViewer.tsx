'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelViewerElement, ModelViewerArStatus } from '@/types/model-viewer'
import type { PlacementMode } from '@/config/terminology'

/**
 * React wrapper around Google's <model-viewer>.
 *
 * model-viewer is the primary 3D/AR surface for the whole product. It resolves
 * to the best real-AR path the device actually has — WebXR, Android Scene
 * Viewer, or iOS AR Quick Look — which is the one thing a hand-rolled Three.js
 * renderer cannot do, because Quick Look is an OS handoff with no web API.
 *
 * Three.js is kept for the dashboard model inspector, where we need to measure
 * geometry and generate posters rather than just display it.
 */

export type ModelViewerProps = {
  /** GLB/glTF. glTF units are metres by spec, which is what makes ar-scale="fixed" correct. */
  src: string
  /** USDZ. Without it, iPhones fall back to the 3D viewer instead of Quick Look. */
  iosSrc?: string | null
  poster?: string | null
  alt: string

  placement?: PlacementMode
  /** "fixed" shows true real-world size. Only turn this off deliberately. */
  arScale?: 'auto' | 'fixed'
  enableAr?: boolean
  autoRotate?: boolean

  className?: string
  /** Fires once the model is fully loaded and its dimensions are readable. */
  onLoad?: (info: { dimensions: { x: number; y: number; z: number } }) => void
  onError?: (message: string) => void
  onProgress?: (fraction: number) => void
  onArStatus?: (status: ModelViewerArStatus) => void
  /** Reports whether this device can genuinely enter AR with these assets. */
  onArAvailability?: (canActivate: boolean) => void
}

/** model-viewer only has 'floor' and 'wall'; the rest of our modes map onto floor. */
function toArPlacement(mode: PlacementMode | undefined): 'floor' | 'wall' {
  return mode === 'wall' ? 'wall' : 'floor'
}

export default function ModelViewer({
  src,
  iosSrc,
  poster,
  alt,
  placement = 'tabletop',
  arScale = 'fixed',
  enableAr = true,
  autoRotate = true,
  className,
  onLoad,
  onError,
  onProgress,
  onArStatus,
  onArAvailability,
}: ModelViewerProps) {
  const ref = useRef<ModelViewerElement | null>(null)
  const [defined, setDefined] = useState(false)

  // The custom element registers itself on import and touches `window`, so it
  // can only be loaded in the browser — hence the dynamic import rather than a
  // top-level one.
  useEffect(() => {
    let cancelled = false
    import('@google/model-viewer')
      .then(() => {
        if (!cancelled) setDefined(true)
      })
      .catch(() => {
        if (!cancelled) onError?.('The 3D viewer could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [onError])

  useEffect(() => {
    const el = ref.current
    if (!el || !defined) return

    const handleLoad = () => {
      // getDimensions is only meaningful once the model is loaded.
      let dimensions = { x: 0, y: 0, z: 0 }
      try {
        dimensions = el.getDimensions()
      } catch {
        /* older builds may throw before first frame — non-fatal */
      }
      onLoad?.({ dimensions })
      onArAvailability?.(el.canActivateAR)
    }

    const handleError = (ev: Event) => {
      const detail = (ev as CustomEvent<{ type?: string }>).detail
      onError?.(
        detail?.type === 'loadfailure'
          ? 'The 3D model failed to load. It may be missing or corrupted.'
          : 'Something went wrong displaying the 3D model.',
      )
    }

    const handleProgress = (ev: Event) => {
      const detail = (ev as CustomEvent<{ totalProgress: number }>).detail
      if (detail) onProgress?.(detail.totalProgress)
    }

    const handleArStatus = (ev: Event) => {
      const detail = (ev as CustomEvent<{ status: ModelViewerArStatus }>).detail
      if (detail) onArStatus?.(detail.status)
    }

    el.addEventListener('load', handleLoad)
    el.addEventListener('error', handleError)
    el.addEventListener('progress', handleProgress)
    el.addEventListener('ar-status', handleArStatus)

    return () => {
      el.removeEventListener('load', handleLoad)
      el.removeEventListener('error', handleError)
      el.removeEventListener('progress', handleProgress)
      el.removeEventListener('ar-status', handleArStatus)
    }
  }, [defined, onLoad, onError, onProgress, onArStatus, onArAvailability])

  /** Imperatively enters AR. Must be called from a user gesture. */
  const activateAr = useCallback(async () => {
    const el = ref.current
    if (!el) return false
    if (!el.canActivateAR) return false
    try {
      await el.activateAR()
      return true
    } catch {
      onError?.('AR could not be started on this device.')
      return false
    }
  }, [onError])

  // Expose the activate function to the parent through a stable ref callback.
  useEffect(() => {
    if (ref.current) {
      ;(ref.current as ModelViewerElement & { __activateAr?: () => Promise<boolean> }).__activateAr =
        activateAr
    }
  }, [activateAr])

  if (!defined) {
    return <div className={className} aria-busy="true" />
  }

  return (
    <model-viewer
      ref={ref as never}
      className={className}
      src={src}
      {...(iosSrc ? { 'ios-src': iosSrc } : {})}
      {...(poster ? { poster } : {})}
      alt={alt}
      {...(enableAr ? { ar: true } : {})}
      // Order matters: the first mode the device supports wins. WebXR keeps the
      // user inside our page; the other two are OS handoffs.
      ar-modes="webxr scene-viewer quick-look"
      ar-scale={arScale}
      ar-placement={toArPlacement(placement)}
      xr-environment
      camera-controls
      touch-action="pan-y"
      {...(autoRotate ? { 'auto-rotate': true } : {})}
      auto-rotate-delay={2500}
      rotation-per-second="18deg"
      interaction-prompt="auto"
      // Lighting is most of what makes a model read as a real object.
      //
      // `neutral` selects model-viewer's newer built-in environment: a softer,
      // more physically plausible studio than the default `legacy` rig, whose
      // hard key light flattens texture detail into glare. Nothing is fetched —
      // both are generated in the renderer, so this costs no download.
      environment-image="neutral"
      // Khronos PBR Neutral. ACES (the usual default elsewhere) is graded for
      // film and desaturates product colours, which for commerce means the
      // customer sees a duller version of what they will be served.
      tone-mapping="neutral"
      // A contact shadow is what plants an object on a surface. Without one it
      // floats, and no amount of material work fixes that read.
      shadow-intensity="1.1"
      shadow-softness="0.9"
      exposure="1.05"
      // Three-quarter view from slightly above: the angle a product is
      // photographed from, and the one that shows depth rather than a
      // silhouette. Users can still orbit anywhere from here.
      camera-orbit="24deg 72deg auto"
      min-camera-orbit="auto 0deg auto"
      max-camera-orbit="auto 100deg auto"
      loading="eager"
      style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
    />
  )
}

/** Calls the activate hook attached above. Returns false when AR is unavailable. */
export async function activateArOn(el: HTMLElement | null): Promise<boolean> {
  const target = el as (ModelViewerElement & { __activateAr?: () => Promise<boolean> }) | null
  if (!target?.__activateAr) return false
  return target.__activateAr()
}
