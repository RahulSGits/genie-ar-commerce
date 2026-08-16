import 'server-only'

import type { Row, SqlParam } from '@/lib/db'

/**
 * The database seam.
 *
 * One async interface with two implementations, so the repository layer is
 * written once and runs on either engine:
 *
 *   SQLite   — `node:sqlite`, zero setup, correct for local development and for
 *              a single long-lived server with a persistent disk.
 *   Postgres — Supabase or any Postgres, required for serverless hosting where
 *              the filesystem is ephemeral and not shared between instances.
 *
 * WHY THE INTERFACE IS ASYNC EVEN THOUGH SQLITE IS NOT: there is no synchronous
 * Postgres driver for Node, so the choice was to make Postgres async (which it
 * is) or to make SQLite async (which costs a resolved promise per call). Making
 * the shared interface async is the only option that keeps ONE repository
 * implementation. Two parallel repository layers would drift, and the one that
 * drifts is always the one that is not running in development.
 *
 * All SQL is written with `?` placeholders — the SQLite dialect — and the
 * Postgres adapter rewrites them. See `toPositional` for why that is safe here.
 */

export type QueryParams = readonly SqlParam[]

export interface Db {
  all(sql: string, params?: QueryParams): Promise<Row[]>
  get(sql: string, params?: QueryParams): Promise<Row | undefined>
  run(sql: string, params?: QueryParams): Promise<void>
  /**
   * Runs `fn` inside a transaction. Re-entrant: a nested call joins the
   * enclosing transaction via a savepoint rather than failing, because
   * repository functions compose (raising an invoice inside a lead conversion).
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  readonly engine: 'sqlite' | 'postgres'
}

/* ── value normalisation ────────────────────────────────────────────────── */

/**
 * Postgres returns richer JavaScript types than SQLite does, and the repository
 * mappers are written against SQLite's. Normalising on the way out is what lets
 * one mapper serve both engines.
 *
 *   timestamptz → Date        the mappers expect ISO strings, and `str()` on a
 *                             Date returns '' — a silent, total loss of every
 *                             timestamp in the application. This is the single
 *                             most dangerous difference between the engines.
 *   int8/bigint → string      the driver stringifies to avoid precision loss.
 *                             Money is in paise, so Number is exact to about
 *                             ₹90 trillion; the risk is theoretical and the
 *                             breakage from strings is not.
 *   boolean     → boolean     `toBool` already accepts it.
 *   jsonb       → object      `parseJson` accepts objects as well as strings.
 */
export function normaliseRow(row: Record<string, unknown>): Row {
  const out: Row = {}
  for (const [key, value] of Object.entries(row)) {
    out[key] = normaliseValue(value)
  }
  return out
}

function normaliseValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') {
    // Beyond this the value cannot survive as a JS number, and silently
    // truncating money is worse than failing loudly.
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(-Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Value ${value} exceeds safe integer range; refusing to lose precision.`)
    }
    return Number(value)
  }
  return value
}

/**
 * Rewrites `?` placeholders to `$1, $2, …`.
 *
 * Naively replacing every `?` would corrupt any that appear inside a string
 * literal — `WHERE label = '?'` would become `WHERE label = '$1'` and shift
 * every subsequent parameter by one, which is the kind of bug that only shows
 * up on the one query that has a literal in it. So the scan tracks quoting
 * state, and single-quote escaping (`''`) inside a literal.
 *
 * Exported for its unit test: this transformation has to be exactly right.
 */
export function toPositional(sql: string): string {
  let out = ''
  let index = 0
  let inSingle = false
  let inDouble = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i] as string
    const next = sql[i + 1]

    if (inLineComment) {
      out += char
      if (char === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      out += char
      if (char === '*' && next === '/') {
        out += next
        i++
        inBlockComment = false
      }
      continue
    }
    if (!inSingle && !inDouble && char === '-' && next === '-') {
      inLineComment = true
      out += char
      continue
    }
    if (!inSingle && !inDouble && char === '/' && next === '*') {
      inBlockComment = true
      out += char
      continue
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      out += char
      continue
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      out += char
      continue
    }

    if (char === '?' && !inSingle && !inDouble) {
      out += `$${++index}`
      continue
    }
    out += char
  }

  return out
}

/* ── SQLite ─────────────────────────────────────────────────────────────── */

class SqliteDb implements Db {
  readonly engine = 'sqlite' as const
  private depth = 0

  private db() {
    // Imported lazily so this module can be loaded in a Postgres deployment
    // without pulling in node:sqlite or touching the filesystem.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getDb } = require('@/lib/db') as typeof import('@/lib/db')
    return getDb()
  }

  async all(sql: string, params: QueryParams = []): Promise<Row[]> {
    return (this.db().prepare(sql).all(...params) as Row[]).map(normaliseRow)
  }

  async get(sql: string, params: QueryParams = []): Promise<Row | undefined> {
    const row = this.db().prepare(sql).get(...params) as Row | undefined
    return row ? normaliseRow(row) : undefined
  }

  async run(sql: string, params: QueryParams = []): Promise<void> {
    this.db().prepare(sql).run(...params)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.db()
    const depth = this.depth++
    const name = `sp_${depth}`

    db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`)
    try {
      const result = await fn()
      db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`)
      return result
    } catch (err) {
      if (depth === 0) {
        db.exec('ROLLBACK')
      } else {
        // ROLLBACK TO leaves the savepoint open; releasing it immediately keeps
        // the stack balanced, or the outer COMMIT silently keeps discarded work.
        db.exec(`ROLLBACK TO ${name}`)
        db.exec(`RELEASE ${name}`)
      }
      throw err
    } finally {
      this.depth = depth
    }
  }
}

/* ── Postgres ───────────────────────────────────────────────────────────── */

type PostgresLike = {
  unsafe(sql: string, params: unknown[]): Promise<unknown[]>
  begin<T>(fn: (tx: PostgresLike) => Promise<T>): Promise<T>
  savepoint<T>(fn: (tx: PostgresLike) => Promise<T>): Promise<T>
}

class PostgresDb implements Db {
  readonly engine = 'postgres' as const

  /**
   * The connection currently in scope.
   *
   * Set while inside `transaction`, so a repository call made within one runs
   * on the transaction's connection rather than checking out a fresh one from
   * the pool. Without this, work inside a transaction would execute outside it
   * and survive a rollback — and on Postgres it would also escape the
   * `SET LOCAL` that scopes row-level security to the tenant.
   */
  private current: PostgresLike | null = null

  private async sql(): Promise<PostgresLike> {
    if (this.current) return this.current
    const { db: pool } = await import('@/lib/db/postgres')
    return pool() as unknown as PostgresLike
  }

  async all(sql: string, params: QueryParams = []): Promise<Row[]> {
    const client = await this.sql()
    const rows = (await client.unsafe(toPositional(sql), [...params])) as Record<
      string,
      unknown
    >[]
    return rows.map(normaliseRow)
  }

  async get(sql: string, params: QueryParams = []): Promise<Row | undefined> {
    const rows = await this.all(sql, params)
    return rows[0]
  }

  async run(sql: string, params: QueryParams = []): Promise<void> {
    const client = await this.sql()
    await client.unsafe(toPositional(sql), [...params])
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.current

    if (outer) {
      // Already inside one: nest by savepoint so a failure here rolls back only
      // this unit of work, matching the SQLite adapter's semantics exactly.
      return outer.savepoint(async (tx) => {
        this.current = tx
        try {
          return await fn()
        } finally {
          this.current = outer
        }
      })
    }

    const client = await this.sql()
    return client.begin(async (tx) => {
      this.current = tx
      try {
        return await fn()
      } finally {
        this.current = null
      }
    })
  }
}

/* ── selection ──────────────────────────────────────────────────────────── */

let instance: Db | null = null

/**
 * Which engine is in use.
 *
 * Postgres is selected by the presence of DATABASE_URL, not by a separate
 * flag — a deployment that has a database URL configured and is silently
 * writing to a local SQLite file is a data-loss incident waiting to be
 * discovered, and one switch is one thing to get wrong instead of two.
 */
export function db(): Db {
  if (instance) return instance
  instance = process.env.DATABASE_URL ? new PostgresDb() : new SqliteDb()
  return instance
}

/** Test seam. Never called by application code. */
export function __setDb(next: Db | null): void {
  instance = next
}
