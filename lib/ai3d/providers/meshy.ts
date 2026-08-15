import 'server-only'

import type {
  AI3DProvider,
  GenerateInput,
  GenerationProgress,
  GenerationStage,
} from '@/lib/ai3d/provider'

/**
 * Meshy image-to-3D adapter.
 *
 * ── STATUS: WRITTEN AGAINST THE PUBLISHED API, NOT EXECUTED ─────────────────
 *
 * This adapter has never been run against the live service, because doing so
 * needs a paid API key. The request and response shapes follow Meshy's
 * documented v1 image-to-3D endpoints; if they have moved on, the two response
 * mappings below are the only places that need changing, and every error is
 * surfaced with the provider's own message rather than swallowed.
 *
 * Treat the first real run as the integration test. `MODEL_GEN_DEBUG=1` logs the
 * raw responses so a shape mismatch is obvious immediately.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Meshy is asynchronous: POST a task, then poll it. That maps directly onto the
 * AI3DProvider contract, which was designed around exactly this shape.
 */

const API_BASE = process.env.MODEL_GEN_API_URL ?? 'https://api.meshy.ai/openapi/v1'

/** Meshy's task states → ours. */
function mapStatus(status: string): {
  status: GenerationProgress['status']
  stage: GenerationStage
} {
  switch (status) {
    case 'PENDING':
      return { status: 'queued', stage: 'uploading' }
    case 'IN_PROGRESS':
      return { status: 'running', stage: 'geometry' }
    case 'SUCCEEDED':
      return { status: 'succeeded', stage: 'complete' }
    case 'FAILED':
    case 'EXPIRED':
      return { status: 'failed', stage: 'geometry' }
    case 'CANCELED':
      return { status: 'cancelled', stage: 'geometry' }
    default:
      return { status: 'running', stage: 'analyzing' }
  }
}

/**
 * Meshy reports one overall percentage. Mapping it onto our named stages keeps
 * the progress UI meaningful rather than showing "geometry" for four minutes.
 */
function stageFromProgress(progress: number): GenerationStage {
  if (progress < 10) return 'analyzing'
  if (progress < 55) return 'geometry'
  if (progress < 80) return 'materials'
  if (progress < 95) return 'optimizing'
  return 'packaging'
}

const debug = (label: string, payload: unknown) => {
  if (process.env.MODEL_GEN_DEBUG === '1') {
    console.info(`[meshy] ${label}`, JSON.stringify(payload).slice(0, 1200))
  }
}

export class MeshyProvider implements AI3DProvider {
  readonly id = 'meshy'
  readonly displayName = 'Meshy'

  constructor(private readonly apiKey: string | undefined) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0)
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  async start(input: GenerateInput): Promise<{ providerJobId: string }> {
    if (!this.isConfigured()) {
      throw new Error('MODEL_GEN_API_KEY is not set.')
    }
    if (input.imageUrls.length === 0) {
      throw new Error('At least one source image is required.')
    }

    // The image must be reachable BY MESHY, not just by us. A localhost URL
    // will fail on their side with an unhelpful error, so it is caught here
    // where the message can actually explain the problem.
    const unreachable = input.imageUrls.find(
      (u) => u.startsWith('/') || /localhost|127\.0\.0\.1|::1/.test(u),
    )
    if (unreachable) {
      throw new Error(
        `The generation service must be able to download your images, and “${unreachable}” is not publicly reachable. ` +
          'Deploy first, or set NEXT_PUBLIC_APP_URL to a public URL (a tunnel works).',
      )
    }

    const body = {
      image_url: input.imageUrls[0],
      // Extra angles materially improve reconstruction where the API accepts them.
      ...(input.imageUrls.length > 1 ? { multi_image_urls: input.imageUrls } : {}),
      should_remesh: true,
      should_texture: true,
      enable_pbr: true,
      // GLB is what model-viewer, Scene Viewer and our own loader all consume.
      ai_model: 'meshy-4',
    }
    debug('start request', body)

    const res = await fetch(`${API_BASE}/image-to-3d`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })

    const json: unknown = await res.json().catch(() => null)
    debug('start response', json)

    if (!res.ok) {
      const message =
        (json as { message?: string })?.message ??
        `Meshy rejected the request (HTTP ${res.status}).`
      throw new Error(message)
    }

    // Documented as { result: "<task-id>" }; some responses nest it under data.
    const id =
      (json as { result?: string })?.result ??
      (json as { data?: { id?: string } })?.data?.id ??
      (json as { id?: string })?.id

    if (!id) {
      throw new Error('Meshy accepted the request but returned no task id.')
    }
    return { providerJobId: id }
  }

  async getStatus(providerJobId: string): Promise<GenerationProgress> {
    if (!this.isConfigured()) {
      return {
        status: 'failed',
        stage: 'uploading',
        progress: null,
        errorCode: 'not_configured',
        errorMessage: 'MODEL_GEN_API_KEY is not set.',
      }
    }

    const res = await fetch(`${API_BASE}/image-to-3d/${providerJobId}`, {
      headers: this.headers(),
      cache: 'no-store',
    })

    const json: unknown = await res.json().catch(() => null)
    debug('status response', json)

    if (!res.ok) {
      return {
        status: 'failed',
        stage: 'geometry',
        progress: null,
        errorCode: `http_${res.status}`,
        errorMessage:
          (json as { message?: string })?.message ??
          `Could not read the generation status (HTTP ${res.status}).`,
      }
    }

    const task = ((json as { result?: unknown })?.result ?? json) as {
      status?: string
      progress?: number
      task_error?: { message?: string }
      model_urls?: { glb?: string; usdz?: string }
      thumbnail_url?: string
    }

    const progress = typeof task.progress === 'number' ? task.progress : null
    const mapped = mapStatus(task.status ?? '')

    if (mapped.status === 'failed') {
      return {
        status: 'failed',
        stage: mapped.stage,
        progress,
        errorCode: 'provider_failed',
        errorMessage:
          task.task_error?.message ??
          'Generation failed. Try a clearer photo of the product on a plain background.',
      }
    }

    if (mapped.status === 'succeeded') {
      const glbUrl = task.model_urls?.glb
      if (!glbUrl) {
        return {
          status: 'failed',
          stage: 'packaging',
          progress,
          errorCode: 'no_asset',
          errorMessage: 'Generation completed but returned no GLB file.',
        }
      }
      return {
        status: 'succeeded',
        stage: 'complete',
        progress: 100,
        result: {
          glbUrl,
          usdzUrl: task.model_urls?.usdz ?? null,
          posterUrl: task.thumbnail_url ?? null,
        },
      }
    }

    return {
      status: mapped.status,
      stage: progress === null ? mapped.stage : stageFromProgress(progress),
      progress,
    }
  }

  async cancel(providerJobId: string): Promise<void> {
    if (!this.isConfigured()) return
    // Best effort: a provider that does not support cancellation should not
    // turn "stop this" into an error the user has to dismiss.
    await fetch(`${API_BASE}/image-to-3d/${providerJobId}`, {
      method: 'DELETE',
      headers: this.headers(),
    }).catch(() => {})
  }
}
