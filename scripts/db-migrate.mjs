/**
 * Applies the Postgres migrations in supabase/migrations, in order.
 *
 *   npm run db:migrate
 *
 * Uses DIRECT_URL (session mode, port 5432) — the transaction pooler cannot
 * run DDL reliably. Each file runs inside its own transaction, so a failure
 * leaves the schema untouched rather than half-applied.
 */

import postgres from 'postgres'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const url = process.env.DIRECT_URL
if (!url) {
  console.error('DIRECT_URL is not set. Add it to .env.local.')
  process.exit(1)
}
if (url.includes('[YOUR-PASSWORD]')) {
  console.error(
    'DIRECT_URL still contains the literal placeholder [YOUR-PASSWORD].\n' +
      'Get the real password from Supabase → Project Settings → Database.',
  )
  process.exit(1)
}

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

const sql = postgres(url, { max: 1, connect_timeout: 30, idle_timeout: 10 })

// A ledger, so re-running only applies what is new.
await sql`
  create table if not exists _migrations (
    name       text primary key,
    applied_at timestamptz not null default now()
  )
`

const applied = new Set(
  (await sql`select name from _migrations`).map((r) => r.name),
)

let count = 0
for (const file of files) {
  if (applied.has(file)) {
    console.log(`  · ${file} (already applied)`)
    continue
  }
  const body = readFileSync(path.join(dir, file), 'utf8')
  process.stdout.write(`  → ${file} … `)
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`insert into _migrations (name) values (${file})`
    })
    console.log('ok')
    count++
  } catch (err) {
    console.log('FAILED')
    console.error(`\n${err.message}\n`)
    await sql.end()
    process.exit(1)
  }
}

const [{ n }] = await sql`
  select count(*)::int as n from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE'
`
console.log(`\n${count} migration(s) applied. ${n} tables in public.`)

await sql.end()
