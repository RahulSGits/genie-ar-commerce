'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { requireBusiness } from '@/lib/auth/guards'
import { createProduct, productSlugAvailable, updateProduct, createModel } from '@/lib/db/repositories/catalog'
import {
  createProductImage, attachImagesToProduct, createJob, updateJob, failJob, getJob,
  createCollection, setCollectionProducts, updateCollection, deleteCollection,
} from '@/lib/db/repositories/generation'
import { getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { canCreateProduct, canUploadBytes } from '@/lib/billing/entitlements'
import { getFeatureFlags } from '@/lib/db/repositories/platform'
import { validateImageUpload, safeStorageName, MAX_IMAGE_BYTES } from '@/lib/storage/modelValidation'
import { getProvider, generationAvailable, GenerationUnavailableError } from '@/lib/ai3d/provider'
import { slugify } from '@/lib/utils'
import { guarded, type ActionResult } from '@/lib/auth/errors'
import { PLACEMENT_MODES } from '@/config/terminology'

/**
 * GENIE creation flow: upload images → product details → generate 3D.
 *
 * The honesty rule from lib/ai3d/provider.ts is enforced here at the action
 * boundary: `startGenerationAction` refuses to create a job at all when no
 * provider is configured, so there is no state in which the UI can show
 * progress for work that is not happening.
 */

const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads')

/* ── image upload ───────────────────────────────────────────────────────── */

export type UploadedImage = { id: string; url: string; bytes: number }

/**
 * Stores one or more source images. Returns their ids so the client can carry
 * them into the details step before a product row exists — uploading first,
 * naming second is the order users actually work in.
 */
export async function uploadImagesAction(
  _prev: ActionResult<UploadedImage[]> | null,
  formData: FormData,
): Promise<ActionResult<UploadedImage[]>> {
  return guarded(async () => {
    const ctx = await requireBusiness()
    const files = formData.getAll('images').filter((f): f is File => f instanceof File && f.size > 0)

    if (files.length === 0) throw new Error('Choose at least one image.')
    if (files.length > 8) throw new Error('Up to 8 images per product.')

    const total = files.reduce((sum, f) => sum + f.size, 0)
    const gate = canUploadBytes(getEntitlements(ctx.businessId), getUsage(ctx.businessId), total)
    if (!gate.allowed) throw new Error(gate.message)

    const dir = path.join(UPLOAD_ROOT, ctx.businessId, 'images')
    await mkdir(dir, { recursive: true })

    const saved: UploadedImage[] = []
    for (const [index, file] of files.entries()) {
      if (file.size > MAX_IMAGE_BYTES) {
        throw new Error(
          `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit.`,
        )
      }

      const bytes = new Uint8Array(await file.arrayBuffer())
      // Validated against the actual bytes; the browser's type and filename are
      // treated as hints only.
      const check = validateImageUpload(bytes, file.size)
      if (!check.ok) throw new Error(`“${file.name}”: ${check.error}`)

      const id = crypto.randomUUID()
      const name = safeStorageName(file.name, id)
      await writeFile(path.join(dir, name), bytes)

      const url = `/uploads/${ctx.businessId}/images/${name}`
      createProductImage({
        businessId: ctx.businessId,
        url,
        bytes: file.size,
        mime: check.mime,
        role: index === 0 ? 'primary' : 'angle',
        sortOrder: index,
      })
      saved.push({ id, url, bytes: file.size })
    }

    return saved
  })
}

/* ── product creation ───────────────────────────────────────────────────── */

const detailsSchema = z.object({
  name: z.string().trim().min(2, 'Give the product a name.').max(120),
  category: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  price: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  sku: z.string().trim().max(60).optional().nullable(),
  placement: z.enum(PLACEMENT_MODES).default('tabletop'),
  dimWidth: z.coerce.number().min(0).max(10_000).optional().nullable(),
  dimHeight: z.coerce.number().min(0).max(10_000).optional().nullable(),
  dimDepth: z.coerce.number().min(0).max(10_000).optional().nullable(),
  imageUrls: z.string().optional(),
})

/**
 * Creates the draft product and attaches the uploaded images to it.
 * Deliberately does NOT start generation — that is a separate, explicit step so
 * a user can create a product and attach a GLB they already own.
 */
export async function createDraftProductAction(
  _prev: ActionResult<{ productId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ productId: string }>> {
  return guarded(async () => {
    const ctx = await requireBusiness()

    const gate = canCreateProduct(getEntitlements(ctx.businessId), getUsage(ctx.businessId))
    if (!gate.allowed) throw new Error(gate.message)

    const parsed = detailsSchema.safeParse(Object.fromEntries(formData.entries()))
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the form.')
    const d = parsed.data

    let base = slugify(d.name) || `product-${Date.now().toString(36)}`
    let slug = base
    let n = 1
    while (!productSlugAvailable(ctx.businessId, slug)) slug = `${base}-${++n}`

    const imageIds = String(formData.get('imageIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const primaryUrl = String(formData.get('primaryImageUrl') ?? '') || null

    const productId = createProduct(ctx.businessId, {
      name: d.name,
      slug,
      description: d.description ?? null,
      sku: d.sku ?? null,
      priceMinor: d.price === null || d.price === undefined ? null : Math.round(d.price * 100),
      imageUrl: primaryUrl,
      placement: d.placement,
      dimWidth: d.dimWidth ?? null,
      dimHeight: d.dimHeight ?? null,
      dimDepth: d.dimDepth ?? null,
      status: 'draft',
      arEnabled: true,
    })

    if (imageIds.length) attachImagesToProduct(ctx.businessId, imageIds, productId)

    revalidatePath('/dashboard/products')
    return { productId }
  })
}

/* ── generation ─────────────────────────────────────────────────────────── */

/**
 * Starts an AI generation job.
 *
 * Throws — loudly and specifically — when no provider is connected, rather than
 * creating a job that could never succeed. The UI turns that message into a
 * "connect a provider or upload a GLB" state.
 */
export async function startGenerationAction(
  productId: string,
): Promise<ActionResult<{ jobId: string }>> {
  return guarded(async () => {
    const ctx = await requireBusiness()

    const flags = getFeatureFlags()
    const availability = generationAvailable(flags.model_generation)
    if (!availability.available) {
      throw new GenerationUnavailableError(availability.reason ?? 'AI generation is unavailable.')
    }

    const provider = getProvider()
    const jobId = createJob({
      businessId: ctx.businessId,
      productId,
      provider: provider.id,
      imageIds: [],
    })

    try {
      const { providerJobId } = await provider.start({
        imageUrls: [],
        productName: '',
      })
      updateJob(ctx.businessId, jobId, {
        providerJobId,
        status: 'running',
        stage: 'analyzing',
        startedAt: new Date().toISOString(),
      })
    } catch (err) {
      const message =
        err instanceof GenerationUnavailableError
          ? err.message
          : 'The generation provider rejected the request.'
      failJob(ctx.businessId, jobId, 'provider_error', message)
      throw new Error(message)
    }

    revalidatePath(`/dashboard/products/${productId}`)
    return { jobId }
  })
}

/** Polled by the progress UI. Reads provider state and advances the job. */
export async function pollGenerationAction(jobId: string): Promise<
  ActionResult<{
    status: string
    stage: string
    progress: number | null
    errorMessage: string | null
  }>
> {
  return guarded(async () => {
    const ctx = await requireBusiness()
    const job = getJob(ctx.businessId, jobId)
    if (!job) throw new Error('That generation job no longer exists.')

    // Terminal states need no provider round-trip.
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return {
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        errorMessage: job.errorMessage,
      }
    }

    const provider = getProvider()
    if (!job.providerJobId || !provider.isConfigured()) {
      failJob(ctx.businessId, jobId, 'not_configured', 'No AI 3D provider is connected.')
      return {
        status: 'failed',
        stage: job.stage,
        progress: null,
        errorMessage: 'No AI 3D provider is connected.',
      }
    }

    const progress = await provider.getStatus(job.providerJobId)

    if (progress.status === 'succeeded' && progress.result && job.productId) {
      // The provider produced an asset: register it and attach it to the product.
      const modelId = createModel({
        businessId: ctx.businessId,
        name: job.productName ?? 'Generated model',
        glbUrl: progress.result.glbUrl,
        usdzUrl: progress.result.usdzUrl ?? null,
        posterUrl: progress.result.posterUrl ?? null,
        fileSizeBytes: progress.result.fileSizeBytes ?? 0,
        format: 'glb',
        triangleCount: progress.result.triangleCount ?? null,
        status: 'ready',
      })
      updateProduct(ctx.businessId, job.productId, { modelId })
      updateJob(ctx.businessId, jobId, {
        status: 'succeeded',
        stage: 'complete',
        progress: 100,
        modelId,
        finishedAt: new Date().toISOString(),
      })
      revalidatePath(`/dashboard/products/${job.productId}`)
    } else {
      updateJob(ctx.businessId, jobId, {
        status: progress.status,
        stage: progress.stage,
        progress: progress.progress,
        errorCode: progress.errorCode ?? null,
        errorMessage: progress.errorMessage ?? null,
        finishedAt: progress.status === 'failed' ? new Date().toISOString() : null,
      })
    }

    return {
      status: progress.status,
      stage: progress.stage,
      progress: progress.progress,
      errorMessage: progress.errorMessage ?? null,
    }
  })
}

export async function publishProductAction(productId: string): Promise<void> {
  const ctx = await requireBusiness()
  updateProduct(ctx.businessId, productId, { status: 'published' })
  revalidatePath('/dashboard/products')
  revalidatePath(`/dashboard/products/${productId}`)
}

/* ── collections ────────────────────────────────────────────────────────── */

export async function createCollectionAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requireBusiness()
    const name = String(formData.get('name') ?? '').trim()
    if (name.length < 2) throw new Error('Give the collection a name.')

    createCollection({
      businessId: ctx.businessId,
      name: name.slice(0, 80),
      slug: slugify(name) || `collection-${Date.now().toString(36)}`,
      description: String(formData.get('description') ?? '') || null,
    })

    revalidatePath('/dashboard/collections')
    return null
  })
}

export async function setCollectionProductsAction(
  collectionId: string,
  productIds: string[],
): Promise<void> {
  const ctx = await requireBusiness()
  setCollectionProducts(ctx.businessId, collectionId, productIds)
  revalidatePath('/dashboard/collections')
}

export async function updateCollectionAction(
  collectionId: string,
  patch: { name?: string; description?: string | null; isPublished?: boolean },
): Promise<void> {
  const ctx = await requireBusiness()
  updateCollection(ctx.businessId, collectionId, patch)
  revalidatePath('/dashboard/collections')
}

export async function deleteCollectionAction(collectionId: string): Promise<void> {
  const ctx = await requireBusiness()
  deleteCollection(ctx.businessId, collectionId)
  revalidatePath('/dashboard/collections')
  redirect('/dashboard/collections')
}
