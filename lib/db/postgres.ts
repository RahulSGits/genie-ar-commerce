import 'server-only'

import postgres from 'postgres'

/**
 * Postgres connection layer.
 *
 * Two pools, because Supabase exposes two poolers and they are not
 * interchangeable:
 *
 *   DATABASE_URL  port 6543, TRANSACTION mode — the app. A connection is only
 *                 yours for the length of a transaction, which is exactly why
 *                 `SET LOCAL` below is safe and plain `SET` would be a
 *                 cross-tenant data leak.
 *   DIRECT_URL    port 5432, SESSION mode — migrations and the seed. DDL and
 *                 advisory locks need a stable session.
 *
 * `prepare: false` is mandatory on the transaction pooler: pgbouncer multiplexes
 * connections, so a prepared statement created on one backend will not exist on
 * the next one you get.
 */

let appPool: postgres.Sql | null = null
let directPool: postgres.Sql | null = null

function requireUrl(name: 'DATABASE_URL' | 'DIRECT_URL'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Copy it from Supabase → Project Settings → Database ` +
        `and substitute your real password for [YOUR-PASSWORD].`,
    )
  }
  if (value.includes('[YOUR-PASSWORD]')) {
    throw new Error(
      `${name} still contains the literal placeholder [YOUR-PASSWORD]. ` +
        `Replace it with the database password from Supabase → Settings → Database.`,
    )
  }
  return value
}

/** Application pool. Every query through this is subject to RLS. */
export function db(): postgres.Sql {
  if (appPool) return appPool
  appPool = postgres(requireUrl('DATABASE_URL'), {
    // See note above — required for the transaction pooler.
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    // Money is bigint. Returning JS strings here would silently break every
    // arithmetic operation, so they are parsed to Number — safe because minor
    // units stay far below 2^53 (≈ ₹90 trillion).
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number) => String(v),
        parse: (v: string) => Number(v),
      },
    },
  })
  return appPool
}

/** Session-mode pool for DDL, migrations and the seed. Bypasses nothing itself. */
export function directDb(): postgres.Sql {
  if (directPool) return directPool
  directPool = postgres(requireUrl('DIRECT_URL'), {
    max: 2,
    idle_timeout: 10,
    connect_timeout: 30,
  })
  return directPool
}

/* ── tenant context ─────────────────────────────────────────────────────── */

export type TenantContext = {
  userId: string | null
  businessId: string | null
  isSuperAdmin: boolean
}

export const ANONYMOUS: TenantContext = {
  userId: null,
  businessId: null,
  isSuperAdmin: false,
}

/**
 * Runs `fn` inside a transaction with the RLS context applied.
 *
 * `SET LOCAL` is transaction-scoped and reverts on commit or rollback. That is
 * the whole reason this is safe on a pooled connection: the next request to
 * borrow this backend cannot inherit the previous tenant's identity. Using
 * plain `SET` here would be a cross-tenant data leak that no test would catch,
 * because it only manifests under connection reuse.
 *
 * Every repository read still passes businessId explicitly. This is the layer
 * beneath that, for the query that forgets.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return db().begin(async (sql) => {
    // set_config(..., true) is the function form of SET LOCAL. Parameterised,
    // so a crafted id cannot inject — string-interpolating into SET would be
    // trivially exploitable.
    await sql`select set_config('app.user_id', ${ctx.userId ?? ''}, true)`
    await sql`select set_config('app.business_id', ${ctx.businessId ?? ''}, true)`
    await sql`select set_config('app.is_super_admin', ${ctx.isSuperAdmin ? 'true' : 'false'}, true)`
    return fn(sql)
  }) as Promise<T>
}

/**
 * For the handful of operations that legitimately precede any tenant context:
 * sign-in (reads a user by email before a session exists) and the QR redirect
 * (resolves a token for an anonymous visitor).
 *
 * Named to be conspicuous in review. Anything else calling this is a bug.
 */
export async function withoutTenant<T>(
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return withTenant(ANONYMOUS, fn)
}

/* ── health ─────────────────────────────────────────────────────────────── */

export type DbHealth =
  | { ok: true; version: string; latencyMs: number; rlsEnforced: boolean }
  | { ok: false; error: string }

/**
 * Connectivity check that also verifies RLS is actually doing something.
 *
 * A superuser or table owner silently bypasses every policy, so a connection
 * that "works" can still have no isolation at all. This reports that explicitly
 * rather than letting it pass as healthy.
 */
export async function checkHealth(): Promise<DbHealth> {
  const started = Date.now()
  try {
    const sql = db()
    const [row] = await sql<{ version: string; is_super: boolean }[]>`
      select version() as version,
             coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_super
    `
    return {
      ok: true,
      version: (row?.version ?? '').split(' ').slice(0, 2).join(' '),
      latencyMs: Date.now() - started,
      // Superusers bypass RLS. If this is false, the policies are decorative.
      rlsEnforced: !row?.is_super,
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function closePools(): Promise<void> {
  await Promise.all([appPool?.end({ timeout: 5 }), directPool?.end({ timeout: 5 })])
  appPool = null
  directPool = null
}
