'use server'

import { revalidatePath } from 'next/cache'
import { requirePermission } from '@/lib/auth/guards'
import { guarded, ok, badRequest, type ActionResult } from '@/lib/auth/errors'
import { getDb, now, type Row, str } from '@/lib/db'
import { getProduct, updateProduct, listProducts } from '@/lib/db/repositories/catalog'
import { createQrCode } from '@/lib/db/repositories/qr'
import { getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { canCreateQrCode } from '@/lib/billing/entitlements'
import { emitWebhook } from '@/lib/webhooks/dispatch'
import { recordAudit } from '@/lib/db/repositories/platform'
import { previewImport } from '@/lib/import/csv'
import { createProduct, productSlugAvailable, createCategory, listCategories } from '@/lib/db/repositories/catalog'
import { canCreateProduct } from '@/lib/billing/entitlements'
import { slugify } from '@/lib/utils'

/**
 * Approval workflow (§50), scheduled publishing (§51), bulk operations (§47)
 * and CSV import (§46).
 *
 * Grouped because they are the same shape of problem: operations that act on
 * many products at once, where a partial failure has to be reported honestly
 * rather than rounded up to "done".
 */

/* ── approval (§50) ─────────────────────────────────────────────────────── */

export async function submitForApprovalAction(productId: string): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('products:write')

    if (!ctx.requiresApproval) {
      badRequest('This workspace does not use approvals — publish directly instead.')
    }

    updateProduct(ctx.businessId, productId, { approvalStatus: 'pending' })
    revalidatePath('/dashboard/approvals')
    revalidatePath(`/dashboard/products/${productId}`)
    return null
  })
}

export async function decideApprovalAction(
  productId: string,
  decision: 'approved' | 'rejected',
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('approvals:decide')

    const product = getProduct(ctx.businessId, productId)
    if (!product) badRequest('That product no longer exists.')

    updateProduct(ctx.businessId, productId, {
      approvalStatus: decision,
      approvedBy: ctx.user.id,
      approvedAt: now(),
      // Approval is what makes a pending product publicly visible; rejection
      // leaves it published-but-hidden rather than silently deleting work.
      ...(decision === 'approved' ? { status: 'published' } : {}),
    })

    recordAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: `product.${decision}`,
      entityType: 'product',
      entityId: productId,
      businessId: ctx.businessId,
    })

    if (decision === 'approved') {
      emitWebhook(ctx.businessId, 'product.published', { productId, slug: product?.slug })
    }

    revalidatePath('/dashboard/approvals')
    revalidatePath(`/dashboard/products/${productId}`)
    return null
  })
}

export async function listPendingApprovalsAction() {
  const ctx = await requirePermission('products:read')
  const rows = getDb()
    .prepare(
      `SELECT id, name, slug, updated_at FROM products
        WHERE business_id = ? AND approval_status = 'pending' AND deleted_at IS NULL
        ORDER BY updated_at ASC`,
    )
    .all(ctx.businessId) as Row[]

  return {
    canDecide: ctx.role === 'owner' || ctx.role === 'admin' || ctx.role === 'manager',
    requiresApproval: ctx.requiresApproval,
    items: rows.map((row) => ({
      id: str(row, 'id'),
      name: str(row, 'name'),
      slug: str(row, 'slug'),
      updatedAt: str(row, 'updated_at'),
    })),
  }
}

/* ── scheduling (§51) ───────────────────────────────────────────────────── */

export async function scheduleProductAction(
  productId: string,
  publishAt: string | null,
  unpublishAt: string | null,
): Promise<ActionResult<null>> {
  return guarded(async () => {
    const ctx = await requirePermission('products:publish')

    const from = toIso(publishAt)
    const to = toIso(unpublishAt)
    if (from && to && to <= from) badRequest('The end time must be after the start time.')

    // Scheduling only means anything for a published product: visibility is
    // `status = 'published' AND within the window`, so leaving it a draft
    // would produce a schedule that silently never fires.
    const product = getProduct(ctx.businessId, productId)
    if (!product) badRequest('That product no longer exists.')

    updateProduct(ctx.businessId, productId, {
      publishAt: from,
      unpublishAt: to,
      ...(from && product?.status === 'draft' ? { status: 'published' } : {}),
    })

    revalidatePath(`/dashboard/products/${productId}`)
    revalidatePath('/dashboard/products')
    return null
  })
}

function toIso(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/* ── bulk operations (§47) ──────────────────────────────────────────────── */

export type BulkOutcome = {
  requested: number
  succeeded: number
  skipped: number
  /** Human-readable reasons, deduplicated. */
  reasons: string[]
}

export type BulkAction = 'publish' | 'unpublish' | 'archive' | 'tag' | 'category' | 'qr'

/**
 * Applies one action to many products.
 *
 * Reports `skipped` with reasons rather than failing the whole batch or
 * claiming a clean run. Bulk-publishing 300 products where 4 have no model is
 * a partial success, and telling the user "300 published" would be a lie they
 * discover from a customer.
 */
export async function bulkProductAction(
  action: BulkAction,
  productIds: string[],
  value?: string,
): Promise<ActionResult<BulkOutcome>> {
  return guarded(async () => {
    const permission =
      action === 'publish' || action === 'unpublish' || action === 'archive'
        ? 'products:publish'
        : action === 'qr'
          ? 'qr:write'
          : 'products:write'

    const ctx = await requirePermission(permission)

    if (productIds.length === 0) badRequest('Select at least one product.')
    if (productIds.length > 500) badRequest('Select at most 500 products at a time.')

    const outcome: BulkOutcome = {
      requested: productIds.length,
      succeeded: 0,
      skipped: 0,
      reasons: [],
    }
    const note = (reason: string) => {
      outcome.skipped += 1
      if (!outcome.reasons.includes(reason)) outcome.reasons.push(reason)
    }

    for (const id of productIds) {
      // Re-read per id rather than trusting the posted list: the tenant check
      // has to happen server-side for every single row.
      const product = getProduct(ctx.businessId, id)
      if (!product) {
        note('Some products no longer exist.')
        continue
      }

      switch (action) {
        case 'publish': {
          if (!product.imageUrl && !product.modelId) {
            note('Products with no photo and no 3D model were not published — there would be nothing to show.')
            continue
          }
          updateProduct(ctx.businessId, id, {
            status: 'published',
            approvalStatus: ctx.requiresApproval ? 'pending' : 'none',
          })
          if (!ctx.requiresApproval) {
            emitWebhook(ctx.businessId, 'product.published', { productId: id, slug: product.slug })
          }
          outcome.succeeded += 1
          break
        }
        case 'unpublish': {
          updateProduct(ctx.businessId, id, { status: 'draft' })
          emitWebhook(ctx.businessId, 'product.unpublished', { productId: id, slug: product.slug })
          outcome.succeeded += 1
          break
        }
        case 'archive': {
          updateProduct(ctx.businessId, id, { status: 'archived' })
          outcome.succeeded += 1
          break
        }
        case 'tag': {
          const tag = (value ?? '').trim()
          if (!tag) badRequest('Enter a tag to apply.')
          if (product.tags.includes(tag)) {
            note('Some products already had that tag.')
            continue
          }
          updateProduct(ctx.businessId, id, { tags: [...product.tags, tag] })
          outcome.succeeded += 1
          break
        }
        case 'category': {
          if (!value) badRequest('Choose a category.')
          updateProduct(ctx.businessId, id, { categoryId: value })
          outcome.succeeded += 1
          break
        }
        case 'qr': {
          // The quota is re-checked inside the loop, not once before it: a
          // batch of 50 against 10 remaining codes must stop at 10 rather than
          // create 50 and overrun the plan.
          const allowed = canCreateQrCode(getEntitlements(ctx.businessId), getUsage(ctx.businessId))
          if (!allowed.allowed) {
            note(allowed.message)
            continue
          }
          createQrCode({
            businessId: ctx.businessId,
            productId: id,
            label: product.name,
            destination: 'ar',
          })
          outcome.succeeded += 1
          break
        }
      }
    }

    revalidatePath('/dashboard/products')
    revalidatePath('/dashboard/qr')
    return outcome
  })
}

/* ── CSV import (§46) ───────────────────────────────────────────────────── */

export async function previewImportAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<ReturnType<typeof previewImport>>> {
  return guarded(async () => {
    await requirePermission('products:write')

    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) badRequest('Choose a .csv file.')

    const upload = file as File
    if (upload.size > 5_000_000) badRequest('That file is over the 5 MB import limit.')

    return previewImport(await upload.text())
  })
}

export type ImportOutcome = {
  created: number
  skipped: number
  reasons: string[]
}

/**
 * Commits rows the user has already seen in the preview.
 *
 * The rows are re-parsed from the same file rather than trusted from the
 * client, so what gets written is what the CSV says — a tampered payload
 * cannot smuggle a different product past the preview the user approved.
 */
export async function commitImportAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<ImportOutcome>> {
  return guarded(async () => {
    const ctx = await requirePermission('products:write')

    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) badRequest('Choose a .csv file.')

    const { rows } = previewImport(await (file as File).text())
    if (rows.length === 0) badRequest('There were no valid rows to import.')

    const outcome: ImportOutcome = { created: 0, skipped: 0, reasons: [] }
    const note = (reason: string) => {
      outcome.skipped += 1
      if (!outcome.reasons.includes(reason)) outcome.reasons.push(reason)
    }

    const categories = new Map(
      listCategories(ctx.businessId).map((c) => [c.name.toLowerCase(), c.id]),
    )

    for (const row of rows) {
      const allowed = canCreateProduct(getEntitlements(ctx.businessId), getUsage(ctx.businessId))
      if (!allowed.allowed) {
        note(allowed.message)
        // Every remaining row will hit the same ceiling; stopping here avoids
        // 500 identical failures.
        break
      }

      let categoryId: string | null = null
      if (row.category) {
        const key = row.category.toLowerCase()
        categoryId = categories.get(key) ?? null
        if (!categoryId) {
          categoryId = createCategory({
            businessId: ctx.businessId,
            name: row.category,
            slug: slugify(row.category),
          })
          categories.set(key, categoryId)
        }
      }

      const base = slugify(row.name)
      let slug = base
      let suffix = 2
      while (!productSlugAvailable(ctx.businessId, slug)) slug = `${base}-${suffix++}`

      createProduct(ctx.businessId, {
        name: row.name,
        slug,
        sku: row.sku,
        description: row.description,
        priceMinor: row.priceMinor,
        imageUrl: row.imageUrl,
        categoryId,
        tags: row.tags,
        dimWidth: row.dimWidth,
        dimHeight: row.dimHeight,
        dimDepth: row.dimDepth,
        status: 'draft',
      })
      outcome.created += 1
    }

    recordAudit({
      actorId: ctx.user.id,
      actorEmail: ctx.user.email,
      action: 'products.imported',
      entityType: 'product',
      businessId: ctx.businessId,
      metadata: outcome,
    })

    revalidatePath('/dashboard/products')
    return outcome
  })
}

/* ── export (§36) ───────────────────────────────────────────────────────── */

export async function exportProductsAction(): Promise<ActionResult<{ csv: string }>> {
  const ctx = await requirePermission('analytics:export')
  const { rows } = listProducts(ctx.businessId, { status: 'all', limit: 5000 })

  const { toCsv } = await import('@/lib/import/csv')
  const header = [
    'name', 'sku', 'status', 'price_minor', 'currency', 'category',
    'has_3d_model', 'ar_enabled', 'qr_codes', 'created_at',
  ]

  const csv = toCsv([
    header,
    ...rows.map((product) => [
      product.name,
      product.sku ?? '',
      product.status,
      product.priceMinor ?? '',
      product.currency,
      product.categoryName ?? '',
      product.modelId ? 'yes' : 'no',
      product.arEnabled ? 'yes' : 'no',
      product.qrCount,
      product.createdAt,
    ]),
  ])

  return ok({ csv })
}

/** Reads a saved value for a bulk category picker. Kept adjacent to its users. */
export async function bulkTargetsAction(): Promise<{ id: string; name: string }[]> {
  const ctx = await requirePermission('products:read')
  return listCategories(ctx.businessId).map((c) => ({ id: c.id, name: c.name }))
}
