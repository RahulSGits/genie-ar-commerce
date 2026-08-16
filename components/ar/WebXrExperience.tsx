'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, RotateCw, RotateCcw, Move, X, Minimize2 } from 'lucide-react'
import { ArScene, type PlacementMode } from '@/lib/ar/webxr/scene'
import { startSession, XrError, FAILURE_COPY, type XrPhase, type XrFailure } from '@/lib/ar/webxr/session'

/**
 * GENIE's own in-page AR experience.
 *
 * Everything drawn here sits on a WebXR DOM overlay, composited over the live
 * camera by the browser. That is what makes a custom AR UI possible at all —
 * and it is Android Chrome + ARCore only. On iOS this component never mounts;
 * Safari's only AR path is Apple's AR Quick Look, which owns its entire UI.
 *
 * The instruction copy is driven by the real session phase, never by a timer.
 * "Surface detected" appears when the runtime actually returns a hit test
 * result, and the placement analytics event fires when an anchor is actually
 * created — so the numbers on the business's dashboard mean what they say.
 */

export type ArConfig = {
  glbUrl: string
  productName: string
  placement: PlacementMode
  realSizeM: { width: number; height: number; depth: number } | null
  defaultScale: number
  minScale: number
  maxScale: number
  defaultRotationY: number
  ctaLabel: string | null
  ctaUrl: string | null
}

export type ArEvent =
  | 'ar_session_started'
  | 'ar_surface_detected'
  | 'ar_object_placed'
  | 'ar_interaction'
  | 'ar_exit'
  | 'cta_clicked'

export default function WebXrExperience({
  config,
  onEvent,
  onClose,
  onFallback,
}: {
  config: ArConfig
  onEvent: (event: ArEvent) => void
  onClose: () => void
  /** Called when AR cannot run, so the page can offer the 3D viewer. */
  onFallback: (reason: XrFailure) => void
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<ArScene | null>(null)
  const sessionRef = useRef<XRSession | null>(null)

  const [phase, setPhase] = useState<XrPhase>('requesting')
  const [failure, setFailure] = useState<XrFailure | null>(null)
  const [hint, setHint] = useState(true)
  const [scale, setScale] = useState(config.defaultScale)

  const emit = useCallback((event: ArEvent) => onEvent(event), [onEvent])

  /* ── start ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const overlay = overlayRef.current
      const canvas = canvasRef.current
      if (!overlay || !canvas) return

      const scene = new ArScene(canvas, {
        glbUrl: config.glbUrl,
        realSizeM: config.realSizeM,
        placement: config.placement,
        defaultScale: config.defaultScale,
        minScale: config.minScale,
        maxScale: config.maxScale,
        defaultRotationY: config.defaultRotationY,
      }, {
        onSurfaceFound: () => {
          if (cancelled) return
          setPhase((current) => {
            if (current === 'scanning') {
              // Fires once per session, on the first real hit test result —
              // not on a timer, so the metric means a surface was genuinely
              // found rather than that a few seconds elapsed.
              emit('ar_surface_detected')
              return 'ready-to-place'
            }
            return current
          })
        },
        onSurfaceLost: () => {
          if (!cancelled) setPhase((c) => (c === 'ready-to-place' ? 'scanning' : c))
        },
        onPlaced: () => {
          if (cancelled) return
          setPhase('placed')
          emit('ar_object_placed')
          // The instructions have done their job once the object is down.
          window.setTimeout(() => setHint(false), 3500)
        },
        onInteraction: () => emit('ar_interaction'),
      })
      sceneRef.current = scene

      try {
        // Loaded BEFORE the session is requested. Awaiting a multi-megabyte
        // download inside the gesture handler would consume the user activation
        // and Chrome would reject requestSession.
        await scene.loadModel()
      } catch {
        if (!cancelled) {
          setFailure('model-failed')
          setPhase('failed')
        }
        return
      }

      if (cancelled) return

      try {
        const { session, granted } = await startSession(overlay)
        sessionRef.current = session

        session.addEventListener('end', () => {
          if (cancelled) return
          setPhase('ended')
          emit('ar_exit')
          onClose()
        })

        session.addEventListener('select', () => {
          void sceneRef.current?.place()
        })

        await scene.attach(session, granted)

        if (!cancelled) {
          setPhase('scanning')
          emit('ar_session_started')
        }
      } catch (err) {
        if (cancelled) return
        const kind = err instanceof XrError ? err.kind : 'session-failed'
        setFailure(kind)
        setPhase('failed')
        onFallback(kind)
      }
    }

    void run()

    return () => {
      cancelled = true
      sceneRef.current?.dispose()
      sceneRef.current = null
      void sessionRef.current?.end().catch(() => undefined)
      sessionRef.current = null
    }
    // Mount-only: re-running would tear down a live AR session mid-use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── controls ─────────────────────────────────────────────────────────── */

  const exit = () => {
    void sessionRef.current?.end().catch(() => undefined)
    onClose()
  }

  const adjustScale = (factor: number) => {
    sceneRef.current?.scaleBy(factor)
    setScale(sceneRef.current?.scaleFactor ?? scale)
  }

  if (phase === 'failed' && failure) {
    const copy = FAILURE_COPY[failure]
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-neutral-950 p-6 text-center text-white">
        <div className="max-w-sm space-y-4">
          <h2 className="text-lg font-semibold">{copy.title}</h2>
          <p className="text-sm text-white/70">{copy.body}</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-neutral-950"
            >
              View in 3D instead
            </button>
            {failure === 'permission-denied' && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full border border-white/25 px-5 py-3 text-sm font-medium"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* The XR compositor draws the camera feed behind this canvas. */}
      <canvas ref={canvasRef} className="fixed inset-0 z-40 h-full w-full" />

      <div
        ref={overlayRef}
        className="pointer-events-none fixed inset-0 z-50 flex flex-col justify-between p-5 text-white select-none"
      >
        <div className="flex items-start justify-between">
          <span className="pointer-events-none rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium backdrop-blur">
            {config.productName}
          </span>
          <button
            type="button"
            onClick={exit}
            aria-label="Exit AR"
            className="pointer-events-auto grid size-10 place-items-center rounded-full bg-black/45 backdrop-blur"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {hint && (
          <div className="pointer-events-none mx-auto max-w-xs text-center">
            <p className="rounded-2xl bg-black/50 px-4 py-3 text-sm leading-snug backdrop-blur">
              {phase === 'requesting' && 'Preparing your AR experience…'}
              {phase === 'scanning' && 'Move your phone slowly to scan your surroundings.'}
              {phase === 'ready-to-place' && (
                <>
                  <span className="block font-semibold">Surface detected</span>
                  Tap anywhere to place the {config.productName.toLowerCase()}.
                </>
              )}
              {phase === 'placed' && 'Move around to explore it from any angle.'}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {phase === 'placed' && (
            <div className="pointer-events-auto mx-auto flex items-center justify-center gap-2">
              <ControlButton label="Rotate left" onClick={() => sceneRef.current?.rotateBy(-Math.PI / 12)}>
                <RotateCcw className="size-5" aria-hidden />
              </ControlButton>
              <ControlButton label="Shrink" onClick={() => adjustScale(0.9)}>
                <Minimize2 className="size-5" aria-hidden />
              </ControlButton>
              <ControlButton label="Move" onClick={() => {
                sceneRef.current?.reposition()
                setPhase('scanning')
                setHint(true)
              }}>
                <Move className="size-5" aria-hidden />
              </ControlButton>
              <ControlButton label="Enlarge" onClick={() => adjustScale(1.1)}>
                <Maximize2 className="size-5" aria-hidden />
              </ControlButton>
              <ControlButton label="Rotate right" onClick={() => sceneRef.current?.rotateBy(Math.PI / 12)}>
                <RotateCw className="size-5" aria-hidden />
              </ControlButton>
            </div>
          )}

          {phase === 'placed' && (
            <div className="pointer-events-auto flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  sceneRef.current?.reset()
                  setScale(config.defaultScale)
                }}
                className="rounded-full bg-black/45 px-4 py-2 text-xs font-medium backdrop-blur"
              >
                Reset
              </button>

              {config.ctaUrl && config.ctaLabel && (
                <a
                  href={config.ctaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => emit('cta_clicked')}
                  className="bg-primary text-primary-foreground rounded-full px-6 py-3 text-sm font-semibold shadow-lg"
                >
                  {config.ctaLabel}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-11 place-items-center rounded-full bg-black/45 backdrop-blur active:scale-95"
    >
      {children}
    </button>
  )
}
