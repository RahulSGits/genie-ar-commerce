import { withApiKey, apiOk, apiError, readJson } from '@/lib/api/handler'
import { serializeProduct } from '@/lib/api/serialize'
import { getProduct, getModel, updateProduct } from '@/lib/db/repositories/catalog'
import { emitWebhook } from '@/lib/webhooks/dispatch'

/**
 * GET   /api/v1/products/:id
 * PATCH /api/v1/products/:id
 */

type Params = { id: string }

export const GET = withApiKey<Params>('products:read', async ({ businessId, params }) => {
  const product = getProduct(businessId, params.id)
  // getProduct is already tenant-scoped, so a product belonging to another
  // business is indistinguishable from one that does not exist — which is the
  // correct answer to give.
  if (!product) return apiError('not_found', 'No product with that id.')

  const model = product.modelId ? getModel(businessId, product.modelId) : null
  return apiOk({ data: serializeProduct(product, model) })
})

/** Fields a key holder may change, mapped to repository field names. */
const PATCHABLE = [
  'name',
  'description',
  'shortDescription',
  'sku',
  'priceMinor',
  'imageUrl',
  'status',
  'arEnabled',
  'isAvailable',
  'ctaLabel',
  'ctaUrl',
] as const

export const PATCH = withApiKey<Params>('products:write', async ({ businessId, params, request }) => {
  const existing = getProduct(businessId, params.id)
  if (!existing) return apiError('not_found', 'No product with that id.')

  const parsed = await readJson(request)
  if (!parsed.ok) return parsed.response

  const patch: Record<string, unknown> = {}
  for (const field of PATCHABLE) {
    // `in` rather than a truthiness check: setting a description to null is a
    // legitimate edit, and a truthiness check would silently drop it.
    if (field in parsed.body) patch[field] = parsed.body[field]
  }

  if (Object.keys(patch).length === 0) {
    return apiError('invalid_request', `No writable fields present. Allowed: ${PATCHABLE.join(', ')}.`)
  }

  if ('priceMinor' in patch && patch.priceMinor !== null && !Number.isInteger(patch.priceMinor)) {
    return apiError('invalid_request', '`priceMinor` must be an integer in minor units.')
  }
  if ('status' in patch && !['draft', 'published', 'archived'].includes(String(patch.status))) {
    return apiError('invalid_request', '`status` must be draft, published or archived.')
  }

  updateProduct(businessId, params.id, patch)

  const updated = getProduct(businessId, params.id)
  if (!updated) return apiError('server_error', 'The product could not be read back.')

  emitWebhook(businessId, 'product.updated', { productId: updated.id, fields: Object.keys(patch) })
  if (existing.status !== 'published' && updated.status === 'published') {
    emitWebhook(businessId, 'product.published', { productId: updated.id, slug: updated.slug })
  }
  if (existing.status === 'published' && updated.status !== 'published') {
    emitWebhook(businessId, 'product.unpublished', { productId: updated.id, slug: updated.slug })
  }

  const model = updated.modelId ? getModel(businessId, updated.modelId) : null
  return apiOk({ data: serializeProduct(updated, model) })
})
