import 'server-only'

import type {
  AI3DProvider,
  GenerateInput,
  GenerationProgress,
  GenerationStage,
} from '@/lib/ai3d/provider'

/**
 * Development provider — exercises the whole generation pipeline without an
 * external service or an API key.
 *
 * ── WHAT THIS IS AND IS NOT ─────────────────────────────────────────────────
 *
 * It does NOT generate anything from your images. It walks the real job state
 * machine on a timer and then attaches one of the demo GLBs.
 *
 * That is not the "fake AI" the architecture forbids, because it never claims
 * otherwise: every result carries `isPlaceholder: true`, the model is stored
 * with "(development placeholder)" in its name, and the product workspace
 * renders a warning banner. A user can always tell, from the UI and from the
 * database, that no reconstruction happened.
 *
 * It exists so the surrounding machinery — upload, job records, polling,
 * progress UI, model attachment, AR, QR — can be built and tested end to end
 * before anyone spends money on a provider. Set MODEL_GEN_PROVIDER=development
 * to use it; it is never the default.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Roughly how long the simulated pipeline takes, in ms. */
const TOTAL_MS = 18_000

const STAGE_SCHEDULE: Array<{ stage: GenerationStage; untilMs: number }> = [
  { stage: 'analyzing', untilMs: 3_000 },
  { stage: 'geometry', untilMs: 8_000 },
  { stage: 'materials', untilMs: 12_000 },
  { stage: 'optimizing', untilMs: 15_500 },
  { stage: 'packaging', untilMs: TOTAL_MS },
]

/**
 * Demo assets to hand back. Picked by keyword so a product called "burger"
 * gets the burger — which makes the pipeline legible while testing, rather
 * than always returning the same object.
 */
const DEMO_MODELS: Array<{ match: RegExp; url: string; triangles: number; bytes: number }> = [
  { match: /burger|sandwich|bun/i, url: '/models/signature-burger.glb', triangles: 9800, bytes: 133_000 },
  { match: /pizza|flatbread/i, url: '/models/margherita-pizza.glb', triangles: 11_200, bytes: 146_000 },
  { match: /coffee|drink|juice|tea|glass/i, url: '/models/cold-coffee.glb', triangles: 3_100, bytes: 35_000 },
  { match: /shoe|sneaker|trainer|boot/i, url: '/models/classic-sneaker.glb', triangles: 2_600, bytes: 36_000 },
  { match: /chair|sofa|seat|table|desk/i, url: '/models/lounge-chair.glb', triangles: 1_900, bytes: 29_000 },
]

const FALLBACK = DEMO_MODELS[0]!

/**
 * In-process job store. Deliberately not persisted: this provider stands in for
 * a remote service, and a remote service's internal state is not ours to keep.
 * The durable record is `generation_jobs` in our own database.
 */
const jobs = new Map<string, { startedAt: number; input: GenerateInput }>()

export class DevelopmentProvider implements AI3DProvider {
  readonly id = 'development'
  readonly displayName = 'Development placeholder (not real generation)'

  isConfigured(): boolean {
    return true
  }

  async start(input: GenerateInput): Promise<{ providerJobId: string }> {
    if (input.imageUrls.length === 0) {
      // Even the placeholder enforces the contract: a generator with no input
      // is a bug in the caller, and swallowing it here would hide it until a
      // real provider was connected.
      throw new Error('At least one source image is required.')
    }

    const providerJobId = `dev_${crypto.randomUUID()}`
    jobs.set(providerJobId, { startedAt: Date.now(), input })
    return { providerJobId }
  }

  async getStatus(providerJobId: string): Promise<GenerationProgress> {
    const job = jobs.get(providerJobId)
    if (!job) {
      return {
        status: 'failed',
        stage: 'uploading',
        progress: null,
        errorCode: 'unknown_job',
        errorMessage:
          'This development job is no longer in memory — the server restarted. Start a new one.',
      }
    }

    const elapsed = Date.now() - job.startedAt
    const percent = Math.min(100, Math.round((elapsed / TOTAL_MS) * 100))

    if (elapsed < TOTAL_MS) {
      const stage =
        STAGE_SCHEDULE.find((s) => elapsed < s.untilMs)?.stage ?? 'packaging'
      return { status: 'running', stage, progress: percent }
    }

    const pick =
      DEMO_MODELS.find((m) => m.match.test(job.input.productName)) ?? FALLBACK

    return {
      status: 'succeeded',
      stage: 'complete',
      progress: 100,
      result: {
        glbUrl: pick.url,
        fileSizeBytes: pick.bytes,
        triangleCount: pick.triangles,
        // The flag that keeps this honest all the way through to the UI.
        isPlaceholder: true,
      },
    }
  }

  async cancel(providerJobId: string): Promise<void> {
    jobs.delete(providerJobId)
  }
}
