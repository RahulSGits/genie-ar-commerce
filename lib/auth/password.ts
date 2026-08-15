import 'server-only'

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * scrypt is memory-hard, which is what makes GPU cracking expensive — the
 * property bcrypt lacks and the reason plain SHA-256 is unusable here. Node
 * ships it, so there is no dependency and no native build.
 *
 * Parameters follow the OWASP recommendation for scrypt (N=2^16, r=8, p=1),
 * costing roughly 100 ms and 64 MB per hash on typical hardware — slow enough
 * to make offline cracking impractical, fast enough for interactive login.
 */
const N = 2 ** 16
const R = 8
const P = 1
const KEYLEN = 64
const SALT_BYTES = 16
// scrypt needs ~128 * N * r bytes; Node's default maxmem (32 MB) is below that
// and would throw, so it is raised explicitly rather than weakening N.
const MAXMEM = 256 * 1024 * 1024

/** Encoded as `scrypt$N$r$p$salt_b64$hash_b64` so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$')
}

/**
 * Constant-time verification. Returns false on any malformed input rather than
 * throwing, so a corrupt row cannot become a 500 on the login path.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false

    const n = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    const salt = Buffer.from(parts[4] ?? '', 'base64')
    const expected = Buffer.from(parts[5] ?? '', 'base64')

    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false
    if (salt.length === 0 || expected.length === 0) return false

    const derived = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    })

    // Lengths are equal by construction above, but timingSafeEqual throws if
    // they ever differ, so guard rather than let it escape.
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/**
 * Minimum viable password policy. Deliberately length-first: length dominates
 * entropy, and character-class rules mostly produce `Password1!`.
 */
export function validatePasswordStrength(password: string): { ok: true } | { ok: false; error: string } {
  if (password.length < 10) {
    return { ok: false, error: 'Password must be at least 10 characters.' }
  }
  if (password.length > 200) {
    return { ok: false, error: 'Password must be under 200 characters.' }
  }
  const common = ['password', '12345678', 'qwerty', 'letmein', 'admin123', 'welcome1']
  if (common.some((c) => password.toLowerCase().includes(c))) {
    return { ok: false, error: 'That password is too easy to guess. Pick something less common.' }
  }
  return { ok: true }
}
