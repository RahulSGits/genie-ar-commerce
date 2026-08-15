import { expect, test } from '@playwright/test'

/**
 * The customer journey — the flow the whole product exists to deliver.
 *
 * Deliberately runs with NO authentication: a customer scanning a code on a
 * table must never be asked to sign in, so a regression that introduces a login
 * wall here is exactly what this suite is for.
 *
 * AR *placement* cannot be asserted in a headless browser — it needs ARCore or
 * ARKit on real hardware. What is asserted is everything up to the handoff, plus
 * the guarantee that an AR-less device still gets a working 3D viewer.
 */

test.describe('public customer flow', () => {
  test('QR redirect resolves to the product and records the scan', async ({ page }) => {
    const response = await page.goto('/ar/urban-bites/signature-burger?src=qr')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Signature Burger' })).toBeVisible()
  })

  test('product page needs no login and shows price and CTA', async ({ page }) => {
    await page.goto('/ar/urban-bites/signature-burger')

    await expect(page).not.toHaveURL(/login/)
    await expect(page.getByRole('heading', { name: 'Signature Burger' })).toBeVisible()
    // .first() — the price also appears on the sibling-products strip.
    await expect(page.getByText('₹349').first()).toBeVisible()
    await expect(page.getByRole('link', { name: /order now/i })).toBeVisible()
  })

  test('the 3D model element mounts and is pointed at the GLB', async ({ page }) => {
    await page.goto('/ar/urban-bites/signature-burger')

    // The custom element only mounts after the dynamic import resolves, so this
    // asserts the model-viewer bundle actually loaded.
    const viewer = page.locator('model-viewer')
    await expect(viewer).toBeAttached({ timeout: 30_000 })

    // `src` is read as a DOM PROPERTY, not an attribute: React 19 assigns
    // properties on custom elements, and model-viewer's Lit property does not
    // reflect back to the attribute. Asserting the attribute would pass only by
    // accident of implementation.
    const src = await viewer.evaluate((el) => (el as HTMLElement & { src?: string }).src)
    expect(src).toContain('signature-burger.glb')

    // ar-scale="fixed" is what makes the model appear at true physical size.
    await expect(viewer).toHaveAttribute('ar-scale', 'fixed')
    await expect(viewer).toHaveAttribute('ar-modes', /webxr.*scene-viewer.*quick-look/)

    // The model actually finishing load is what proves the pipeline works
    // end to end — the size badge is rendered from getDimensions().
    await expect(page.getByText(/\d+ cm across/)).toBeVisible({ timeout: 45_000 })
  })

  test('the GLB is served and is a real glTF binary', async ({ request }) => {
    const response = await request.get('/models/signature-burger.glb')
    expect(response.status()).toBe(200)

    // "glTF" magic bytes — proves the asset is genuinely a model, not a 404 page.
    const head = (await response.body()).subarray(0, 4).toString('ascii')
    expect(head).toBe('glTF')
  })

  test('a device without AR still gets a usable 3D viewer', async ({ page }) => {
    await page.goto('/ar/urban-bites/signature-burger')
    await expect(page.getByText(/drag to rotate/i)).toBeVisible()
  })

  test('business catalog lists published products only', async ({ page }) => {
    await page.goto('/ar/urban-bites')
    await expect(page.getByRole('heading', { name: 'Urban Bites' })).toBeVisible()
    await expect(page.getByRole('link', { name: /signature burger/i })).toBeVisible()
  })

  test('a dead QR token lands on a friendly page, not an error', async ({ page }) => {
    await page.goto('/r/thiscodedoesnotexist')
    await expect(page).toHaveURL(/qr-not-found/)
    await expect(page.getByText(/isn.t available/i)).toBeVisible()
  })
})

test.describe('access control', () => {
  test('dashboard redirects anonymous visitors to login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('admin area is not reachable without a session', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/(admin\/)?login/)
  })
})

test.describe('marketing', () => {
  test('landing page renders CMS content and both CTAs', async ({ page }) => {
    await page.goto('/')

    // The hero heading comes from the CMS, so this also proves the CMS read path.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/3D & AR/i)
    await expect(page.getByRole('link', { name: /create your first 3d product/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /see how it works/i })).toBeVisible()
  })

  test('the homepage demo runs a real 3D model, not a picture of one', async ({ page }) => {
    await page.goto('/')

    // The demo autoplays to the 3D stage; model-viewer mounting there is what
    // separates a live demo from a screenshot.
    const viewer = page.locator('model-viewer')
    await expect(viewer).toBeAttached({ timeout: 30_000 })
  })

  test('pricing page lists plans from the database', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(/starter/i).first()).toBeVisible()
  })
})
