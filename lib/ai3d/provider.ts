import 'server-only'

/**
 * Image-to-3D generation: the provider seam.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * GENIE must never tell a user that AI generated a model when it did not.
 * Producing a plausible-looking result from a stock asset would be a lie the
 * user would only discover after showing it to their own customers.
 *
 * So: when no provider is configured, `getProvider()` returns `NullProvider`,
 * which fails immediately and says exactly why. There is no silent fallback,
 * no simulated progress, and no "demo mode" that looks like success.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Reconstructing geometry from photographs cannot be done in a browser, and
 * cannot be done well by anything small enough to bundle. It requires a
 * dedicated service. This interface is where one gets attached.
 *
 * TO CONNECT A REAL PROVIDER:
 *   1. Implement `AI3DProvider` (see the shape below) in
 *      `lib/ai3d/providers/<name>.ts`.
 *   2. Register it in `PROVIDERS` at the bottom of this file.
 *   3. Set `MODEL_GEN_PROVIDER=<name>` and its API key in `.env.local`.
 *   4. Turn on the `model_generation` feature flag in /admin/settings.
 *
 * Steps 3 and 4 are both required. The env var supplies credentials; the flag
 * is the operator's explicit acknowledgement that generation now costs money
 * per call.
 */

import { DevelopmentProvider } from '@/lib/ai3d/providers/development'
import { MeshyProvider } from '@/lib/ai3d/providers/meshy'

export type GenerationStage =
  | 'uploading'
  | 'analyzing'
  | 'geometry'
  | 'materials'
  | 'optimizing'
  | 'packaging'
  | 'complete'

/** Ordered, for rendering the progress stepper. */
export const GENERATION_STAGES: GenerationStage[] = [
  'uploading',
  'analyzing',
  'geometry',
  'materials',
  'optimizing',
  'packaging',
  'complete',
]

export const STAGE_LABELS: Record<GenerationStage, string> = {
  uploading: 'Uploading images',
  analyzing: 'Analysing product',
  geometry: 'Generating geometry',
  materials: 'Generating materials',
  optimizing: 'Optimising 3D asset',
  packaging: 'Preparing AR experience',
  complete: 'Complete',
}

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type GenerateInput = {
  /** Absolute URLs to the source images. More angles generally means better geometry. */
  imageUrls: string[]
  productName: string
  category?: string | null
  /** Real-world size in metres, when the business supplied dimensions. */
  targetSizeM?: number | null
  /** Free-text hint passed through to providers that accept one. */
  prompt?: string | null
}

export type GenerationProgress = {
  status: GenerationStatus
  stage: GenerationStage
  /** 0–100, or null when the provider reports no percentage. */
  progress: number | null
  errorCode?: string
  errorMessage?: string
  /** Set once status is 'succeeded'. */
  result?: GenerationResult
}

export type GenerationResult = {
  glbUrl: string
  usdzUrl?: string | null
  posterUrl?: string | null
  fileSizeBytes?: number
  triangleCount?: number
  /**
   * True when the asset is a stand-in rather than a reconstruction of the
   * submitted images. Set only by the development provider; carried through to
   * the model name and a banner in the product workspace so a placeholder can
   * never be mistaken for a generated model.
   */
  isPlaceholder?: boolean
}

/**
 * A provider is asynchronous by nature: reconstruction takes minutes, so
 * `start` returns a handle and the job is polled. Nothing here assumes the
 * browser stayed open.
 */
export interface AI3DProvider {
  readonly id: string
  readonly displayName: string
  /** False when credentials are missing — surfaced in the UI before any upload. */
  isConfigured(): boolean
  /** Queues a job. Returns the provider's own id for later polling. */
  start(input: GenerateInput): Promise<{ providerJobId: string }>
  getStatus(providerJobId: string): Promise<GenerationProgress>
  cancel(providerJobId: string): Promise<void>
}

/** Thrown when generation cannot proceed. Message is shown to the user verbatim. */
export class GenerationUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: string = 'provider_unavailable',
  ) {
    super(message)
    this.name = 'GenerationUnavailableError'
  }
}

/**
 * The default. Refuses every request and explains why.
 *
 * This is what makes the "no faking" rule structural rather than a promise:
 * with no provider configured there is no code path that can produce a
 * successful job.
 */
class NullProvider implements AI3DProvider {
  readonly id = 'none'
  readonly displayName = 'No provider configured'

  isConfigured(): boolean {
    return false
  }

  async start(): Promise<{ providerJobId: string }> {
    throw new GenerationUnavailableError(
      'AI 3D generation is not connected yet. Generating a model from photographs ' +
        'needs an external service — set MODEL_GEN_PROVIDER and its API key, then ' +
        'enable the “model_generation” feature flag. In the meantime you can upload ' +
        'a GLB you already have and everything else works exactly the same.',
      'not_configured',
    )
  }

  async getStatus(): Promise<GenerationProgress> {
    return {
      status: 'failed',
      stage: 'uploading',
      progress: null,
      errorCode: 'not_configured',
      errorMessage: 'No AI 3D provider is configured.',
    }
  }

  async cancel(): Promise<void> {
    /* nothing to cancel */
  }
}

/**
 * Provider registry.
 *
 * Add real implementations here. Each entry is a factory so credentials are
 * read at call time rather than at import time — that keeps a missing key from
 * crashing the whole server at boot.
 */
const PROVIDERS: Record<string, () => AI3DProvider> = {
  none: () => new NullProvider(),

  // Exercises the full pipeline with no external service and no key. Returns a
  // demo GLB flagged as a placeholder — never presented as generated output.
  development: () => new DevelopmentProvider(),

  // Real image-to-3D. Written against the published API but never executed
  // against it, since that needs a paid key — see the note in the adapter.
  meshy: () => new MeshyProvider(process.env.MODEL_GEN_API_KEY),
}

export function getProvider(): AI3DProvider {
  const id = process.env.MODEL_GEN_PROVIDER?.trim()
  if (!id) return new NullProvider()

  const factory = PROVIDERS[id]
  if (!factory) {
    console.warn(
      `[ai3d] MODEL_GEN_PROVIDER="${id}" is not registered in lib/ai3d/provider.ts. ` +
        'Falling back to the null provider.',
    )
    return new NullProvider()
  }
  return factory()
}

/** Names of every registered provider, for the admin settings UI. */
export function listProviderIds(): string[] {
  return Object.keys(PROVIDERS)
}

/**
 * Whether generation can be offered at all. Both conditions are required:
 * credentials AND the operator's explicit opt-in, because each generated model
 * costs money.
 */
export function generationAvailable(featureFlagEnabled: boolean): {
  available: boolean
  reason?: string
} {
  const provider = getProvider()

  if (!provider.isConfigured()) {
    return {
      available: false,
      reason:
        'No AI 3D provider is connected. Upload a GLB directly, or connect a provider in Settings.',
    }
  }
  if (!featureFlagEnabled) {
    return {
      available: false,
      reason:
        'AI generation is switched off. Enable the “model_generation” flag in admin settings to turn it on.',
    }
  }
  return { available: true }
}
