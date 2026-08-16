import { withApiKey, apiOk, apiError } from '@/lib/api/handler'
import { startGeneration, GenerationRefused } from '@/lib/ai3d/start'

/**
 * POST /api/v1/products/:id/generate
 *
 * Rate-limited on the `generation` bucket rather than the general `api` one:
 * this endpoint spends money on every successful call, so 120 requests/minute
 * would be an invitation to an expensive accident.
 */

type Params = { id: string }

const STATUS_FOR: Record<GenerationRefused['code'], 'invalid_request' | 'not_found' | 'plan_required' | 'rate_limited' | 'forbidden'> = {
  unavailable: 'forbidden',
  not_found: 'not_found',
  no_images: 'invalid_request',
  quota: 'plan_required',
  rate_limited: 'rate_limited',
  provider_error: 'invalid_request',
}

export const POST = withApiKey<Params>(
  'generation:run',
  async ({ businessId, params }) => {
    try {
      const { jobId, provider } = await startGeneration(businessId, params.id)
      return apiOk({ data: { jobId, provider, status: 'running' } }, { status: 202 })
    } catch (err) {
      if (err instanceof GenerationRefused) {
        return apiError(STATUS_FOR[err.code], err.message, { reason: err.code })
      }
      throw err
    }
  },
  { rateLimit: 'generation' },
)
