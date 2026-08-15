import 'server-only'

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Database connection.
 *
 * SQLite via `node:sqlite`, which ships inside Node 24 — no Docker, no native
 * compile, no external service, no credentials. `npm run dev` and the whole
 * platform works.
 *
 * All SQL lives in lib/db/repositories. Application code never touches this
 * module directly, so moving to Postgres/Supabase for production is a change
 * to the repository layer alone. See docs/database.md.
 */

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'arview.db')

let instance: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (instance) return instance

  mkdirSync(path.dirname(DB_PATH), { recursive: true })

  const db = new DatabaseSync(DB_PATH)

  // WAL lets reads proceed during writes — without it, Next's concurrent
  // server renders serialise behind any in-flight write.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')

  migrate(db)

  instance = db
  return db
}

function migrate(db: DatabaseSync): void {
  const schemaPath = path.join(process.cwd(), 'lib', 'db', 'schema.sql')
  const schema = readFileSync(schemaPath, 'utf8')
  // Every statement is CREATE ... IF NOT EXISTS, so this is safe to run on
  // every boot and acts as the migration for a fresh database.
  db.exec(schema)
}

/* ── helpers ────────────────────────────────────────────────────────────── */

export function uuid(): string {
  return randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}

/** YYYY-MM-DD in UTC, matching the denormalised `day` column on events. */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}

export function fromBool(value: boolean | undefined | null): number {
  return value ? 1 : 0
}

/** Parses a JSON text column, returning `fallback` rather than throwing. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 *
 * Used wherever more than one row must move together — recording a payment and
 * updating its invoice's paid total, or converting a CRM lead into a business
 * with a subscription and an opening invoice.
 */
export function transaction<T>(fn: () => T): T {
  const db = getDb()
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Row type coming out of node:sqlite — values are unknown until narrowed. */
export type Row = Record<string, unknown>

/**
 * What node:sqlite will accept as a bound parameter. Building query params as
 * this type rather than `unknown[]` means a stray object or boolean is a
 * compile error instead of a runtime throw deep inside a statement.
 */
export type SqlParam = null | number | bigint | string | Uint8Array

/** Narrows an arbitrary value to something bindable. */
export function param(value: unknown): SqlParam {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Uint8Array) return value
  // Objects and arrays must be serialised explicitly by the caller via toJson,
  // so reaching here is a programming error worth surfacing loudly.
  return String(value)
}

export function str(row: Row, key: string): string {
  const v = row[key]
  return typeof v === 'string' ? v : ''
}

export function strOrNull(row: Row, key: string): string | null {
  const v = row[key]
  return typeof v === 'string' && v !== '' ? v : null
}

export function num(row: Row, key: string, fallback = 0): number {
  const v = row[key]
  return typeof v === 'number' ? v : fallback
}

export function numOrNull(row: Row, key: string): number | null {
  const v = row[key]
  return typeof v === 'number' ? v : null
}
