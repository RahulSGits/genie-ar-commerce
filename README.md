# GENIE

**Turn Any Product Into 3D & AR.**

A multi-tenant SaaS that turns product images into 3D models, AR experiences and
QR codes. Customers scan a code and see the product in their own space — **at
true physical scale, with no app and no signup**.

Built for restaurants, fashion, furniture, jewelry, retail and e-commerce: the
dashboard's terminology, AR placement behaviour and default sizing all adapt to
what the business sells.

```
product image  →  3D model  →  AR experience  →  QR code  →  customer's table
```

---

## Run it

Requires **Node 24+** (the database is `node:sqlite`, built into Node — there is
nothing to install, no Docker, no external service, no credentials).

```bash
npm install
npm run db:models   # generates the demo GLB assets
npm run db:seed     # creates the database, demo businesses and 6 weeks of data
npm run dev
```

Open http://localhost:3000.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run dev:https` | HTTPS on 0.0.0.0 — **required to test AR on a real phone** |
| `npm run db:seed` | Wipes and reseeds demo data (safe to re-run) |
| `npm run db:models` | Regenerates the demo GLB files |
| `npm run db:reset` | Deletes the database, then models + seed |
| `npm run verify` | typecheck → lint → unit tests → build |

### Sign-in

The seed prints these. Credentials come from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
when set; otherwise it uses documented development defaults and warns.

| Role | URL | Email | Password |
| --- | --- | --- | --- |
| Super admin | `/admin/login` | `admin@arview.local` | `arview-admin-2026` |
| Business (restaurant, paid) | `/login` | `owner@urbanbites.local` | `demo-business-2026` |
| Business (clothing, on trial) | `/login` | `owner@urbanthreads.local` | `demo-business-2026` |

### Try the customer journey — no login

- `/ar/urban-bites/signature-burger`
- `/ar/urban-bites/margherita-pizza`
- `/ar/urban-threads/lounge-chair`
- `/ar/urban-bites` — the whole catalog

The seed also prints `/r/<token>` URLs. Those are what a printed QR encodes:
they record a scan, then redirect. Change a code's destination in the dashboard
and the printed sticker keeps working.

---

## ⚠️ Testing AR on a real phone

`localhost` is enough for 3D, but **AR needs HTTPS** — browsers block the
camera and WebXR on insecure origins. `npm run dev` over your LAN IP will
correctly report "AR isn't supported".

```bash
mkdir -p certificates && openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certificates/key.pem -out certificates/cert.pem \
  -subj "/CN=$(ipconfig getifaddr en0)" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$(ipconfig getifaddr en0)"
npm run dev:https
```

Then open `https://<your-lan-ip>:3000` on your phone and accept the certificate
warning. A self-signed cert works on Android Chrome; **iOS Safari often still
refuses the camera behind a cert warning**, so for a reliable iPhone test use a
trusted certificate — deploy, or tunnel with `cloudflared tunnel --url
http://localhost:3000`.

---

## AI 3D generation

**GENIE never claims a model was AI-generated when it was not.** That rule is
structural, not a promise: with no provider configured, `getProvider()` returns
`NullProvider`, whose `start()` throws. There is no code path that can produce a
successful generation job, so the UI cannot show fabricated progress even by
accident — it removes the option and routes you to uploading a GLB instead.

To connect a real provider, see `lib/ai3d/provider.ts`:

1. Implement `AI3DProvider` in `lib/ai3d/providers/<name>.ts`
2. Register it in `PROVIDERS`
3. Set `MODEL_GEN_PROVIDER` and its API key in `.env.local`
4. Enable the `model_generation` flag in `/admin/settings`

Steps 3 and 4 are both required: the env var supplies credentials, the flag is
the operator's explicit acknowledgement that each generated model costs money.

## AR architecture

`@google/model-viewer` is the primary 3D/AR surface. It resolves to the best
real-AR path a device actually has, which no hand-rolled renderer can do —
iOS Quick Look is an OS handoff with no web API to drive it.

```
                     <model-viewer ar-modes="webxr scene-viewer quick-look">
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                           ▼
          WebXR                    Scene Viewer                 Quick Look
      (Android Chrome)          (Android, ARCore)             (iOS Safari)
      real plane detection      real plane detection       real plane detection
              └───────────────────────────┼───────────────────────────┘
                                          ▼
                              none available → 3D viewer
                        (rotate / zoom / inspect — never a dead end)
```

`canActivateAR` is the authority on whether AR will work — not user-agent
sniffing. When it is false the UI says so plainly rather than offering a button
that fails.

**Scale is real.** glTF units are metres by specification, so the demo models
are authored at true size (the pizza is 30 cm, the chair 69 × 93 cm) and the
viewer runs `ar-scale="fixed"`. The page reads `getDimensions()` back and shows
it — the "15 cm across" badge on the burger is measured, not typed in.

**Three.js** is retained for server-side model generation and geometry
measurement, where the API needs to be lower level than model-viewer exposes.

**AR.js** is installed and wired behind the `marker_ar` feature flag
(`lib/ar/markerAr.ts`). It is deliberately *not* the primary engine — the core
journey is surface placement, which model-viewer does natively. AR.js becomes
useful for image-anchored campaigns ("point at the printed menu"), which needs
a per-campaign marker asset; that pipeline is not built.

---

## Architecture decisions

**Database: SQLite via `node:sqlite`.** The brief asked for Supabase, but
Supabase needs an account and credentials, and local Supabase needs Docker —
neither was available, and the requirement was that everything works on
localhost immediately. All SQL is confined to `lib/db/repositories/*`, so the
engine is a swappable seam. See `docs/database.md` for the Postgres path.

**Auth: scrypt + signed session cookies**, not Supabase Auth — same reasoning,
plus it behaves identically locally and in production. Passwords use scrypt at
OWASP parameters; session cookies store a 256-bit random token whose SHA-256 is
what lands in the database, so a dump yields no usable sessions.

**Tenant isolation is server-side.** Without Postgres RLS, authorization lives
in the guards (`lib/auth/guards.ts`) and in the repository signatures: every
tenant-scoped read takes `businessId` as a required argument, so there is no
code path that can query a tenant table without naming the tenant. This is
defence a UI filter cannot provide. On Postgres, RLS should be added *on top*.

**Money is integer minor units.** Never floats. `utils/money.ts` refuses
non-integer construction, refuses to mix currencies, caps discounts at the
gross, and rounds tax once on the taxable base so an invoice's parts always sum
exactly to its total.

**Entitlements are data, never code.** Nothing anywhere branches on a plan's
name. Limits live on the plan row and are overridable per business, so a
negotiated deal (Urban Bites pays ₹1,499 against the ₹1,999 Growth plan) never
requires editing the shared plan.

**Every paid integration is off by default.** Payment gateways, WhatsApp, voice
calling, AI model generation are provider interfaces behind feature flags. The
whole MVP runs with zero paid services.

---

## What works today

| Area | Status |
| --- | --- |
| Public AR product page | ✅ model-viewer, real scale, capability-honest fallback |
| Public business catalog | ✅ |
| QR redirect layer + scan tracking | ✅ `/r/<token>`, re-pointable without reprinting |
| Analytics ingest + funnel | ✅ anonymous, no PII, 6-stage funnel |
| Landing page from CMS | ✅ hero/features/FAQ/pricing/promo banner all DB-driven |
| Auth: sign in / sign up / sign out | ✅ tenant created transactionally with trial |
| Route guards + tenant isolation | ✅ |
| Business dashboard overview | ✅ live stats, funnel, usage bars, billing alerts |
| Billing engine | ✅ invoices, partial payments, overdue sweep, summaries |
| Entitlements | ✅ + 19 unit tests |
| Money handling | ✅ + 16 unit tests |
| Model validation | ✅ magic-byte, size caps, SVG rejected |
| Demo data | ✅ 2 businesses, 5 GLB models, 4,247 events, invoices, CRM leads |

## Not built yet

These have schema, repositories and seeded data behind them, but no UI:

- Dashboard sub-pages: products CRUD, model upload, QR management/printing,
  analytics detail, business profile, billing view, settings, support
- Super admin dashboard: businesses, revenue, invoicing, pricing editor,
  offers/coupons, CRM board, CMS editor, audit log, system health
- Onboarding wizard
- Reminder dispatch (rules are seeded; the engine that fires them is not)
- Notification email transport (logs record `skipped_no_provider`)
- Playwright E2E suite (`tests/e2e/` is scaffolded, empty)

## Verification

```
tsc --noEmit          clean
vitest                35 passed
next build            clean — 11 routes
```

Verified in-browser: landing, public AR page (model loads, scale badge correct),
catalog, QR redirect (307 → product with tracking params), login, dashboard with
live data, unauthenticated `/dashboard` → redirect to `/login`.

**Not verified:** AR on physical hardware. Placing an object on a real table
needs a real phone with ARCore/ARKit, which cannot be simulated here.

---

## Repository layout

```
app/
  (auth)/          login, signup, admin/login
  (dashboard)/     business dashboard
  ar/              public AR — [businessSlug]/[productSlug]
  r/[token]/       QR redirect layer
  api/analytics/   anonymous event ingest
components/
  ar/              ModelViewer wrapper, ProductArExperience
  ui/              design system primitives
  dashboard/       shell, charts
  public/          customer-facing product view
lib/
  db/              schema.sql, connection, repositories/*  ← all SQL lives here
  auth/            password, session, guards, actions
  ar/              capabilities, model loading, marker-AR seam
  billing/         entitlements
  storage/         upload validation
config/            terminology (per-vertical labels), placement modes
types/             domain, ar, model-viewer JSX
scripts/           seed, demo model generation, QR printing
```
