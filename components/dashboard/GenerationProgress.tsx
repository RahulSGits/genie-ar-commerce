'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Loader2, RotateCw } from 'lucide-react'
import { Alert, Button, Card } from '@/components/ui'
import { pollGenerationAction } from '@/lib/actions/genie'
import { cn } from '@/lib/utils'

/**
 * Live generation progress.
 *
 * Every value shown comes from the server, which in turn reads the provider —
 * the client never advances the bar on a timer. That matters: a progress
 * indicator that moves on its own is a lie about work that may have already
 * failed, and the user finds out only when it never finishes.
 *
 * When the provider reports no percentage the bar is indeterminate rather than
 * invented, and the stage list still shows real position in the pipeline.
 */

const STAGES = [
  { key: 'uploading', label: 'Uploading images' },
  { key: 'analyzing', label: 'Analysing product' },
  { key: 'geometry', label: 'Generating geometry' },
  { key: 'materials', label: 'Generating materials' },
  { key: 'optimizing', label: 'Optimising 3D asset' },
  { key: 'packaging', label: 'Preparing AR experience' },
  { key: 'complete', label: 'Complete' },
] as const

/** Backs off as the job runs — a five-minute job does not need 2s polling. */
function intervalFor(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 2_000
  if (elapsedMs < 120_000) return 5_000
  return 10_000
}

export default function GenerationProgress({
  jobId,
  productId,
  productName,
}: {
  jobId: string
  productId: string
  productName: string
}) {
  const router = useRouter()
  const startedAt = useRef(Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelled = useRef(false)

  const [stage, setStage] = useState<string>('uploading')
  const [progress, setProgress] = useState<number | null>(null)
  const [status, setStatus] = useState<string>('queued')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    cancelled.current = false

    async function poll() {
      if (cancelled.current) return

      const result = await pollGenerationAction(jobId)

      if (cancelled.current) return

      if (!result.ok) {
        setError(result.error)
        setStatus('failed')
        return
      }

      setStage(result.data.stage)
      setProgress(result.data.progress)
      setStatus(result.data.status)

      if (result.data.status === 'succeeded') {
        // Refresh so the product page picks up the newly attached model.
        router.refresh()
        return
      }
      if (result.data.status === 'failed' || result.data.status === 'cancelled') {
        setError(result.data.errorMessage ?? 'Generation did not complete.')
        return
      }

      timer.current = setTimeout(
        () => void poll(),
        intervalFor(Date.now() - startedAt.current),
      )
    }

    void poll()
    return () => {
      cancelled.current = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [jobId, router])

  const activeIndex = STAGES.findIndex((s) => s.key === stage)
  const done = status === 'succeeded'
  const failed = status === 'failed' || status === 'cancelled'

  if (failed) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Generation didn’t complete</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{error}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/dashboard/products/${productId}`}>Back to product</Link>
          </Button>
          <Button asChild>
            <Link href={`/dashboard/models?product=${productId}`}>Upload a GLB instead</Link>
          </Button>
        </div>

        <Alert className="mt-4 text-xs">
          Nothing was lost — <strong>{productName}</strong> is still saved as a draft with its
          images. You can retry generation or attach a model you already have.
        </Alert>
      </Card>
    )
  }

  if (done) {
    return (
      <Card className="p-6 text-center">
        <div className="bg-success/12 text-success mx-auto mb-4 grid size-12 place-items-center rounded-full">
          <Check className="size-6" aria-hidden />
        </div>
        <h2 className="font-semibold">Your 3D model is ready</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {productName} can now be viewed in 3D and placed in AR.
        </p>
        <Button asChild className="mt-5">
          <Link href={`/dashboard/products/${productId}`}>Open product</Link>
        </Button>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3">
        <Loader2 className="text-primary size-5 animate-spin" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Generating your 3D model</h2>
          <p className="text-muted-foreground text-sm">
            This usually takes a few minutes. You can leave this page — it keeps running.
          </p>
        </div>
      </div>

      <div
        className="bg-muted mt-5 h-2 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
        aria-label="Generation progress"
      >
        <div
          className={cn(
            'bg-primary h-full rounded-full',
            // Indeterminate when the provider gives no number, rather than
            // inventing a percentage that would only ever be wrong.
            progress === null ? 'w-2/5 animate-pulse' : 'transition-[width] duration-500',
          )}
          style={progress === null ? undefined : { width: `${progress}%` }}
        />
      </div>

      <ol className="mt-5 space-y-2.5">
        {STAGES.slice(0, -1).map((s, i) => {
          const isDone = i < activeIndex
          const isActive = i === activeIndex
          return (
            <li key={s.key} className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full border',
                  isDone && 'border-success bg-success/12 text-success',
                  isActive && 'border-primary text-primary',
                  !isDone && !isActive && 'border-border text-muted-foreground/40',
                )}
              >
                {isDone ? (
                  <Check className="size-3" aria-hidden />
                ) : isActive ? (
                  <RotateCw className="size-3 animate-spin" aria-hidden />
                ) : (
                  <span className="bg-current size-1 rounded-full" aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  isActive && 'font-medium',
                  !isDone && !isActive && 'text-muted-foreground',
                )}
              >
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
