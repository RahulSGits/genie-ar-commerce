/**
 * Connectivity and RLS check.
 *
 *   npm run db:health
 *
 * Reports more than "did it connect": a superuser bypasses every RLS policy, so
 * a connection that works can still have no tenant isolation whatsoever. That
 * is the thing worth knowing.
 */

import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url || url.includes('[YOUR-PASSWORD]')) {
  console.error('DATABASE_URL is missing or still has the [YOUR-PASSWORD] placeholder.')
  process.exit(1)
}

const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 })
const started = Date.now()

try {
  const [info] = await sql`
    select version() as version,
           current_user as who,
           coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_super
  `
  console.log(`  connected in ${Date.now() - started}ms`)
  console.log(`  ${info.version.split(',')[0]}`)
  console.log(`  role: ${info.who}`)

  const [{ n: tables }] = await sql`
    select count(*)::int as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
  `
  const [{ n: policies }] = await sql`select count(*)::int as n from pg_policies where schemaname = 'public'`
  console.log(`  tables: ${tables}   policies: ${policies}`)

  if (info.is_super) {
    console.log(
      `\n  ⚠  Connected as a SUPERUSER — RLS policies are bypassed entirely.\n` +
        `     Point DATABASE_URL at the genie_app role before trusting isolation.`,
    )
  } else {
    console.log(`\n  ✓ RLS is enforced for this role`)
  }
} catch (err) {
  console.error(`  connection failed: ${err.message}`)
  process.exit(1)
} finally {
  await sql.end()
}
