'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Cpu, ImageIcon, Loader2,
  Upload, X,
} from 'lucide-react'
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from '@/components/ui'
import {
  createDraftProductAction, startGenerationAction, uploadImagesAction,
  type UploadedImage,
} from '@/lib/actions/genie'
import { PLACEMENT_MODES, PLACEMENT_LABELS, type PlacementMode } from '@/config/terminology'
import GenerationProgress from '@/components/dashboard/GenerationProgress'
import { formatBytes, cn } from '@/lib/utils'

/**
 * The GENIE creation flow: images → details → 3D.
 *
 * The generation step is deliberately honest. When no AI provider is connected
 * the UI says so up front — before any upload — and routes the user to the path
 * that does work (uploading a GLB they already own). It never shows progress
 * for work that is not happening.
 */

type Step = 'upload' | 'details' | 'generate'

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'upload', label: 'Upload' },
  { key: 'details', label: 'Details' },
  { key: 'generate', label: '3D model' },
]

export default function CreateWizard({
  generation,
  categories,
}: {
  /** Resolved server-side; drives whether generation is offered at all. */
  generation: { available: boolean; reason?: string; providerName: string }
  categories: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [productId, setProductId] = useState<string | null>(null)
  const [productName, setProductName] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)

  const stepIndex = STEPS.findIndex((s) => s.key === step)

  /* ── upload ───────────────────────────────────────────────────────────── */

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    setUploading(true)

    const fd = new FormData()
    for (const file of Array.from(files)) fd.append('images', file)

    const result = await uploadImagesAction(null, fd)
    setUploading(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setImages((prev) => [...prev, ...result.data])
  }

  /* ── details ──────────────────────────────────────────────────────────── */

  async function handleDetails(formData: FormData) {
    setError(null)
    formData.set('imageIds', images.map((i) => i.id).join(','))
    formData.set('primaryImageUrl', images[0]?.url ?? '')

    const result = await createDraftProductAction(null, formData)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setProductId(result.data.productId)
    setProductName(String(formData.get('name') ?? 'Your product'))
    setStep('generate')
  }

  /* ── generate ─────────────────────────────────────────────────────────── */

  async function handleGenerate() {
    if (!productId) return
    setError(null)
    const result = await startGenerationAction(productId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    // Stay here and show real progress rather than dropping the user on a
    // product page that has nothing on it yet.
    setJobId(result.data.jobId)
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* stepper */}
      <ol className="mb-8 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium',
                i === stepIndex && 'bg-primary text-primary-foreground',
                i < stepIndex && 'text-primary',
                i > stepIndex && 'text-muted-foreground',
              )}
            >
              {i < stepIndex ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <span className="text-xs tabular-nums">0{i + 1}</span>
              )}
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={cn('h-px w-6', i < stepIndex ? 'bg-primary' : 'bg-border')}
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>

      {error && (
        <Alert variant="destructive" className="mb-4">
          {error}
        </Alert>
      )}

      {/* ── step 1 ─────────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Upload product images</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            One image is enough to get started. More angles give a generator more to work
            with — front, side and back is a good set.
          </p>

          <label
            className={cn(
              'mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors',
              'hover:border-primary/50 hover:bg-accent/40',
              uploading && 'pointer-events-none opacity-60',
            )}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              disabled={uploading}
              onChange={(e) => void handleFiles(e.target.files)}
            />
            {uploading ? (
              <Loader2 className="text-primary size-7 animate-spin" aria-hidden />
            ) : (
              <Upload className="text-muted-foreground size-7" aria-hidden />
            )}
            <span className="text-sm font-medium">
              {uploading ? 'Uploading…' : 'Choose images or drop them here'}
            </span>
            <span className="text-muted-foreground text-xs">JPEG, PNG or WebP · up to 8 MB each</span>
          </label>

          {images.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {images.map((img, i) => (
                <div key={img.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt=""
                    className="bg-muted aspect-square w-full rounded-lg object-cover"
                  />
                  {i === 0 && (
                    <Badge className="absolute left-1.5 top-1.5 text-[10px]">Primary</Badge>
                  )}
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                    className="bg-background/90 absolute right-1.5 top-1.5 rounded-md border p-1 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                  <p className="text-muted-foreground mt-1 text-[10px]">
                    {formatBytes(img.bytes)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <Button asChild variant="ghost">
              <Link href="/dashboard/products">Cancel</Link>
            </Button>
            <Button onClick={() => setStep('details')} disabled={images.length === 0}>
              Continue
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </Card>
      )}

      {/* ── step 2 ─────────────────────────────────────────────────────── */}
      {step === 'details' && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Product details</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            This is what customers see on the public page.
          </p>

          <form action={(fd) => startTransition(() => void handleDetails(fd))} className="mt-5 space-y-4">
            <Field label="Product name" htmlFor="name" required>
              <Input id="name" name="name" required autoFocus placeholder="Butter Chicken" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Price" htmlFor="price" hint="Leave blank to hide the price.">
                <Input id="price" name="price" type="number" step="0.01" min="0" placeholder="299" />
              </Field>
              <Field label="SKU" htmlFor="sku">
                <Input id="sku" name="sku" placeholder="Optional" />
              </Field>
            </div>

            <Field label="Description" htmlFor="description">
              <Textarea
                id="description"
                name="description"
                rows={3}
                placeholder="Creamy tomato-based curry with tender chicken."
              />
            </Field>

            <Field
              label="Placement"
              htmlFor="placement"
              hint="Where the object rests when a customer places it."
            >
              <Select id="placement" name="placement" defaultValue="tabletop">
                {PLACEMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {PLACEMENT_LABELS[m as PlacementMode]}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="rounded-xl border p-4">
              <legend className="px-1 text-sm font-medium">Real-world size</legend>
              <p className="text-muted-foreground mb-3 text-xs">
                Drives how large the product appears in AR. A dinner plate is about 26 cm wide.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Width (cm)" htmlFor="dimWidth">
                  <Input id="dimWidth" name="dimWidth" type="number" step="0.1" min="0" />
                </Field>
                <Field label="Height (cm)" htmlFor="dimHeight">
                  <Input id="dimHeight" name="dimHeight" type="number" step="0.1" min="0" />
                </Field>
                <Field label="Depth (cm)" htmlFor="dimDepth">
                  <Input id="dimDepth" name="dimDepth" type="number" step="0.1" min="0" />
                </Field>
              </div>
            </fieldset>

            <div className="flex justify-between pt-1">
              <Button type="button" variant="ghost" onClick={() => setStep('upload')}>
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Continue'}
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── step 3 ─────────────────────────────────────────────────────── */}
      {step === 'generate' && jobId && productId && (
        <GenerationProgress jobId={jobId} productId={productId} productName={productName} />
      )}

      {step === 'generate' && !jobId && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Add a 3D model</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Your product is saved as a draft. It needs a 3D model before it can be viewed in AR.
          </p>

          {generation.available ? (
            <div className="mt-5 space-y-3">
              <div className="border-primary/30 bg-primary/5 rounded-xl border p-5">
                <div className="flex items-start gap-3">
                  <Cpu className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Generate from your images</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Using {generation.providerName}. Generation runs in the background — you
                      can leave this page and come back.
                    </p>
                  </div>
                </div>
                <Button className="mt-4 w-full" onClick={() => void handleGenerate()} disabled={busy}>
                  Generate 3D model
                </Button>
              </div>

              <UploadGlbAlternative productId={productId} />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {/*
                The honest state. No provider is connected, so generation is not
                offered at all — showing a disabled button with a tooltip would
                still imply the feature exists and merely needs a click.
              */}
              <Alert variant="warning">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <div>
                    <p className="font-medium">AI generation isn’t connected</p>
                    <p className="mt-1 text-sm leading-relaxed">{generation.reason}</p>
                  </div>
                </div>
              </Alert>

              <UploadGlbAlternative productId={productId} emphasised />
            </div>
          )}

          <div className="mt-6 flex justify-between border-t pt-4">
            <Button asChild variant="ghost">
              <Link href={productId ? `/dashboard/products/${productId}` : '/dashboard/products'}>
                Skip for now
              </Link>
            </Button>
            {productId && (
              <Button asChild variant="outline">
                <Link href={`/dashboard/products/${productId}`}>Open product</Link>
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

/** The path that always works: attach a GLB the business already has. */
function UploadGlbAlternative({
  productId,
  emphasised = false,
}: {
  productId: string | null
  emphasised?: boolean
}) {
  return (
    <div className={cn('rounded-xl border p-5', emphasised && 'border-primary/30 bg-primary/5')}>
      <div className="flex items-start gap-3">
        <ImageIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Upload a 3D model you already have</p>
          <p className="text-muted-foreground mt-1 text-sm">
            A GLB exported from Blender or supplied by your 3D artist. Everything downstream —
            AR, QR codes, analytics — works identically.
          </p>
        </div>
      </div>
      <Button asChild variant={emphasised ? 'default' : 'outline'} className="mt-4 w-full">
        <Link href={productId ? `/dashboard/models?product=${productId}` : '/dashboard/models'}>
          Upload a GLB
        </Link>
      </Button>
    </div>
  )
}
