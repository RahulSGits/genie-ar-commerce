import 'server-only'

import { getProvider, generationAvailable, GenerationUnavailableError } from '@/lib/ai3d/provider'
import { createJob, updateJob, failJob, listProductImages } from '@/lib/db/repositories/generation'
import { getProduct } from '@/lib/db/repositories/catalog'
import { getFeatureFlags } from '@/lib/db/repositories/platform'
import { getEntitlements, getUsage } from '@/lib/db/repositories/businesses'
import { canCreateArModel } from '@/lib/billing/entitlements'
import { checkRateLimit } from '@/lib/api/rateLimit'
import { recordGenerationCost } from '@/lib/costs/ledger'
import { emitWebhook } from '@/lib/webhooks/dispatch'
import { horizontalRadiusM } from '@/types/ar'

/**
 * Starting a generation job, independent of who asked.
 *
 * The dashboard action and the public API both need identical behaviour here —
 * the same availability check, the same quota, the same rate limit, the same
 * cost accounting. Having each call site reimplement it is how the API ends up
 * as the cheap way around a plan limit.
 */

export class GenerationRefused extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unavailable'
      | 'not_found'
      | 'no_images'
      | 'quota'
      | 'rate_limited'
      | 'provider_error',
  ) {
    super(message)
  }
}

export async function startGeneration(
  businessId: string,
  productId: string,
): Promise<{ jobId: string; provider: string }> {
  const flags = getFeatureFlags()
  const availability = generationAvailable(flags.model_generation)
  if (!availability.available) {
    throw new GenerationRefused(
      availability.reason ?? 'AI generation is unavailable.',
      'unavailable',
    )
  }

  const product = getProduct(businessId, productId)
  if (!product) throw new GenerationRefused('That product no longer exists.', 'not_found')

  const images = listProductImages(businessId, productId)
  if (images.length === 0) {
    throw new GenerationRefused(
      'Add at least one product image before generating. Generation reconstructs geometry from photographs — it has nothing to work from otherwise.',
      'no_images',
    )
  }

  // Generation is the one action in the product that costs real money per call,
  // so it is capped on two independent axes: the plan's model allowance, and a
  // short-window rate limit that a runaway script cannot spend through even
  // while it is within quota.
  const entitlements = getEntitlements(businessId)
  const usage = getUsage(businessId)
  const allowed = canCreateArModel(entitlements, usage)
  if (!allowed.allowed) {
    throw new GenerationRefused(allowed.message, 'quota')
  }

  const limit = checkRateLimit('generation', businessId)
  if (!limit.allowed) {
    throw new GenerationRefused(
      `Too many generations started. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`,
      'rate_limited',
    )
  }

  // Providers fetch the images themselves, so they need ABSOLUTE URLs. Stored
  // paths are relative, and passing those through produced a request the
  // provider could not resolve.
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  const imageUrls = images.map((img) => (img.url.startsWith('http') ? img.url : `${origin}${img.url}`))

  // Real-world size is a genuine quality input: a provider told the object is
  // 12 cm across reconstructs differently from one guessing.
  const targetSizeM = horizontalRadiusM(
    product.dimWidth && product.dimDepth
      ? {
          width: product.dimWidth,
          height: product.dimHeight ?? product.dimWidth,
          depth: product.dimDepth,
          unit: product.dimUnit,
        }
      : null,
  )

  const provider = getProvider()
  const jobId = createJob({
    businessId,
    productId,
    provider: provider.id,
    imageIds: images.map((i) => i.id),
  })

  try {
    const { providerJobId } = await provider.start({
      imageUrls,
      productName: product.name,
      category: product.placement,
      targetSizeM: targetSizeM === null ? null : targetSizeM * 2,
    })

    updateJob(businessId, jobId, {
      providerJobId,
      status: 'running',
      stage: 'analyzing',
      startedAt: new Date().toISOString(),
    })

    // Recorded at start, not at completion: a job that fails halfway has
    // usually already consumed the provider's compute, so accruing only on
    // success would understate what GENIE actually pays.
    recordGenerationCost(businessId, provider.id, jobId)
    emitWebhook(businessId, 'generation.started', { jobId, productId, provider: provider.id })

    return { jobId, provider: provider.id }
  } catch (err) {
    const message =
      err instanceof GenerationUnavailableError
        ? err.message
        : 'The generation provider rejected the request.'
    failJob(businessId, jobId, 'provider_error', message)
    emitWebhook(businessId, 'generation.failed', { jobId, productId, error: message })
    throw new GenerationRefused(message, 'provider_error')
  }
}
