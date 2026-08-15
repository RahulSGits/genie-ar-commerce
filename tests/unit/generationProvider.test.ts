import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DevelopmentProvider } from '@/lib/ai3d/providers/development'
import { MeshyProvider } from '@/lib/ai3d/providers/meshy'
import { GENERATION_STAGES } from '@/lib/ai3d/provider'

describe('DevelopmentProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('refuses to start with no images, exactly as a real provider would', async () => {
    // The placeholder still enforces the contract — otherwise a caller bug
    // stays hidden until a paid provider is connected and starts failing.
    const p = new DevelopmentProvider()
    await expect(p.start({ imageUrls: [], productName: 'Burger' })).rejects.toThrow(
      /at least one source image/i,
    )
  })

  it('walks the real stage sequence in order, never backwards', async () => {
    const p = new DevelopmentProvider()
    const { providerJobId } = await p.start({
      imageUrls: ['https://example.com/a.jpg'],
      productName: 'Signature Burger',
    })

    const seen: string[] = []
    // Deltas, not absolute offsets — the clock has already moved by the time
    // the previous poll returned.
    for (const delta of [0, 2_000, 3_000, 5_000, 3_500, 2_000]) {
      vi.advanceTimersByTime(delta)
      const status = await p.getStatus(providerJobId)
      seen.push(status.stage)
      expect(status.status).toBe('running')
    }

    // Every reported stage is a real one, and the sequence never regresses.
    const order = GENERATION_STAGES.map((s) => String(s))
    const indices = seen.map((s) => order.indexOf(s))
    expect(indices.every((i) => i >= 0)).toBe(true)
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThanOrEqual(indices[i - 1]!)
    }
  })

  it('reports monotonically non-decreasing progress', async () => {
    const p = new DevelopmentProvider()
    const { providerJobId } = await p.start({
      imageUrls: ['https://example.com/a.jpg'],
      productName: 'Cold Coffee',
    })

    let last = -1
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(2_500)
      const { progress } = await p.getStatus(providerJobId)
      expect(progress).not.toBeNull()
      expect(progress!).toBeGreaterThanOrEqual(last)
      expect(progress!).toBeLessThanOrEqual(100)
      last = progress!
    }
  })

  it('completes with a real GLB, flagged as a placeholder', async () => {
    const p = new DevelopmentProvider()
    const { providerJobId } = await p.start({
      imageUrls: ['https://example.com/a.jpg'],
      productName: 'Signature Burger',
    })

    vi.advanceTimersByTime(25_000)
    const done = await p.getStatus(providerJobId)

    expect(done.status).toBe('succeeded')
    expect(done.stage).toBe('complete')
    expect(done.progress).toBe(100)
    expect(done.result?.glbUrl).toBe('/models/signature-burger.glb')

    // The flag that stops a placeholder ever being presented as generated output.
    expect(done.result?.isPlaceholder).toBe(true)
  })

  it('picks an asset matching the product so the pipeline is legible', async () => {
    const p = new DevelopmentProvider()
    const cases: Array<[string, string]> = [
      ['Margherita Pizza', '/models/margherita-pizza.glb'],
      ['Iced Coffee', '/models/cold-coffee.glb'],
      ['Running Sneaker', '/models/classic-sneaker.glb'],
      ['Oak Dining Table', '/models/lounge-chair.glb'],
    ]
    for (const [name, expected] of cases) {
      const { providerJobId } = await p.start({
        imageUrls: ['https://example.com/a.jpg'],
        productName: name,
      })
      vi.advanceTimersByTime(25_000)
      const done = await p.getStatus(providerJobId)
      expect(done.result?.glbUrl).toBe(expected)
    }
  })

  it('reports a clear error for a job lost to a restart', async () => {
    const p = new DevelopmentProvider()
    const status = await p.getStatus('dev_does-not-exist')
    expect(status.status).toBe('failed')
    expect(status.errorMessage).toMatch(/restarted/i)
  })
})

describe('MeshyProvider', () => {
  it('reports itself unconfigured without a key, so the UI never offers it', () => {
    expect(new MeshyProvider(undefined).isConfigured()).toBe(false)
    expect(new MeshyProvider('').isConfigured()).toBe(false)
    expect(new MeshyProvider('msy_abc123').isConfigured()).toBe(true)
  })

  it('refuses a key-less start rather than making a doomed request', async () => {
    await expect(
      new MeshyProvider(undefined).start({ imageUrls: ['https://x/a.jpg'], productName: 'X' }),
    ).rejects.toThrow(/MODEL_GEN_API_KEY/)
  })

  it('rejects images the provider could not possibly download', async () => {
    // The most common first-run failure: generation works locally in the UI but
    // the remote service cannot reach a localhost URL. Caught here, where the
    // message can explain it, rather than as an opaque provider error.
    const p = new MeshyProvider('msy_test')
    await expect(
      p.start({ imageUrls: ['http://localhost:3000/uploads/a.jpg'], productName: 'X' }),
    ).rejects.toThrow(/publicly reachable/i)

    await expect(
      p.start({ imageUrls: ['/uploads/a.jpg'], productName: 'X' }),
    ).rejects.toThrow(/publicly reachable/i)
  })

  it('requires at least one image', async () => {
    await expect(
      new MeshyProvider('msy_test').start({ imageUrls: [], productName: 'X' }),
    ).rejects.toThrow(/at least one source image/i)
  })
})
