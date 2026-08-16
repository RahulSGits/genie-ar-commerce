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
  addColumns(db)
}

/**
 * Columns added to tables that already exist in a deployed database.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op once the table is there, so a new
 * column in schema.sql would never reach an existing install — the app would
 * typecheck, deploy, and then fail at runtime on the first SELECT. SQLite has
 * no `ADD COLUMN IF NOT EXISTS`, so the existing columns are read first and
 * only genuinely missing ones are added.
 *
 * Additive only, and every entry must be nullable or carry a DEFAULT: this
 * runs against databases with rows already in them.
 */
const ADDED_COLUMNS: Record<string, Record<string, string>> = {
  businesses: {
    // Enterprise publishing control (§50): when on, an editor's changes wait
    // for an admin rather than going straight to the public page.
    requires_approval: `INTEGER NOT NULL DEFAULT 0`,
    // Product-led growth badge on public pages. On by default; removable on
    // plans whose `white_label` feature is enabled.
    show_genie_badge: `INTEGER NOT NULL DEFAULT 1`,
    industry_template: `TEXT`,
    // Which CTA counts as a conversion for this business (§30).
    conversion_goal: `TEXT`,
  },
  products: {
    brand: `TEXT`,
    // Scheduled publishing (§51). Evaluated on read, not by a cron — see
    // isPubliclyVisible().
    publish_at: `TEXT`,
    unpublish_at: `TEXT`,
    // none | pending | approved | rejected. 'none' when the business does not
    // require approval, so the common case needs no extra state.
    approval_status: `TEXT NOT NULL DEFAULT 'none'`,
    approved_by: `TEXT`,
    approved_at: `TEXT`,
    // json: the ordered block list for the public page builder (§22).
    page_config: `TEXT`,
    // json: colour/size/material variants (§25).
    variants: `TEXT`,
  },
  three_d_models: {
    // Version chain (§49). Replacing a model keeps the old row so a published
    // experience is never destroyed by an upload.
    version: `INTEGER NOT NULL DEFAULT 1`,
    replaces_id: `TEXT`,
    // Measured, not declared — see lib/quality/score.ts.
    texture_bytes: `INTEGER`,
    material_count: `INTEGER`,
    node_count: `INTEGER`,
    mesh_count: `INTEGER`,
    bbox: `TEXT`, // json {x,y,z} in metres
    quality: `TEXT`, // json QualityReport
  },
  generation_jobs: {
    // What this job cost GENIE, mirrored into cost_events.
    cost_minor: `INTEGER NOT NULL DEFAULT 0`,
    retry_of: `TEXT`,
  },
  qr_codes: {
    campaign_id: `TEXT`,
    // Appearance is stored so a regenerated PNG matches the printed original.
    style: `TEXT`, // json {fg,bg,logo,label,shape}
  },
}

function addColumns(db: DatabaseSync): void {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => str(r, 'name')),
    )
    for (const [column, definition] of Object.entries(columns)) {
      if (existing.has(column)) continue
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
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
let txDepth = 0

export function transaction<T>(fn: () => T): T {
  const db = getDb()

  // Re-entrant by savepoint. SQLite rejects a nested BEGIN outright
  // ("cannot start a transaction within a transaction"), so composing two
  // transactional repository calls — raising an invoice inside a lead
  // conversion, say — would throw at runtime rather than nest.
  //
  // Depth 0 opens a real transaction; deeper calls open a named savepoint and
  // roll back only their own work, leaving the outer transaction intact to
  // succeed or fail on its own terms.
  const depth = txDepth++
  const name = `sp_${depth}`

  db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`)
  try {
    const result = fn()
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`)
    return result
  } catch (err) {
    // ROLLBACK TO leaves the savepoint open, so it is released immediately
    // afterwards — otherwise the savepoint stack leaks and the outer COMMIT
    // silently keeps work that was meant to be discarded.
    if (depth === 0) {
      db.exec('ROLLBACK')
    } else {
      db.exec(`ROLLBACK TO ${name}`)
      db.exec(`RELEASE ${name}`)
    }
    throw err
  } finally {
    txDepth = depth
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
