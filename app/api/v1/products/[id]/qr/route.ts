import { withApiKey, apiOk, apiError, readJson } from '@/lib/api/handler'
import { getProduct } from '@/lib/db/repositories/catalog'
import { listQrCodes, createQrCode, qrTargetUrl } from '@/lib/db/repositories/qr'
import { getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { canCreateQrCode } from '@/lib/billing/entitlements'

/**
 * GET  /api/v1/products/:id/qr — the product's codes
 * POST /api/v1/products/:id/qr — mint one
 *
 * The returned `url` is the redirect layer (/r/<token>), never a direct link
 * to the product page. That indirection is the entire commercial value: a
 * printed sticker keeps working after the destination changes.
 */

type Params = { id: string }

function origin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
}

export const GET = withApiKey<Params>('qr:read', async ({ businessId, params }) => {
  const product = getProduct(businessId, params.id)
  if (!product) return apiError('not_found', 'No product with that id.')

  const codes = listQrCodes(businessId)
    .filter((code) => code.productId === params.id)
    .map((code) => ({
      id: code.id,
      label: code.label,
      destination: code.destination,
      isActive: code.isActive,
      scanCount: code.scanCount,
      lastScanAt: code.lastScanAt,
      url: qrTargetUrl(code.token, origin()),
    }))

  return apiOk({ data: codes })
})

export const POST = withApiKey<Params>('qr:write', async ({ businessId, params, request }) => {
  const product = getProduct(businessId, params.id)
  if (!product) return apiError('not_found', 'No product with that id.')

  const allowed = canCreateQrCode(getEntitlements(businessId), getUsage(businessId))
  if (!allowed.allowed) {
    return apiError('plan_required', allowed.message, {
      limit: allowed.limit,
      current: allowed.current,
    })
  }

  const parsed = await readJson(request)
  const body = parsed.ok ? parsed.body : {}

  const { id, token } = createQrCode({
    businessId,
    productId: params.id,
    label: typeof body.label === 'string' ? body.label : product.name,
    destination: body.destination === 'product' ? 'product' : 'ar',
  })

  return apiOk({ data: { id, url: qrTargetUrl(token, origin()) } }, { status: 201 })
})
