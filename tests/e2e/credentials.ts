import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Test credentials, read from the seed's output rather than hardcoded.
 *
 * No password literal lives in this repository — a committed one is a live
 * credential for anyone who clones and deploys. `npm run db:seed` generates a
 * fresh pair and writes them here (gitignored, 0600).
 */
type SeedCredentials = {
  admin: { email: string; password: string }
  business: { email: string; password: string }
}

function load(): SeedCredentials {
  // Environment wins, so CI can inject its own without touching the file.
  if (process.env.E2E_BUSINESS_EMAIL && process.env.E2E_BUSINESS_PASSWORD) {
    return {
      admin: {
        email: process.env.E2E_ADMIN_EMAIL ?? '',
        password: process.env.E2E_ADMIN_PASSWORD ?? '',
      },
      business: {
        email: process.env.E2E_BUSINESS_EMAIL,
        password: process.env.E2E_BUSINESS_PASSWORD,
      },
    }
  }

  const file = path.join(process.cwd(), '.seed-credentials.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SeedCredentials
  } catch {
    throw new Error(
      'No test credentials found. Run `npm run db:seed` first — it writes ' +
        '.seed-credentials.json — or set E2E_BUSINESS_EMAIL and E2E_BUSINESS_PASSWORD.',
    )
  }
}

export const CREDENTIALS = load()
