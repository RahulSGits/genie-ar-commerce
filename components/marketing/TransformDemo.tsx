'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { Camera, Check, Cpu, ImageIcon, QrCode as QrIcon, RotateCw } from 'lucide-react'
import ModelViewer from '@/components/ar/ModelViewer'
import { cn } from '@/lib/utils'

/**
 * The homepage centrepiece: image → AI → 3D → QR → AR.
 *
 * Stage 3 is a genuinely interactive model-viewer running the same GLB the
 * product ships with, and stage 4 renders a real QR pointing at the real demo
 * page. Stages 1 and 2 are illustrative and are labelled as such — the point of
 * the demo is that the end of the pipeline is real, so faking the middle would
 * undercut it.
 */

const STAGES = [
  { key: 'image', label: 'Upload', icon: ImageIcon },
  { key: 'generate', label: 'Generate', icon: Cpu },
  { key: 'model', label: '3D model', icon: RotateCw },
  { key: 'share', label: 'QR & AR', icon: QrIcon },
] as const

type StageKey = (typeof STAGES)[number]['key']

const DEMO_PATH = '/ar/urban-bites/signature-burger'

export default function TransformDemo() {
  const [stage, setStage] = useState<StageKey>('image')
  const [qr, setQr] = useState<string | null>(null)
  const [autoplay, setAutoplay] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}${DEMO_PATH}`, {
      width: 320,
      margin: 1,
      color: { dark: '#0d0b1f', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(null))
  }, [])

  /* Walks the stages once so a visitor sees the whole story without clicking,
     then stops — a permanent loop is distracting while reading the page. */
  useEffect(() => {
    if (!autoplay) return
    const order: StageKey[] = ['image', 'generate', 'model', 'share']
    const index = order.indexOf(stage)
    if (index === order.length - 1) {
      setAutoplay(false)
      return
    }
    // The 3D stage gets longer — it is the one worth looking at.
    timer.current = setTimeout(() => setStage(order[index + 1]!), stage === 'model' ? 4200 : 1900)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [stage, autoplay])

  const select = (key: StageKey) => {
    setAutoplay(false)
    if (timer.current) clearTimeout(timer.current)
    setStage(key)
  }

  const activeIndex = STAGES.findIndex((s) => s.key === stage)

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* stage rail */}
      <ol className="mb-5 flex items-center justify-center gap-1 sm:gap-2">
        {STAGES.map((s, i) => {
          const Icon = s.icon
          const done = i < activeIndex
          const active = i === activeIndex
          return (
            <li key={s.key} className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => select(s.key)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                  active && 'bg-primary text-primary-foreground',
                  done && 'text-primary',
                  !active && !done && 'text-white/50 hover:text-white/80',
                )}
              >
                {done ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <Icon className="size-3.5" aria-hidden />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STAGES.length - 1 && (
                <span
                  className={cn(
                    'h-px w-4 transition-colors sm:w-8',
                    i < activeIndex ? 'bg-primary' : 'bg-white/15',
                  )}
                  aria-hidden
                />
              )}
            </li>
          )
        })}
      </ol>

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-[oklch(0.19_0.03_270)] sm:aspect-[16/10]">
        {/* 1 — source image */}
        {stage === 'image' && (
          <div className="absolute inset-0 grid place-items-center p-8">
            <div className="text-center">
              <div className="mx-auto mb-4 grid size-20 place-items-center rounded-2xl border border-dashed border-white/20 bg-white/5">
                <ImageIcon className="size-8 text-white/40" aria-hidden />
              </div>
              <p className="text-sm font-medium text-white">Your product photo</p>
              <p className="mt-1 text-xs text-white/50">
                One image is enough. More angles give better geometry.
              </p>
            </div>
          </div>
        )}

        {/* 2 — processing */}
        {stage === 'generate' && (
          <div className="absolute inset-0 grid place-items-center p-8">
            <div className="w-full max-w-xs text-center">
              <div className="relative mx-auto mb-5 grid size-20 place-items-center">
                <span className="border-primary/30 border-t-primary absolute inset-0 animate-spin rounded-full border-2" />
                <Cpu className="text-primary size-7" aria-hidden />
              </div>
              <p className="text-sm font-medium text-white">Generating geometry</p>
              <div className="mt-3 space-y-1.5 text-left">
                {['Analysing product', 'Building mesh', 'Applying materials'].map((line, i) => (
                  <div key={line} className="flex items-center gap-2 text-xs text-white/55">
                    <span
                      className="bg-primary size-1.5 shrink-0 rounded-full"
                      style={{ opacity: 1 - i * 0.28 }}
                      aria-hidden
                    />
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3 — the real thing */}
        {stage === 'model' && (
          <>
            <ModelViewer
              src="/models/signature-burger.glb"
              alt="Interactive 3D model of a burger"
              enableAr={false}
              autoRotate
              className="size-full"
            />
            <span className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              Live 3D · drag to rotate
            </span>
          </>
        )}

        {/* 4 — distribution */}
        {stage === 'share' && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
              <div className="rounded-2xl bg-white p-3">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="QR code to the live demo product" className="size-32" />
                ) : (
                  <div className="size-32 animate-pulse rounded bg-black/10" />
                )}
              </div>
              <div className="max-w-[15rem] text-center sm:text-left">
                <p className="text-sm font-medium text-white">Scan it on your phone</p>
                <p className="mt-1 text-xs leading-relaxed text-white/55">
                  Opens the real product page. Tap <strong className="text-white/80">View in
                  your space</strong> to place it on your table.
                </p>
                <Link
                  href={DEMO_PATH}
                  className="text-primary mt-3 inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
                >
                  <Camera className="size-3.5" aria-hidden />
                  Or open it here
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-white/40">
        Stages 1–2 are illustrative. The 3D model and QR code are live.
      </p>
    </div>
  )
}
