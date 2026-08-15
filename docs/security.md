# Security model

## Where authorization lives

**Server-side, always.** Not in the UI, not in route naming. A hidden nav link
is not access control.

Two layers:

1. **Guards** (`lib/auth/guards.ts`) — `requireUser`, `requireBusiness`,
   `requireBusinessRole`, `requireSuperAdmin`. Every server entry point that
   touches tenant data calls one first.
2. **Repository signatures** — every tenant-scoped read takes `businessId` as a
   *required* argument. `getProduct(businessId, id)`, not `getProduct(id)`.
   There is no code path that can query a tenant table without naming the
   tenant, so IDOR is a type error rather than a review question.

Server actions never accept a `businessId` from the form. They re-resolve it
from the session. A crafted POST cannot reach another tenant's rows.

### On RLS

This build uses SQLite, which has no row-level security. Tenant isolation is
therefore entirely the two layers above. **If you migrate to Postgres/Supabase,
add RLS on top — not instead.** Defence in depth: the application layer already
scopes correctly, and RLS catches the query someone forgets to scope.

## Passwords and sessions

- **scrypt** (`node:crypto`), N=2^16, r=8, p=1 — the OWASP parameters. Memory-hard,
  so GPU cracking is expensive. Encoded as `scrypt$N$r$p$salt$hash` so the cost
  can be raised later without invalidating existing hashes.
- Verification is **constant-time** (`timingSafeEqual`) and returns false on
  malformed input rather than throwing.
- Sign-in gives a **uniform error** for unknown-email and wrong-password, and
  runs a dummy verification when no user matches so response time does not leak
  account existence.
- Sessions: 256-bit random token in an **HttpOnly, SameSite=Lax** cookie
  (`Secure` in production). Only the token's **SHA-256** is stored, so a
  database dump yields no usable sessions. Expiry is checked on every read, not
  only by a sweep.
- `/admin/login` returns the same error to a valid business user as to a bad
  password — it never confirms that an account exists but lacks admin rights.

## Public surface

Three anonymous endpoints. Each is deliberately narrow.

**`/r/[token]`** — QR redirect. The token is the only credential: 80 bits of
CSPRNG output in a Crockford-style alphabet, not an enumerable database id. It
is rotatable (`regenerateQrToken`) so a leaked or misprinted code can be killed
without reprinting the sticker. Unknown, deactivated, deleted and
suspended-business codes all resolve to the *same* friendly page, so the
endpoint cannot be used to probe which codes exist. Redirect is **307**, never
cached permanently, because the mapping is intentionally mutable.

**`/ar/[businessSlug]/[productSlug]`** — the product page. Only `published`
products belonging to an `active` business resolve; the filter is inside
`getPublicProduct`, not at the call site, so an unpublished draft cannot leak
through a guessed URL. The page maps rows into `PublicArProduct`, a strict
subset — private columns (cost, internal notes, billing state) are structurally
unable to reach the client.

**`POST /api/analytics/event`** — anonymous ingest. Closed allow-list of event
types, business resolved by public slug (never an id the caller supplies),
device fields clamped to short coarse strings. Unknown business returns a silent
204 so it cannot probe slugs. Worst case for an abuser is inflating a business's
own counters — a data-quality nuisance, not a breach.

## File uploads

Client-side validation is a UX affordance. The server trusts **only the bytes**.

- **Magic-byte detection**: GLB (`glTF` header), glTF (parsed as JSON with the
  expected keys), USDZ (ZIP header **and** a matching extension — a ZIP header
  alone proves only that it is an archive).
- Browser-supplied MIME type and filename are hints, never evidence.
- **SVG is rejected outright.** It is executable markup; serving user-uploaded
  SVG from our own origin is stored XSS.
- Filenames are never used as paths. `safeStorageName()` keeps only the
  extension and rebuilds the stem from an allow-list, prefixed with a UUID —
  closing path traversal, null-byte truncation and Windows device names.
- Size ceiling 25 MB, plus a per-plan storage entitlement check *before* the
  write.

## Privacy

The camera is the sensitive surface, and the guarantee is simple: **no camera
imagery ever leaves the device.** AR runs entirely in the browser. Nothing is
uploaded, nothing is stored.

Analytics stores coarse buckets only — `mobile`/`Safari`/`iOS`. Never an IP
address, never a raw user-agent string, never a fingerprint. `session_key` is
random **per page load, not per person**: enough to join a funnel, useless for
tracking anyone across visits.

Customers are never asked to create an account. There is no customer PII in the
system to leak.

## Audit

`recordAudit()` records every privileged action — price changes, suspensions,
plan edits, invoice and payment changes, lead conversion, CMS and branding
edits. Captures actor, action, entity, before/after and timestamp. Visible at
`/admin/audit`.

## Secrets

- `.env.local` is gitignored; `.env.example` documents every variable.
- No secret is `NEXT_PUBLIC_` prefixed.
- Admin credentials are **never hardcoded**. The seed reads `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` and warns loudly when falling back to development defaults.

## Known gaps

Honest list of what is *not* done:

- **No rate limiting.** The analytics and QR endpoints are unthrottled. On
  serverless without a shared store this needs an external service; the
  mitigation today is that neither endpoint can do damage beyond skewing a
  business's own numbers.
- **No CSP.** The AR viewer needs `blob:` and `data:` for generated textures and
  Draco workers. A production CSP should be nonce-based in middleware.
- **No email verification** on signup.
- **No 2FA** for the super admin.
