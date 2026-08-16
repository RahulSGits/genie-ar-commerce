import { withApiKey, apiOk, apiError, readJson, pageLimit } from '@/lib/api/handler'
import { serializeProduct } from '@/lib/api/serialize'
import {
  listProducts,
  createProduct,
  getProduct,
  productSlugAvailable,
} from '@/lib/db/repositories/catalog'
import { getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { canCreateProduct } from '@/lib/billing/entitlements'
import { emitWebhook } from '@/lib/webhooks/dispatch'
import { slugify } from '@/lib/utils'
import type { ProductStatus } from '@/types/domain'

/**
 * GET  /api/v1/products   — list
 * POST /api/v1/products   — create
 *
 * Plan limits are enforced here exactly as they are in the dashboard. An API
 * that ignores the quota the UI enforces is not an integration surface, it is
 * a way to buy Starter and use Business.
 */

export const GET = withApiKey('products:read', async ({ businessId, request }) => {
  const params = request.nextUrl.searchParams
  const status = params.get('status')

  const limit = pageLimit(request)
  const offset = Math.max(0, Number(params.get('offset')) || 0)

  // Paginated in SQL, not by slicing a full table read — the repository
  // already returns the unpaginated total alongside the page.
  const { rows, total } = listProducts(businessId, {
    status: status ? (status as ProductStatus) : undefined,
    search: params.get('search') ?? undefined,
    limit,
    offset,
  })

  return apiOk({
    data: rows.map((product) => serializeProduct(product, product.model)),
    pagination: { total, limit, offset, hasMore: offset + rows.length < total },
  })
})

export const POST = withApiKey('products:write', async ({ businessId, request }) => {
  const parsed = await readJson(request)
  if (!parsed.ok) return parsed.response

  const body = parsed.body
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name === '') return apiError('invalid_request', '`name` is required.')

  const entitlements = getEntitlements(businessId)
  const allowed = canCreateProduct(entitlements, getUsage(businessId))
  if (!allowed.allowed) {
    return apiError('plan_required', allowed.message, {
      limit: allowed.limit,
      current: allowed.current,
    })
  }

  // A caller-supplied slug that collides would 500 on the unique index, so it
  // is resolved to a free one here and the final value is returned.
  const requested = typeof body.slug === 'string' && body.slug ? slugify(body.slug) : slugify(name)
  let slug = requested
  let suffix = 2
  while (!productSlugAvailable(businessId, slug)) {
    slug = `${requested}-${suffix++}`
    if (suffix > 100) return apiError('invalid_request', 'Could not derive a free slug.')
  }

  const price = body.priceMinor
  if (price !== undefined && price !== null && !Number.isInteger(price)) {
    return apiError(
      'invalid_request',
      '`priceMinor` must be an integer in minor units (349.50 is 34950).',
    )
  }

  const id = createProduct(businessId, {
    name,
    slug,
    description: asString(body.description),
    shortDescription: asString(body.shortDescription),
    sku: asString(body.sku),
    priceMinor: typeof price === 'number' ? price : null,
    imageUrl: asString(body.imageUrl),
    status: body.status === 'published' ? 'published' : 'draft',
  })

  const created = getProduct(businessId, id)
  if (!created) return apiError('server_error', 'The product could not be read back.')

  emitWebhook(businessId, 'product.created', { productId: id, name, slug })
  if (created.status === 'published') {
    emitWebhook(businessId, 'product.published', { productId: id, slug })
  }

  return apiOk({ data: serializeProduct(created) }, { status: 201 })
})

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
