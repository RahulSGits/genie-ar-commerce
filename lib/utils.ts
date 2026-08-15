import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merges Tailwind classes, with later conflicting utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * URL-safe slug. Used for business and product slugs, which appear in public
 * AR URLs — so it must be stable, lowercase and free of anything that would
 * need percent-encoding.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Unguessable public token for QR targets.
 *
 * QR codes get printed and stuck on tables — the token in the URL must not be
 * a database id (enumerable) and must be revocable without reprinting. 16 bytes
 * of CSPRNG output in base32hex-ish alphabet gives ~2^80 of entropy in 26 URL-safe
 * characters, which is far beyond guessing at any realistic scan volume.
 */
export function generatePublicToken(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)

  // Crockford-style base32: no I, L, O or U, so tokens survive being read aloud
  // or re-typed from a printed card.
  const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
  let out = ''
  for (const byte of bytes) {
    out += ALPHABET[byte % 32]
  }
  return out
}

export function formatDate(value: string | Date, timeZone = 'Asia/Kolkata'): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date)
}

export function formatDateTime(value: string | Date, timeZone = 'Asia/Kolkata'): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date)
}

/** Whole days from now until `date`. Negative when the date has passed. */
export function daysUntil(date: string | Date): number {
  const target = typeof date === 'string' ? new Date(date) : date
  const MS_PER_DAY = 86_400_000
  const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startOfDay(target) - startOfDay(new Date())) / MS_PER_DAY)
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Percentage, guarding the divide-by-zero that turns an empty dashboard into NaN%. */
export function percentage(part: number, total: number, decimals = 1): number {
  if (total === 0) return 0
  return Number(((part / total) * 100).toFixed(decimals))
}
