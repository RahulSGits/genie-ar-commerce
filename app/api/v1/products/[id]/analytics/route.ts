import { withApiKey, apiOk, apiError } from '@/lib/api/handler'
import { getProduct } from '@/lib/db/repositories/catalog'
import { getProductFunnel } from '@/lib/db/repositories/analytics'

/**
 * GET /api/v1/products/:id/analytics?days=30
 *
 * Returns raw counts, not derived percentages. A caller building a dashboard
 * wants the numerator and denominator so their own rounding matches their own
 * charts — handing over a pre-rounded "38%" makes that impossible.
 */

type Params = { id: string }

export const GET = withApiKey<Params>('analytics:read', async ({ businessId, params, request }) => {
  const product = getProduct(businessId, params.id)
  if (!product) return apiError('not_found', 'No product with that id.')

  const requested = Number(request.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 365) : 30

  return apiOk({
    data: {
      productId: params.id,
      windowDays: days,
      funnel: getProductFunnel(businessId, params.id, days),
    },
  })
})
