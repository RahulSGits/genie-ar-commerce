import { expect, test } from '@playwright/test'

/**
 * The operator journey: sign in, then reach every dashboard section.
 *
 * The navigation assertions exist to catch dead links — a sidebar entry that
 * 404s is worse than a missing feature, because it looks finished.
 */

const OWNER = { email: 'owner@urbanbites.local', password: 'demo-business-2026' }

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(OWNER.email)
  await page.getByLabel('Password').fill(OWNER.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  // Generous: scrypt verification is deliberately slow, and the dev server
  // compiles the dashboard route on first hit.
  await page.waitForURL(/\/dashboard/, { timeout: 90_000 })
}

test.describe('business dashboard', () => {
  test('signs in and shows live metrics', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('heading', { name: /overview/i })).toBeVisible()
    await expect(page.getByText(/QR scans/i)).toBeVisible()
  })

  test('every sidebar destination resolves', async ({ page }) => {
    await signIn(page)

    for (const path of [
      '/dashboard/products',
      '/dashboard/models',
      '/dashboard/qr',
      '/dashboard/analytics',
      '/dashboard/business',
      '/dashboard/billing',
      '/dashboard/settings',
      '/dashboard/support',
    ]) {
      const response = await page.goto(path)
      expect(response?.status(), `${path} should not 404`).toBeLessThan(400)
    }
  })

  test('rejects a wrong password without revealing whether the account exists', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(OWNER.email)
    await page.getByLabel('Password').fill('definitely-not-the-password')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Next injects its own role="alert" route announcer, so target the message
    // itself rather than the role.
    await expect(page.getByText(/email or password is incorrect/i)).toBeVisible()
    await expect(page).toHaveURL(/\/login/)

    // The same message must appear for an address that does not exist —
    // anything more specific turns this form into an account-enumeration oracle.
    await page.getByLabel('Email').fill('nobody@nowhere.invalid')
    await page.getByLabel('Password').fill('definitely-not-the-password')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText(/email or password is incorrect/i)).toBeVisible()
  })
})
