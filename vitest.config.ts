import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Playwright specs live in tests/e2e and are run by `npm run test:e2e`.
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      // `server-only` is a build-time guard for Next's bundler; it throws when
      // resolved outside a server context. Stubbing it lets us unit-test the
      // pure logic inside server modules without loosening the guard itself.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
})
