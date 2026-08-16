'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireBusiness } from '@/lib/auth/guards'
import {
  createProduct, updateProduct, deleteProduct, productSlugAvailable,
  createModel, updateModel, deleteModel, createCategory, listModels, getModel,
} from '@/lib/db/repositories/catalog'
import {
  createQrCode, updateQrCode, deleteQrCode, regenerateQrToken,
} from '@/lib/db/repositories/qr'
import { getEntitlements, getUsage, updateBusiness } from '@/lib/db/repositories/businesses'
import { createTicket, replyToTicket } from '@/lib/db/repositories/crm'
import {
  canCreateProduct, canCreateArModel, canCreateQrCode, canUploadBytes,
} from '@/lib/billing/entitlements'
import { validateModelUpload, safeStorageName, MAX_MODEL_BYTES } from '@/lib/storage/modelValidation'
import { scoreGlb } from '@/lib/quality/score'
import { emitWebhook } from '@/lib/webhooks/dispatch'
import { slugify } from '@/lib/utils'
import { guarded, fail, type ActionResult } from '@/lib/auth/errors'
import { PLACEMENT_MODES } from '@/config/terminology'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Business-side server actions.
 *
 * Every one of these re-resolves the caller's business from the session rather
 * than trusting a businessId from the form. That is the IDOR gate: a crafted
 * POST cannot touch another tenant's rows because the tenant is never an input.
 */

/* ── products ───────────────────────────────────────────────────────────── */

const productSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  shortDescription: z.string().trim().max(200).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable().or(z.literal('')),
  modelId: z.string().uuid().optional().nullable().or(z.literal('')),
  // Rupees in the form; converted to integer paise before it reaches the DB.
  price: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  compareAt: z.coerce.number().min(0).max(10_000_000).optional().nullable(),
  dimWidth: z.coerce.number().min(0).max(10_000).optional().nullable(),
  dimHeight: z.coerce.number().min(0).max(10_000).optional().nullable(),
  dimDepth: z.coerce.number().min(0).max(10_000).optional().nullable(),
  dimUnit: z.enum(['mm', 'cm', 'm', 'in', 'ft']).default('cm'),
  placement: z.enum(PLACEMENT_MODES).default('tabletop'),
  ctaLabel: z.string().trim().max(40).optional().nullable(),
  ctaUrl: z.string().trim().url('Enter a valid URL.').optional().nullable().or(z.literal('')),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  diet: z.enum(['veg', 'non-veg', 'egg']).optional().nullable().or(z.literal('')),
  arEnabled: z.coerce.boolean().default(true),
  isBestseller: z.coerce.boolean().default(false),
  isFeatured: z.coerce.boolean().default(false),
})

function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of formData.entries()) {
    if (typeof v === 'string') out[k] = v === '' ? null : v
  }
  // Unchecked checkboxes are simply absent from FormData.
  for (const key of ['arEnabled', 'isBestseller', 'isFeatured']) {
    out[key] = formData.get(key) === 'on' || formData.get(key) === 'true'
  }
  return out
}

const toPaise = (rupees: number | null | undefined) =>
  rupees === null || rupees === undefined ? null : Math.round(rupees * 100)

export async function createProductAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const ctx = await requireBusiness()

  const gate = canCreateProduct(getEntitlements(ctx.businessId), getUsage(ctx.businessId))
  if (!gate.allowed) return fail(gate.message)

  const parsed = productSchema.safeParse(formToObject(formData))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Check the form.', String(issue?.path[0] ?? ''))
  }
  const input = parsed.data

  let slug = slugify(input.name) || `product-${Date.now().toString(36)}`
  let attempt = slug
  let n = 1
  while (!productSlugAvailable(ctx.businessId, attempt)) attempt = `${slug}-${++n}`

  createProduct(ctx.businessId, {
    name: input.name,
    slug: attempt,
    description: input.description ?? null,
    shortDescription: input.shortDescription ?? null,
    categoryId: input.categoryId || null,
    modelId: input.modelId || null,
    priceMinor: toPaise(input.price),
    compareAtMinor: toPaise(input.compareAt),
    dimWidth: input.dimWidth ?? null,
    dimHeight: input.dimHeight ?? null,
    dimDepth: input.dimDepth ?? null,
    dimUnit: input.dimUnit,
    placement: input.placement,
    ctaLabel: input.ctaLabel ?? null,
    ctaUrl: input.ctaUrl || null,
    status: input.status,
    diet: (input.diet || null) as 'veg' | 'non-veg' | 'egg' | null,
    arEnabled: input.arEnabled,
    isBestseller: input.isBestseller,
    isFeatured: input.isFeatured,
  })

  revalidatePath('/dashboard/products')
  redirect('/dashboard/products')
}

export async function updateProductAction(
  productId: string,
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const ctx = await requireBusiness()
  const parsed = productSchema.safeParse(formToObject(formData))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Check the form.', String(issue?.path[0] ?? ''))
  }
  const input = parsed.data

  updateProduct(ctx.businessId, productId, {
    name: input.name,
    description: input.description ?? null,
    shortDescription: input.shortDescription ?? null,
    categoryId: input.categoryId || null,
    modelId: input.modelId || null,
    priceMinor: toPaise(input.price),
    compareAtMinor: toPaise(input.compareAt),
    dimWidth: input.dimWidth ?? null,
    dimHeight: input.dimHeight ?? null,
    dimDepth: input.dimDepth ?? null,
    dimUnit: input.dimUnit,
    placement: input.placement,
    ctaLabel: input.ctaLabel ?? null,
    ctaUrl: input.ctaUrl || null,
    status: input.status,
    diet: input.diet || null,
    arEnabled: input.arEnabled,
    isBestseller: input.isBestseller,
    isFeatured: input.isFeatured,
  })

  revalidatePath('/dashboard/products')
  revalidatePath(`/dashboard/products/${productId}`)
  return { ok: true, data: null }
}

export async function deleteProductAction(productId: string): Promise<void> {
  const ctx = await requireBusiness()
  deleteProduct(ctx.businessId, productId)
  revalidatePath('/dashboard/products')
  redirect('/dashboard/products')
}

export async function setProductStatusAction(productId: string, status: string): Promise<void> {
  const ctx = await requireBusiness()
  if (!['draft', 'published', 'archived'].includes(status)) return
  updateProduct(ctx.businessId, productId, { status })
  revalidatePath('/dashboard/products')
}

/* ── 3D models ──────────────────────────────────────────────────────────── */

/**
 * Model upload.
 *
 * The file is validated server-side against its actual bytes — the browser's
 * reported MIME type and filename are treated as hints, never as evidence.
 * Files land under public/uploads with a generated name, so a hostile filename
 * cannot escape the directory.
 */
export async function uploadModelAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requireBusiness()
    const file = formData.get('file')
    const name = String(formData.get('name') ?? '').trim()

    if (!(file instanceof File) || file.size === 0) {
      throw new Error('Choose a .glb file to upload.')
    }
    if (file.size > MAX_MODEL_BYTES) {
      throw new Error(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_MODEL_BYTES / 1024 / 1024} MB limit.`,
      )
    }

    const entitlements = getEntitlements(ctx.businessId)
    const usage = getUsage(ctx.businessId)

    const countGate = canCreateArModel(entitlements, usage)
    if (!countGate.allowed) throw new Error(countGate.message)

    const sizeGate = canUploadBytes(entitlements, usage, file.size)
    if (!sizeGate.allowed) throw new Error(sizeGate.message)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const validation = validateModelUpload(bytes, file.name, file.size)
    if (!validation.ok) throw new Error(validation.error)

    // Scored before anything is written. The report is measured from these
    // exact bytes, so the number shown next to the model is a property of the
    // file rather than a claim about it.
    const quality = scoreGlb(bytes)
    if (quality.error) throw new Error(quality.error)

    const modelId = crypto.randomUUID()
    const safeName = safeStorageName(file.name, modelId)
    const dir = path.join(process.cwd(), 'public', 'uploads', ctx.businessId)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, safeName), bytes)

    const replacesId = String(formData.get('replacesId') ?? '').trim() || null
    // Replacing keeps the old row rather than overwriting it, so a published
    // experience is never destroyed by an upload — the customer-facing page
    // keeps serving the previous version until the product is repointed.
    if (replacesId && !getModel(ctx.businessId, replacesId)) {
      throw new Error('The model being replaced no longer exists.')
    }

    createModel({
      businessId: ctx.businessId,
      name: name || file.name.replace(/\.[^.]+$/, ''),
      glbUrl: `/uploads/${ctx.businessId}/${safeName}`,
      fileSizeBytes: file.size,
      format: validation.format,
      // Validation has already passed, so it is immediately usable.
      status: 'ready',
      quality,
      replacesId,
    })

    revalidatePath('/dashboard/models')
    return null
  })
}

export async function deleteModelAction(modelId: string): Promise<void> {
  const ctx = await requireBusiness()
  deleteModel(ctx.businessId, modelId)
  revalidatePath('/dashboard/models')
}

export async function renameModelAction(modelId: string, name: string): Promise<void> {
  const ctx = await requireBusiness()
  updateModel(ctx.businessId, modelId, { name: name.trim().slice(0, 120) })
  revalidatePath('/dashboard/models')
}

/* ── QR codes ───────────────────────────────────────────────────────────── */

export async function createQrAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requireBusiness()
    const gate = canCreateQrCode(getEntitlements(ctx.businessId), getUsage(ctx.businessId))
    if (!gate.allowed) throw new Error(gate.message)

    const productId = String(formData.get('productId') ?? '') || null
    const label = String(formData.get('label') ?? '').trim()
    const destination = String(formData.get('destination') ?? 'ar')
    const campaign = String(formData.get('campaign') ?? '').trim() || null

    if (!['ar', 'product', 'menu', 'website', 'custom'].includes(destination)) {
      throw new Error('Choose a valid destination.')
    }

    createQrCode({
      businessId: ctx.businessId,
      productId,
      label: label || 'Untitled code',
      destination: destination as 'ar' | 'product' | 'menu' | 'website' | 'custom',
      customUrl: String(formData.get('customUrl') ?? '').trim() || null,
      campaign,
    })

    revalidatePath('/dashboard/qr')
    return null
  })
}

export async function toggleQrAction(qrId: string, isActive: boolean): Promise<void> {
  const ctx = await requireBusiness()
  updateQrCode(ctx.businessId, qrId, { isActive })
  revalidatePath('/dashboard/qr')
}

/** Issues a new token — every printed copy of the old one stops working. */
export async function regenerateQrAction(qrId: string): Promise<void> {
  const ctx = await requireBusiness()
  regenerateQrToken(ctx.businessId, qrId)
  revalidatePath('/dashboard/qr')
}

export async function deleteQrAction(qrId: string): Promise<void> {
  const ctx = await requireBusiness()
  deleteQrCode(ctx.businessId, qrId)
  revalidatePath('/dashboard/qr')
}

/* ── business profile ───────────────────────────────────────────────────── */

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  category: z.string().trim(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  address: z.string().trim().max(300).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #e8623c').optional().nullable().or(z.literal('')),
  websiteUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
  instagramUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
  orderingUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
  menuUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
  storeUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
  whatsappNumber: z.string().trim().max(30).optional().nullable(),
  // Brand Studio writes these. Without them declared, zod's non-strict object
  // dropped them silently — the user pasted a logo URL, saw "Branding saved",
  // and got no logo.
  logoUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
  coverUrl: z.string().trim().url().optional().nullable().or(z.literal('')),
})

/** Form field → database column, for the patch below. */
const PROFILE_COLUMNS: Record<string, string> = {
  name: 'name',
  description: 'description',
  category: 'category',
  phone: 'phone',
  email: 'email',
  address: 'address',
  city: 'city',
  brandColor: 'brand_color',
  websiteUrl: 'website_url',
  instagramUrl: 'instagram_url',
  orderingUrl: 'ordering_url',
  menuUrl: 'menu_url',
  storeUrl: 'store_url',
  whatsappNumber: 'whatsapp_number',
  logoUrl: 'logo_url',
  coverUrl: 'cover_url',
}

export async function updateProfileAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const ctx = await requireBusiness()
  const parsed = profileSchema.safeParse(formToObject(formData))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(issue?.message ?? 'Check the form.', String(issue?.path[0] ?? ''))
  }
  const d = parsed.data as Record<string, unknown>

  // A PATCH, not a full-row write.
  //
  // Previously every declared field was sent regardless, so a form that only
  // exposed some of them — Brand Studio, say — wrote NULL over the rest. Two
  // tabs open on different profile pages would clobber each other, and the
  // second save silently erased whatever the first had set.
  //
  // Only keys the form actually submitted are written. `status` and `slug`
  // remain outside updateBusiness's writable list, so a business still cannot
  // suspend or rename itself here, and internal notes are not reachable at all.
  const patch: Record<string, unknown> = {}
  for (const [field, column] of Object.entries(PROFILE_COLUMNS)) {
    if (!formData.has(field)) continue
    const value = d[field]
    // '' means "cleared" for optional fields, and NULL is the honest storage
    // for that — but it must be an explicit submission, not an absent one.
    patch[column] = value === '' || value === undefined ? null : value
  }

  if (Object.keys(patch).length === 0) {
    return fail('Nothing to save.')
  }

  updateBusiness(ctx.businessId, patch)

  revalidatePath('/dashboard/business')
  revalidatePath('/dashboard/brand')
  return { ok: true, data: null }
}

/* ── categories ─────────────────────────────────────────────────────────── */

export async function createCategoryAction(name: string): Promise<void> {
  const ctx = await requireBusiness()
  const trimmed = name.trim()
  if (!trimmed) return
  createCategory({
    businessId: ctx.businessId,
    name: trimmed.slice(0, 60),
    slug: slugify(trimmed) || `category-${Date.now().toString(36)}`,
  })
  revalidatePath('/dashboard/products')
}

/* ── support ────────────────────────────────────────────────────────────── */

export async function createTicketAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requireBusiness()
    const subject = String(formData.get('subject') ?? '').trim()
    const body = String(formData.get('body') ?? '').trim()
    if (subject.length < 3) throw new Error('Give your issue a subject.')
    if (body.length < 10) throw new Error('Describe the issue in a little more detail.')

    createTicket({
      businessId: ctx.businessId,
      openedBy: ctx.user.id,
      subject: subject.slice(0, 160),
      category: String(formData.get('category') ?? 'technical'),
      priority: String(formData.get('priority') ?? 'normal'),
      body,
    })

    revalidatePath('/dashboard/support')
    return null
  })
}

export async function replyTicketAction(ticketId: string, body: string): Promise<void> {
  const ctx = await requireBusiness()
  const trimmed = body.trim()
  if (!trimmed) return
  replyToTicket({ ticketId, authorId: ctx.user.id, isStaff: false, body: trimmed })
  revalidatePath('/dashboard/support')
}

/** Model list for the product form's dropdown. */
export async function listModelsForPicker() {
  const ctx = await requireBusiness()
  return listModels(ctx.businessId).filter((m) => m.status === 'ready')
}
