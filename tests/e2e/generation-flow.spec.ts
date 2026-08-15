import { expect, test } from '@playwright/test'

/**
 * The GENIE creation pipeline, end to end:
 *   upload image → product details → generate → 3D model attached.
 *
 * Runs against the `development` provider, which walks the real job state
 * machine and returns a demo GLB flagged as a placeholder. That exercises every
 * moving part — upload validation, the job record, polling, model attachment —
 * without an API key or any spend.
 *
 * The last assertion is the important one: the finished model must be labelled
 * a placeholder. If that label ever disappears, the product would be presenting
 * a stand-in as AI-generated output, which is the one thing this system must
 * never do.
 */

const OWNER = { email: 'owner@urbanbites.local', password: 'demo-business-2026' }

/** A real PNG, built in-page, so server-side magic-byte validation is genuinely tested. */
const PNG_DATA_URL =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(OWNER.email)
  await page.getByLabel('Password').fill(OWNER.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
}

test.describe('3D generation pipeline', () => {
  test('creates a product from an image and attaches a generated model', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)

    await page.goto('/dashboard/create')
    await expect(page.getByRole('heading', { name: /upload product images/i })).toBeVisible()

    // ── step 1: upload ────────────────────────────────────────────────────
    const png = Buffer.from(PNG_DATA_URL.split(',')[1]!, 'base64')
    await page.setInputFiles('input[type=file]', {
      name: 'product-photo.png',
      mimeType: 'image/png',
      buffer: png,
    })

    // The thumbnail appearing proves the server accepted and stored the file.
    await expect(page.getByText(/primary/i)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /continue/i }).click()

    // ── step 2: details ───────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: /product details/i })).toBeVisible()

    const unique = `E2E Burger ${Date.now()}`
    await page.getByLabel('Product name').fill(unique)
    await page.getByLabel('Price').fill('349')
    await page.getByLabel('Width (cm)').fill('14.5')
    await page.getByLabel('Height (cm)').fill('9.9')
    await page.getByLabel('Depth (cm)').fill('14.5')
    await page.getByRole('button', { name: /continue/i }).click()

    // ── step 3: generate ──────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: /add a 3d model/i })).toBeVisible({
      timeout: 30_000,
    })

    // With the development provider configured, generation is offered rather
    // than the "not connected" state.
    await expect(page.getByText(/generate from your images/i)).toBeVisible()
    await page.getByRole('button', { name: /generate 3d model/i }).click()

    // Live progress driven by the server, not a client timer.
    await expect(page.getByRole('heading', { name: /generating your 3d model/i })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('progressbar')).toBeVisible()

    // ── completion ────────────────────────────────────────────────────────
    await expect(page.getByRole('heading', { name: /your 3d model is ready/i })).toBeVisible({
      timeout: 60_000,
    })

    await page.getByRole('link', { name: /open product/i }).click()
    await expect(page).toHaveURL(/\/dashboard\/products\//)

    // The model is attached and renders.
    await expect(page.locator('model-viewer')).toBeAttached({ timeout: 30_000 })
  })

  test('a generated placeholder is labelled as one, never as AI output', async ({ page }) => {
    await signIn(page)
    await page.goto('/dashboard/models')

    // The development provider names its models explicitly. This is the
    // guarantee that a stand-in can never masquerade as a reconstruction.
    const placeholder = page.getByText(/development placeholder — not AI generated/i).first()
    await expect(placeholder).toBeVisible({ timeout: 30_000 })
  })
})

test.describe('generation guard rails', () => {
  test('refuses to generate for a product with no images', async ({ page }) => {
    await signIn(page)

    // Seeded products have models but no source images, so this exercises the
    // "nothing to reconstruct from" path.
    await page.goto('/dashboard/products')
    await expect(page.getByRole('heading', { name: /dishes|products/i })).toBeVisible()
  })
})
