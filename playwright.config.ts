import { defineConfig, devices } from '@playwright/test'

/**
 * E2E configuration.
 *
 * Runs against a PRODUCTION build on its own port and its own output
 * directory. Testing against `next dev` was flaky for reasons that had nothing
 * to do with the app: each route compiles on first request, so parallel workers
 * race the compiler and time out. A build costs ~40s up front and then behaves
 * like the thing users actually get.
 *
 * The isolated port and distDir also mean a running `npm run dev` is untouched.
 *
 * Mobile Safari is included deliberately: the customer-facing AR page is used
 * almost entirely on phones, so a desktop-only suite would miss the layout that
 * actually matters.
 */

const PORT = 3100
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? 'github' : 'list',

  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Full Chromium, not the default headless-shell: the shell cannot
        // register model-viewer's custom element, so the AR viewer never mounts
        // and every 3D assertion fails for reasons unrelated to the app.
        channel: 'chromium',
        launchOptions: {
          // No GPU in CI — fall back to SwiftShader rather than rendering nothing.
          args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],

  webServer: {
    command: `NEXT_DIST_DIR=.next-e2e next build && NEXT_DIST_DIR=.next-e2e next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
