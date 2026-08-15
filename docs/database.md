# Database

## Engine

**SQLite via `node:sqlite`** — built into Node 24. No Docker, no native
compile, no external service, no credentials. `npm install && npm run db:seed`
and the whole platform runs.

The brief specified Supabase. That requires an account and API keys, and local
Supabase requires Docker; neither was available, and the standing requirement
was that everything works on localhost immediately. This is the choice that
satisfies it.

## The seam

**All SQL is confined to `lib/db/repositories/*`.** Application code — pages,
actions, components — never writes a query. Swapping to Postgres means
rewriting those files and nothing else.

`lib/db/index.ts` owns the connection, migration, JSON/boolean coercion helpers
and `transaction()`.

## Conventions

| Concern | Choice | Why |
| --- | --- | --- |
| ids | TEXT, UUIDv4 | portable, non-enumerable |
| money | INTEGER minor units | floats lose paise; see `utils/money.ts` |
| booleans | INTEGER 0/1 | SQLite has no boolean |
| timestamps | TEXT, ISO-8601 UTC | sorts lexicographically, timezone-safe |
| json | TEXT | parsed at the repository boundary only |
| soft delete | `deleted_at` | billing and audit history must survive |

`analytics_events` carries a denormalised `day` (YYYY-MM-DD) so dashboard
grouping needs no date functions and hits an index.

## Tenancy

Every tenant table carries `business_id`, and every repository read takes it as
a required argument. See `docs/security.md`.

## Migration

`lib/db/schema.sql` is idempotent — every statement is `CREATE ... IF NOT
EXISTS` — and runs on first connection. Fine for a single-file embedded
database; a Postgres deployment should use numbered migration files instead.

## Moving to Postgres / Supabase

1. Translate `schema.sql`: `TEXT`→`uuid`/`timestamptz`, `INTEGER` money→`bigint`,
   `INTEGER` booleans→`boolean`, JSON columns→`jsonb`.
2. Rewrite `lib/db/repositories/*` against the Postgres client. Signatures stay
   identical, so nothing above them changes.
3. **Add RLS on every tenant table** — on top of the existing application-layer
   scoping, not instead of it.
4. Replace `lib/auth/*` with Supabase Auth if desired, or keep the current
   implementation (it is portable and has no vendor dependency).
5. Move uploads from `public/uploads` to Supabase Storage / R2 and swap the two
   write calls in `lib/actions/dashboard.ts`.

## Scale

SQLite comfortably handles this workload — a few hundred businesses, tens of
thousands of analytics rows, single-digit writes per second. The real constraint
is deployment: **SQLite needs a persistent filesystem**, which serverless
platforms do not provide. Vercel and similar require the Postgres migration
above. A single VM or container with a mounted volume runs this as-is.
