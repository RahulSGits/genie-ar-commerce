-- ═══════════════════════════════════════════════════════════════════════════
-- ARView Commerce — schema
--
-- Engine: SQLite (via node:sqlite, built into Node 24 — no Docker, no native
-- build, no external service). See docs/database.md for the Postgres/Supabase
-- production path; all SQL is confined to lib/db/repositories so swapping the
-- engine does not touch application code.
--
-- Conventions:
--   · ids           TEXT, UUIDv4
--   · money         INTEGER minor units (paise). Never REAL — see utils/money.ts
--   · booleans      INTEGER 0/1
--   · timestamps    TEXT, ISO-8601 UTC
--   · json          TEXT, parsed at the repository boundary
--   · soft delete   deleted_at TEXT NULL, filtered in every repository read
--
-- TENANCY: every tenant-scoped table carries business_id and every repository
-- read requires it as an argument. There is no code path that can query a
-- tenant table without naming the tenant.
-- ═══════════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ── identity ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  -- scrypt, format: scrypt$N$r$p$salt_b64$hash_b64. Never plaintext, never MD5.
  password_hash   TEXT NOT NULL,
  full_name       TEXT NOT NULL DEFAULT '',
  avatar_url      TEXT,
  -- Platform-level role. Business-level roles live in business_members.
  is_super_admin  INTEGER NOT NULL DEFAULT 0,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
-- Case-insensitive uniqueness: Rahul@x.com and rahul@x.com are one account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the cookie token. A database leak must not yield live sessions.
  token_hash    TEXT NOT NULL UNIQUE,
  user_agent    TEXT,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

-- ── tenants ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS businesses (
  id                TEXT PRIMARY KEY,
  -- Appears in public AR URLs: /ar/<slug>/<product-slug>
  slug              TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'other',
  description       TEXT,
  logo_url          TEXT,
  cover_url         TEXT,
  brand_color       TEXT,

  phone             TEXT,
  email             TEXT,
  address           TEXT,
  city              TEXT,
  website_url       TEXT,
  instagram_url     TEXT,
  facebook_url      TEXT,
  whatsapp_number   TEXT,
  maps_url          TEXT,

  -- Category-specific action links, surfaced as CTAs on public pages.
  menu_url          TEXT,
  ordering_url      TEXT,
  reservation_url   TEXT,
  store_url         TEXT,
  opening_hours     TEXT,           -- json

  currency          TEXT NOT NULL DEFAULT 'INR',
  timezone          TEXT NOT NULL DEFAULT 'Asia/Kolkata',

  -- active | suspended | archived. Suspension is an explicit admin action.
  status            TEXT NOT NULL DEFAULT 'active',

  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_slug ON businesses (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses (status);

-- Admin-only notes, deliberately NOT a column on businesses.
--
-- The public product page has to read a business row, and row-level security is
-- row-level — a column on `businesses` is reachable by anything that selects
-- the row. Keeping notes in their own table makes admin-only structural rather
-- than a promise the mapper has to keep.
CREATE TABLE IF NOT EXISTS business_internal_notes (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS business_members (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- owner | admin | member
  role         TEXT NOT NULL DEFAULT 'member',
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_unique ON business_members (business_id, user_id);
CREATE INDEX IF NOT EXISTS idx_member_user ON business_members (user_id);

-- ── plans & subscriptions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                  TEXT PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  price_minor         INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'INR',
  -- monthly | yearly
  billing_interval    TEXT NOT NULL DEFAULT 'monthly',
  setup_fee_minor     INTEGER NOT NULL DEFAULT 0,
  -- Limits and features are DATA, never code. NULL inside limits = unlimited.
  limits              TEXT NOT NULL,   -- json PlanLimits
  features            TEXT NOT NULL,   -- json PlanFeatures
  trial_days          INTEGER NOT NULL DEFAULT 14,
  is_public           INTEGER NOT NULL DEFAULT 1,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  archived            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    TEXT PRIMARY KEY,
  business_id           TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id               TEXT NOT NULL REFERENCES subscription_plans(id),
  -- trialing | active | past_due | grace | suspended | cancelled
  status                TEXT NOT NULL DEFAULT 'trialing',
  -- A negotiated price lives HERE, never by editing the shared plan.
  negotiated_price_minor INTEGER,
  -- Per-business overrides merged over the plan's own values.
  limits_override       TEXT,          -- json Partial<PlanLimits>
  features_override     TEXT,          -- json Partial<PlanFeatures>
  billing_interval      TEXT NOT NULL DEFAULT 'monthly',
  trial_ends_at         TEXT,
  current_period_start  TEXT NOT NULL,
  current_period_end    TEXT NOT NULL,
  -- Days after the due date before suspension is offered. Editable per business.
  grace_days            INTEGER NOT NULL DEFAULT 7,
  cancelled_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_business ON subscriptions (business_id);
CREATE INDEX IF NOT EXISTS idx_subs_status ON subscriptions (status);

-- ── catalog ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS three_d_models (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  glb_url         TEXT,
  usdz_url        TEXT,
  poster_url      TEXT,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  format          TEXT,
  triangle_count  INTEGER,
  -- processing | ready | failed. Only 'ready' models are ever served publicly.
  status          TEXT NOT NULL DEFAULT 'processing',
  error_message   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_models_business ON three_d_models (business_id);

CREATE TABLE IF NOT EXISTS menu_categories (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_cats_business ON menu_categories (business_id, sort_order);

CREATE TABLE IF NOT EXISTS products (
  id                 TEXT PRIMARY KEY,
  business_id        TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id        TEXT REFERENCES menu_categories(id) ON DELETE SET NULL,
  model_id           TEXT REFERENCES three_d_models(id) ON DELETE SET NULL,

  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  description        TEXT,
  short_description  TEXT,
  sku                TEXT,

  price_minor        INTEGER,
  compare_at_minor   INTEGER,
  currency           TEXT NOT NULL DEFAULT 'INR',

  image_url          TEXT,
  thumbnail_url      TEXT,

  -- Real-world size. Drives AR scale; NULL falls back to a placement default.
  dim_width          REAL,
  dim_height         REAL,
  dim_depth          REAL,
  dim_unit           TEXT NOT NULL DEFAULT 'cm',
  weight_grams       REAL,

  -- tabletop | floor | wall | handheld
  placement          TEXT NOT NULL DEFAULT 'tabletop',
  scale_multiplier   REAL NOT NULL DEFAULT 1,
  rotation_y         REAL NOT NULL DEFAULT 0,
  ar_enabled         INTEGER NOT NULL DEFAULT 1,

  cta_label          TEXT,
  cta_url            TEXT,

  -- draft | published | archived. Only 'published' is publicly reachable.
  status             TEXT NOT NULL DEFAULT 'draft',
  is_featured        INTEGER NOT NULL DEFAULT 0,
  is_bestseller      INTEGER NOT NULL DEFAULT 0,
  is_available       INTEGER NOT NULL DEFAULT 1,
  sort_order         INTEGER NOT NULL DEFAULT 0,

  tags               TEXT,   -- json string[]
  allergens          TEXT,   -- json string[]  (food)
  diet               TEXT,   -- veg | non-veg | egg | null
  materials          TEXT,   -- json string[]  (apparel/furniture)
  colors             TEXT,   -- json string[]
  sizes              TEXT,   -- json string[]

  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products (business_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_business ON products (business_id, status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id, sort_order);

-- ── QR ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qr_codes (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id    TEXT REFERENCES products(id) ON DELETE CASCADE,
  -- Unguessable, rotatable public token. The printed QR points at /ar/r/<token>,
  -- so the destination can change without reprinting anything.
  token         TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL DEFAULT '',
  -- ar | product | menu | website | custom — what /ar/r/<token> redirects to.
  destination   TEXT NOT NULL DEFAULT 'ar',
  custom_url    TEXT,
  campaign      TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  scan_count    INTEGER NOT NULL DEFAULT 0,
  last_scan_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_qr_business ON qr_codes (business_id);
CREATE INDEX IF NOT EXISTS idx_qr_product ON qr_codes (product_id);

-- ── analytics ─────────────────────────────────────────────────────────────
-- Append-only, no PII. No IP, no fingerprint, no camera data — ever.

CREATE TABLE IF NOT EXISTS analytics_events (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id   TEXT REFERENCES products(id) ON DELETE SET NULL,
  qr_code_id   TEXT REFERENCES qr_codes(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL,
  -- Coarse buckets only: 'mobile'|'tablet'|'desktop', 'Safari', 'iOS'.
  device_type  TEXT,
  browser      TEXT,
  os           TEXT,
  ar_tier      TEXT,
  campaign     TEXT,
  -- Random per page-load, not per person. Lets us count sessions without
  -- identifying anyone; not stable across visits by design.
  session_key  TEXT,
  created_at   TEXT NOT NULL,
  -- Denormalised YYYY-MM-DD for cheap grouping without date functions.
  day          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_business_day ON analytics_events (business_id, day);
CREATE INDEX IF NOT EXISTS idx_events_type ON analytics_events (business_id, event_type, day);
CREATE INDEX IF NOT EXISTS idx_events_product ON analytics_events (product_id, day);

-- ── billing ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invoices (
  id                TEXT PRIMARY KEY,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  subscription_id   TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  number            TEXT NOT NULL UNIQUE,
  -- draft | sent | paid | partial | overdue | cancelled
  status            TEXT NOT NULL DEFAULT 'draft',
  currency          TEXT NOT NULL DEFAULT 'INR',
  subtotal_minor    INTEGER NOT NULL DEFAULT 0,
  discount_minor    INTEGER NOT NULL DEFAULT 0,
  tax_minor         INTEGER NOT NULL DEFAULT 0,
  total_minor       INTEGER NOT NULL DEFAULT 0,
  -- Denormalised sum of payments. Kept in step by the repository inside a
  -- transaction; never written by hand.
  paid_minor        INTEGER NOT NULL DEFAULT 0,
  tax_name          TEXT,
  tax_percent       REAL,
  issue_date        TEXT NOT NULL,
  due_date          TEXT NOT NULL,
  paid_at           TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices (business_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices (due_date, status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  unit_minor    INTEGER NOT NULL DEFAULT 0,
  amount_minor  INTEGER NOT NULL DEFAULT 0,
  -- subscription | setup_fee | model | custom
  kind          TEXT NOT NULL DEFAULT 'custom',
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items (invoice_id, sort_order);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- Payments outlive invoices for audit; never cascade-delete billing history.
  invoice_id     TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'INR',
  -- cash | bank_transfer | upi | razorpay | other
  method         TEXT NOT NULL DEFAULT 'cash',
  reference      TEXT,
  proof_url      TEXT,
  notes          TEXT,
  paid_at        TEXT NOT NULL,
  recorded_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_business ON payments (business_id, paid_at);

CREATE TABLE IF NOT EXISTS coupons (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  description         TEXT,
  -- percentage | fixed
  discount_type       TEXT NOT NULL DEFAULT 'percentage',
  discount_value      INTEGER NOT NULL DEFAULT 0,
  -- once | recurring
  duration            TEXT NOT NULL DEFAULT 'once',
  applicable_plans    TEXT,      -- json string[]; null = all plans
  starts_at           TEXT,
  expires_at          TEXT,
  max_redemptions     INTEGER,
  per_business_limit  INTEGER NOT NULL DEFAULT 1,
  redemption_count    INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotions (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  discount_type     TEXT NOT NULL DEFAULT 'percentage',
  discount_value    INTEGER NOT NULL DEFAULT 0,
  coupon_code       TEXT,
  applicable_plans  TEXT,       -- json string[]
  starts_at         TEXT NOT NULL,
  ends_at           TEXT NOT NULL,
  -- Site-wide banner shown on the marketing site while live.
  banner_title      TEXT,
  banner_message    TEXT,
  banner_cta_label  TEXT,
  banner_cta_url    TEXT,
  banner_color      TEXT,
  show_banner       INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- ── reminders & notifications ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reminder_rules (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  -- Negative = before due, 0 = on due, positive = after due.
  offset_days    INTEGER NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'in_app',
  is_active      INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  business_id  TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  -- info | warning | success | billing
  kind         TEXT NOT NULL DEFAULT 'info',
  link_url     TEXT,
  read_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifs_business ON notifications (business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications (user_id, read_at);

CREATE TABLE IF NOT EXISTS notification_logs (
  id            TEXT PRIMARY KEY,
  business_id   TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  invoice_id    TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  rule_id       TEXT REFERENCES reminder_rules(id) ON DELETE SET NULL,
  recipient     TEXT NOT NULL,
  channel       TEXT NOT NULL,
  subject       TEXT,
  content       TEXT,
  -- sent | failed | skipped_no_provider
  status        TEXT NOT NULL,
  provider      TEXT,
  reference_id  TEXT,
  error         TEXT,
  sent_at       TEXT,
  failed_at     TEXT,
  created_at    TEXT NOT NULL
);
-- Idempotency: one send per (invoice, rule). Re-running the engine is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notiflog_once
  ON notification_logs (invoice_id, rule_id)
  WHERE invoice_id IS NOT NULL AND rule_id IS NOT NULL;

-- ── CRM ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_leads (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  business_name      TEXT NOT NULL DEFAULT '',
  business_type      TEXT,
  phone              TEXT,
  email              TEXT,
  city               TEXT,
  website            TEXT,
  instagram          TEXT,
  source             TEXT,
  -- new | contacted | demo_scheduled | demo_completed | proposal_sent
  -- | negotiation | won | lost
  stage              TEXT NOT NULL DEFAULT 'new',
  expected_value_minor INTEGER NOT NULL DEFAULT 0,
  interested_plan_id TEXT REFERENCES subscription_plans(id) ON DELETE SET NULL,
  assigned_to        TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Set when the lead is converted, linking pipeline to revenue.
  converted_business_id TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  next_follow_up_at  TEXT,
  last_contact_at    TEXT,
  lost_reason        TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON crm_leads (stage, sort_order);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON crm_leads (next_follow_up_at);

CREATE TABLE IF NOT EXISTS crm_notes (
  id          TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_lead ON crm_notes (lead_id, created_at);

CREATE TABLE IF NOT EXISTS crm_tasks (
  id           TEXT PRIMARY KEY,
  lead_id      TEXT REFERENCES crm_leads(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  due_at       TEXT,
  completed_at TEXT,
  assigned_to  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON crm_tasks (due_at, completed_at);

CREATE TABLE IF NOT EXISTS crm_activities (
  id          TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  from_value  TEXT,
  to_value    TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acts_lead ON crm_activities (lead_id, created_at);

-- ── support ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_tickets (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  opened_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject      TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'technical',
  priority     TEXT NOT NULL DEFAULT 'normal',
  -- open | pending | closed
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_business ON support_tickets (business_id, status);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_staff    INTEGER NOT NULL DEFAULT 0,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tmsgs_ticket ON ticket_messages (ticket_id, created_at);

-- ── platform ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,   -- json
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_sections (
  id          TEXT PRIMARY KEY,
  -- landing_hero | landing_features | faq | testimonials | footer | legal_*
  key         TEXT NOT NULL UNIQUE,
  content     TEXT NOT NULL,   -- json, validated by a Zod schema per key
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  business_id  TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  before_value TEXT,   -- json
  after_value  TEXT,   -- json
  metadata     TEXT,   -- json
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity_type, entity_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- GENIE additions
--
-- The rest of GENIE's conceptual model already exists above:
--   organizations/workspaces → businesses      memberships → business_members
--   three_d_assets           → three_d_models  brand_settings → businesses.*
--   ar_experiences           → products.{placement, ar_enabled, scale_multiplier}
-- Only these four are genuinely new.
-- ═══════════════════════════════════════════════════════════════════════════

-- Source images uploaded for a product. Multiple angles improve reconstruction
-- quality, so this is a collection rather than a single column on products.
CREATE TABLE IF NOT EXISTS product_images (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id   TEXT REFERENCES products(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  bytes        INTEGER NOT NULL DEFAULT 0,
  mime         TEXT,
  -- primary | angle | reference. The primary image is the product thumbnail.
  role         TEXT NOT NULL DEFAULT 'primary',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pimages_product ON product_images (product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pimages_business ON product_images (business_id);

-- One image-to-3D generation attempt.
--
-- Deliberately a durable record rather than in-memory state: generation is
-- asynchronous and can take minutes, the browser may close mid-run, and a
-- failure needs to be explainable afterwards. `stage` drives the progress UI
-- and is only ever advanced by the backend — the client never invents it.
CREATE TABLE IF NOT EXISTS generation_jobs (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id     TEXT REFERENCES products(id) ON DELETE CASCADE,
  model_id       TEXT REFERENCES three_d_models(id) ON DELETE SET NULL,
  -- Which AI3DProvider ran this. 'none' when no provider is configured.
  provider       TEXT NOT NULL DEFAULT 'none',
  -- The provider's own job id, for polling and support tickets.
  provider_job_id TEXT,
  -- queued | running | succeeded | failed | cancelled
  status         TEXT NOT NULL DEFAULT 'queued',
  -- uploading | analyzing | geometry | materials | optimizing | packaging | complete
  stage          TEXT NOT NULL DEFAULT 'uploading',
  -- 0-100 where the provider reports it; NULL means indeterminate.
  progress       INTEGER,
  error_code     TEXT,
  error_message  TEXT,
  -- json: the input image ids and any provider options, for reproducibility.
  input          TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_business ON generation_jobs (business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_product ON generation_jobs (product_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON generation_jobs (status);

CREATE TABLE IF NOT EXISTS collections (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  cover_url    TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_slug
  ON collections (business_id, slug) WHERE deleted_at IS NULL;

-- Many-to-many: a product can appear in several collections (a dish can be in
-- both "Summer Menu" and "Bestsellers").
CREATE TABLE IF NOT EXISTS collection_products (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_cprod_product ON collection_products (product_id);

/* ═══════════════════════════════════════════════════════════════════════════
   CAMPAIGNS

   A campaign is a dated, named grouping of products with its own QR codes and
   its own landing page. It exists because "Summer Menu 2026" is how a business
   actually thinks about a promotion — and because scan analytics are only
   commercially useful when they can be attributed to the thing being promoted
   rather than to the whole catalogue.
   ═══════════════════════════════════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS campaigns (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  description   TEXT,
  cover_url     TEXT,
  -- Where a campaign QR lands. 'landing' renders the campaign page; 'product'
  -- jumps straight to a single product's AR page.
  destination   TEXT NOT NULL DEFAULT 'landing',
  product_id    TEXT REFERENCES products(id) ON DELETE SET NULL,
  -- draft | scheduled | active | paused | expired. Derived from the dates on
  -- read (see resolveCampaignStatus) so a campaign cannot sit "active" past
  -- its own end date because no job ran.
  status        TEXT NOT NULL DEFAULT 'draft',
  starts_at     TEXT,
  ends_at       TEXT,
  goal          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_slug
  ON campaigns (business_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_business ON campaigns (business_id, status);

CREATE TABLE IF NOT EXISTS campaign_products (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_camp_prod_product ON campaign_products (product_id);

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC API + WEBHOOKS

   Only the SHA-256 of a key is stored. The plaintext is shown exactly once at
   creation and is unrecoverable afterwards, so a database dump yields nothing
   usable — the same reasoning as the session tokens.
   ═══════════════════════════════════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- First 12 chars ("gk_live_ab12"), for identifying a key in a list.
  prefix       TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  -- json string[] of scopes: products:read, products:write, ...
  scopes       TEXT NOT NULL DEFAULT '[]',
  last_used_at TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT,
  revoked_at   TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_business ON api_keys (business_id);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  -- Shared secret for the HMAC-SHA256 signature on every delivery.
  secret       TEXT NOT NULL,
  -- json string[] of event names, or ["*"].
  events       TEXT NOT NULL DEFAULT '[]',
  is_active    INTEGER NOT NULL DEFAULT 1,
  -- Consecutive failures. An endpoint that keeps failing is disabled rather
  -- than retried forever against a customer's dead server.
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  last_success_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_business ON webhook_endpoints (business_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           TEXT PRIMARY KEY,
  endpoint_id  TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event        TEXT NOT NULL,
  payload      TEXT NOT NULL,   -- json
  -- pending | delivered | failed
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  error        TEXT,
  next_retry_at TEXT,
  delivered_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON webhook_deliveries (status, next_retry_at);

/* ═══════════════════════════════════════════════════════════════════════════
   RATE LIMITING

   A fixed-window counter keyed by (bucket, window). Kept in the database
   rather than in memory because Next.js serverless instances do not share
   memory — an in-process limiter silently multiplies the real limit by the
   number of running instances.
   ═══════════════════════════════════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

/* ═══════════════════════════════════════════════════════════════════════════
   COST LEDGER

   GENIE is itself a SaaS business, so it has to know what a customer costs to
   serve. Every billable-to-GENIE action appends a row here in the same integer
   minor units as revenue, which is what makes gross margin a subtraction
   rather than an estimate.
   ═══════════════════════════════════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS cost_events (
  id           TEXT PRIMARY KEY,
  business_id  TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  -- ai_generation | storage | bandwidth | compute | api
  kind         TEXT NOT NULL,
  provider     TEXT,
  -- What was consumed (1 generation, N bytes, N requests).
  quantity     REAL NOT NULL DEFAULT 0,
  unit         TEXT NOT NULL DEFAULT 'unit',
  -- Cost to GENIE, in minor units of `currency`. Never a float.
  cost_minor   INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'INR',
  reference_id TEXT,
  metadata     TEXT,   -- json
  day          TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_business ON cost_events (business_id, day);
CREATE INDEX IF NOT EXISTS idx_cost_kind ON cost_events (kind, day);

/* ═══════════════════════════════════════════════════════════════════════════
   INTEGRATIONS

   A row exists only once a connection has actually been established. There is
   deliberately no "available integrations" table seeded with logos — the
   catalogue is code (lib/integrations/registry.ts), and a card only reads
   "Connected" when a row here says so.
   ═══════════════════════════════════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS integrations (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  -- connected | error | disconnected
  status       TEXT NOT NULL DEFAULT 'disconnected',
  config       TEXT,   -- json, non-secret display config only
  last_sync_at TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_unique
  ON integrations (business_id, provider);
