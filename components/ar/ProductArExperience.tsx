'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Camera, Info, RotateCcw, X } from 'lucide-react'
import ModelViewer, { activateArOn } from './ModelViewer'
import type { ModelViewerArStatus } from '@/types/model-viewer'
import type { PublicArProduct } from '@/types/ar'
import { formatMoney, type CurrencyCode } from '@/utils/money'
import { cn } from '@/lib/utils'

/**
 * The customer-facing 3D/AR experience.
 *
 * Flow, deliberately in this order:
 *   product + 3D model on screen  →  user interacts  →  "View in AR"  →
 *   camera permission  →  place on their table
 *
 * The camera is never requested on load. Asking cold, before the customer has
 * seen anything, gets denied — and a denied permission is sticky, so the first
 * ask has to be one they are ready to say yes to.
 */

type Props = {
  product: PublicArProduct
  onEvent?: (event: 'viewer_3d_opened' | 'ar_clicked' | 'ar_session_started' | 'ar_object_placed') => void
}

export default function ProductArExperience({ product, onEvent }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState(0)
  const [canActivateAr, setCanActivateAr] = useState(false)
  const [arStatus, setArStatus] = useState<ModelViewerArStatus>('not-presenting')
  const [showInfo, setShowInfo] = useState(false)
  const [sizeNote, setSizeNote] = useState<string | null>(null)

  const viewerReported = useRef(false)

  const glb = product.model?.glbUrl ?? null
  const usdz = product.model?.usdzUrl ?? null
  const ready = product.model?.status === 'ready' && Boolean(glb)

  /* Report that the 3D viewer was seen — once per page, not per re-render. */
  useEffect(() => {
    if (loaded && !viewerReported.current) {
      viewerReported.current = true
      onEvent?.('viewer_3d_opened')
    }
  }, [loaded, onEvent])

  const handleLoad = useCallback(
    ({ dimensions }: { dimensions: { x: number; y: number; z: number } }) => {
      setLoaded(true)
      setLoadError(null)

      // glTF units are metres by spec, so a well-exported model already reports
      // its true size. Surfacing it lets the customer sanity-check scale before
      // committing to AR, and lets us catch a badly-authored asset.
      const longest = Math.max(dimensions.x, dimensions.z)
      if (longest > 0) {
        const cm = Math.round(longest * 100)
        setSizeNote(cm >= 100 ? `${(cm / 100).toFixed(2)} m across` : `${cm} cm across`)
      }
    },
    [],
  )

  const handleArStatus = useCallback(
    (status: ModelViewerArStatus) => {
      setArStatus(status)
      if (status === 'session-started') onEvent?.('ar_session_started')
      if (status === 'object-placed') onEvent?.('ar_object_placed')
      if (status === 'failed') {
        setLoadError('AR could not start. You can still explore the product in 3D.')
      }
    },
    [onEvent],
  )

  const handleViewInAr = useCallback(async () => {
    onEvent?.('ar_clicked')
    // model-viewer owns the permission prompt and the OS handoff. Returning
    // false means this device genuinely cannot do AR with these assets.
    const started = await activateArOn(
      containerRef.current?.querySelector('model-viewer') as HTMLElement | null,
    )
    if (!started) {
      setShowInfo(true)
    }
  }, [onEvent])

  /* ── model missing entirely ───────────────────────────────────────────── */

  if (!ready) {
    return (
      <div className="bg-muted/40 flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-2xl border p-8 text-center">
        <Box className="text-muted-foreground/60 size-10" aria-hidden />
        <p className="text-muted-foreground text-sm">
          {product.model?.status === 'processing'
            ? 'The 3D model is still being prepared.'
            : 'A 3D model hasn’t been added for this product yet.'}
        </p>
        {product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="mt-2 max-h-48 rounded-xl object-cover"
          />
        )}
      </div>
    )
  }

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        className="bg-muted/30 relative aspect-square w-full overflow-hidden rounded-2xl border"
      >
        <ModelViewer
          src={glb!}
          iosSrc={usdz}
          poster={product.imageUrl}
          alt={`3D model of ${product.name}`}
          placement={product.placement}
          arScale="fixed"
          enableAr={product.arEnabled}
          className="size-full"
          onLoad={handleLoad}
          onError={setLoadError}
          onProgress={setProgress}
          onArStatus={handleArStatus}
          onArAvailability={setCanActivateAr}
        />

        {/* Loading veil — the poster shows through underneath. */}
        {!loaded && !loadError && (
          <div className="bg-background/70 absolute inset-0 flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
            <div className="bg-muted h-1 w-40 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-[width] duration-200"
                style={{ width: `${Math.max(8, progress * 100)}%` }}
              />
            </div>
            <p className="text-muted-foreground text-xs">Loading 3D model…</p>
          </div>
        )}

        {loadError && (
          <div className="bg-background/90 absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm font-medium">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoadError(null)
                setLoaded(false)
                // Re-mounting the element is the reliable way to retry a failed
                // fetch — model-viewer caches the failure otherwise.
                window.location.reload()
              }}
              className="border-input hover:bg-accent rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Try again
            </button>
          </div>
        )}

        {/* Live AR state, announced for screen readers too. */}
        {arStatus === 'session-started' && (
          <div className="glass-dark absolute inset-x-4 bottom-4 rounded-xl px-4 py-2.5 text-center text-xs text-white">
            Move your phone slowly to find a surface, then tap to place.
          </div>
        )}

        {loaded && sizeNote && (
          <div className="glass text-muted-foreground absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-medium">
            {sizeNote}
          </div>
        )}
      </div>

      {/* ── controls ─────────────────────────────────────────────────────── */}

      <div className="mt-3 flex items-center gap-2">
        {product.arEnabled && (
          <button
            type="button"
            onClick={handleViewInAr}
            disabled={!loaded}
            className={cn(
              'flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition',
              'bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99]',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <Camera className="size-4" aria-hidden />
            View in your space
          </button>
        )}

        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          aria-expanded={showInfo}
          aria-label="How does this work?"
          className="border-input hover:bg-accent flex size-12 items-center justify-center rounded-xl border"
        >
          <Info className="size-4" aria-hidden />
        </button>
      </div>

      <p className="text-muted-foreground mt-2 text-center text-xs">
        Drag to rotate · Pinch to zoom
      </p>

      {/* ── honest capability explainer ──────────────────────────────────── */}

      {showInfo && (
        <div className="bg-muted/50 mt-3 rounded-xl border p-4 text-sm">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="font-semibold">Viewing in your space</h3>
            <button
              type="button"
              onClick={() => setShowInfo(false)}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {canActivateAr ? (
            <p className="text-muted-foreground leading-relaxed">
              Tap <strong>View in your space</strong> and allow camera access. Point your phone
              at a table or floor, then tap to place the {product.name.toLowerCase()} at its
              real size.
            </p>
          ) : (
            <p className="text-muted-foreground leading-relaxed">
              This device or browser doesn’t support placing objects in the camera. AR
              availability depends on the device — you can still rotate, zoom and inspect the
              product in full 3D above. For AR, try opening this page in Safari on iPhone or
              Chrome on Android.
            </p>
          )}

          {!usdz && (
            <p className="text-muted-foreground/80 mt-2 text-xs">
              Note: on iPhone, AR needs a USDZ version of this model.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Price block used beside the viewer. Kept here so currency handling stays in one place. */
export function ProductPrice({
  priceMinor,
  compareAtMinor,
  currency,
}: {
  priceMinor: number | null
  compareAtMinor: number | null
  currency: string
}) {
  if (priceMinor === null) return null
  const code = currency as CurrencyCode

  return (
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-bold tracking-tight">
        {formatMoney({ amount: priceMinor, currency: code })}
      </span>
      {compareAtMinor !== null && compareAtMinor > priceMinor && (
        <span className="text-muted-foreground text-sm line-through">
          {formatMoney({ amount: compareAtMinor, currency: code })}
        </span>
      )}
    </div>
  )
}

export { RotateCcw }
