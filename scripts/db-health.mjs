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
  // rolsuper alone is NOT the test. On Supabase the `postgres` role is not a
  // superuser but DOES carry rolbypassrls, and it owns every table — either
  // condition makes RLS a no-op. Checking only rolsuper reports a wide-open
  // connection as secure.
  const [info] = await sql`
    select version() as version,
           current_user as who,
           coalesce((select rolsuper     from pg_roles where rolname = current_user), false) as is_super,
           coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypasses_rls,
           exists (
             select 1 from pg_tables
              where schemaname = 'public' and tableowner = current_user
           ) as owns_tables
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

  const reasons = []
  if (info.is_super) reasons.push('role is a SUPERUSER')
  if (info.bypasses_rls) reasons.push('role has BYPASSRLS')
  if (info.owns_tables) reasons.push('role OWNS tables (owners bypass RLS unless FORCE is set)')

  if (reasons.length) {
    console.log(
      `\n  ⚠  RLS IS NOT ENFORCED for this connection:\n` +
        reasons.map((r) => `       · ${r}`).join('\n') +
        `\n\n     All ${policies} policies are decorative right now.\n` +
        `     Point DATABASE_URL at the genie_app role before trusting isolation.`,
    )
    process.exitCode = 1
  } else {
    console.log(`\n  ✓ RLS is enforced — ${policies} policies apply to this role`)
  }
} catch (err) {
  console.error(`  connection failed: ${err.message}`)
  process.exit(1)
} finally {
  await sql.end()
}
