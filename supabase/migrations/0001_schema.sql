-- ═══════════════════════════════════════════════════════════════════════════
-- GENIE — Postgres schema
--
-- Ported from lib/db/schema.sql (SQLite). Type mapping:
--   TEXT id           → uuid
--   TEXT timestamp    → timestamptz
--   INTEGER money     → bigint      (minor units; see utils/money.ts)
--   INTEGER 0/1       → boolean
--   TEXT json         → jsonb
--
-- Run with the SESSION-mode connection (DIRECT_URL, port 5432). The
-- transaction pooler on 6543 does not support DDL reliably.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── identity ──────────────────────────────────────────────────────────────

create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  -- scrypt: scrypt$N$r$p$salt_b64$hash_b64. Never plaintext.
  password_hash   text not null,
  full_name       text not null default '',
  avatar_url      text,
  is_super_admin  boolean not null default false,
  email_verified  boolean not null default false,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
-- Case-insensitive: Rahul@x.com and rahul@x.com are one account.
create unique index if not exists idx_users_email
  on users (lower(email)) where deleted_at is null;

create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  -- SHA-256 of the cookie token: a database dump yields no usable sessions.
  token_hash    text not null unique,
  user_agent    text,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_sessions_user on sessions (user_id);
create index if not exists idx_sessions_expiry on sessions (expires_at);

create table if not exists password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ── tenants ───────────────────────────────────────────────────────────────

create table if not exists businesses (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  name              text not null,
  category          text not null default 'other',
  description       text,
  logo_url          text,
  cover_url         text,
  brand_color       text,
  phone             text,
  email             text,
  address           text,
  city              text,
  website_url       text,
  instagram_url     text,
  facebook_url      text,
  whatsapp_number   text,
  maps_url          text,
  menu_url          text,
  ordering_url      text,
  reservation_url   text,
  store_url         text,
  opening_hours     jsonb,
  currency          text not null default 'INR',
  timezone          text not null default 'Asia/Kolkata',
  status            text not null default 'active',
  -- Super-admin only. RLS below keeps this off business-facing reads.
  internal_notes    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create unique index if not exists idx_businesses_slug
  on businesses (slug) where deleted_at is null;
create index if not exists idx_businesses_status on businesses (status);

create table if not exists business_members (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null default 'member',
  created_at   timestamptz not null default now(),
  unique (business_id, user_id)
);
create index if not exists idx_member_user on business_members (user_id);

-- ── plans & subscriptions ─────────────────────────────────────────────────

create table if not exists subscription_plans (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  name                text not null,
  description         text,
  price_minor         bigint not null default 0,
  currency            text not null default 'INR',
  billing_interval    text not null default 'monthly',
  setup_fee_minor     bigint not null default 0,
  -- Limits and features are DATA. null inside limits = unlimited.
  limits              jsonb not null,
  features            jsonb not null,
  trial_days          integer not null default 14,
  is_public           boolean not null default true,
  sort_order          integer not null default 0,
  archived            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references businesses(id) on delete cascade,
  plan_id                uuid not null references subscription_plans(id),
  status                 text not null default 'trialing',
  -- A negotiated price lives HERE, never by editing the shared plan.
  negotiated_price_minor bigint,
  limits_override        jsonb,
  features_override      jsonb,
  billing_interval       text not null default 'monthly',
  trial_ends_at          timestamptz,
  current_period_start   timestamptz not null,
  current_period_end     timestamptz not null,
  grace_days             integer not null default 7,
  cancelled_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_subs_business on subscriptions (business_id);
create index if not exists idx_subs_status on subscriptions (status);

-- ── catalog ───────────────────────────────────────────────────────────────

create table if not exists three_d_models (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  name            text not null,
  glb_url         text,
  usdz_url        text,
  poster_url      text,
  file_size_bytes bigint not null default 0,
  format          text,
  triangle_count  integer,
  status          text not null default 'processing',
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists idx_models_business on three_d_models (business_id);

create table if not exists menu_categories (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  slug         text not null,
  description  text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists idx_cats_business on menu_categories (business_id, sort_order);

create table if not exists products (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id) on delete cascade,
  category_id        uuid references menu_categories(id) on delete set null,
  model_id           uuid references three_d_models(id) on delete set null,
  name               text not null,
  slug               text not null,
  description        text,
  short_description  text,
  sku                text,
  price_minor        bigint,
  compare_at_minor   bigint,
  currency           text not null default 'INR',
  image_url          text,
  thumbnail_url      text,
  -- Real-world size. Drives AR scale; null falls back to a placement default.
  dim_width          double precision,
  dim_height         double precision,
  dim_depth          double precision,
  dim_unit           text not null default 'cm',
  weight_grams       double precision,
  placement          text not null default 'tabletop',
  scale_multiplier   double precision not null default 1,
  rotation_y         double precision not null default 0,
  ar_enabled         boolean not null default true,
  cta_label          text,
  cta_url            text,
  status             text not null default 'draft',
  is_featured        boolean not null default false,
  is_bestseller      boolean not null default false,
  is_available       boolean not null default true,
  sort_order         integer not null default 0,
  tags               jsonb default '[]'::jsonb,
  allergens          jsonb default '[]'::jsonb,
  diet               text,
  materials          jsonb default '[]'::jsonb,
  colors             jsonb default '[]'::jsonb,
  sizes              jsonb default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create unique index if not exists idx_products_slug
  on products (business_id, slug) where deleted_at is null;
create index if not exists idx_products_business on products (business_id, status);
create index if not exists idx_products_category on products (category_id, sort_order);

create table if not exists product_images (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  product_id   uuid references products(id) on delete cascade,
  url          text not null,
  width        integer,
  height       integer,
  bytes        bigint not null default 0,
  mime         text,
  role         text not null default 'primary',
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pimages_product on product_images (product_id, sort_order);
create index if not exists idx_pimages_business on product_images (business_id);

create table if not exists generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  product_id      uuid references products(id) on delete cascade,
  model_id        uuid references three_d_models(id) on delete set null,
  provider        text not null default 'none',
  provider_job_id text,
  status          text not null default 'queued',
  stage           text not null default 'uploading',
  progress        integer,
  error_code      text,
  error_message   text,
  input           jsonb,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_jobs_business on generation_jobs (business_id, created_at);
create index if not exists idx_jobs_product on generation_jobs (product_id);
create index if not exists idx_jobs_status on generation_jobs (status);

create table if not exists collections (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  slug         text not null,
  description  text,
  cover_url    text,
  is_published boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create unique index if not exists idx_collections_slug
  on collections (business_id, slug) where deleted_at is null;

create table if not exists collection_products (
  collection_id uuid not null references collections(id) on delete cascade,
  product_id    uuid not null references products(id) on delete cascade,
  sort_order    integer not null default 0,
  primary key (collection_id, product_id)
);
create index if not exists idx_cprod_product on collection_products (product_id);

-- ── QR ────────────────────────────────────────────────────────────────────

create table if not exists qr_codes (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  product_id    uuid references products(id) on delete cascade,
  -- Unguessable, rotatable. The printed code points at /r/<token>, so the
  -- destination can change without reprinting anything.
  token         text not null unique,
  label         text not null default '',
  destination   text not null default 'ar',
  custom_url    text,
  campaign      text,
  is_active     boolean not null default true,
  scan_count    bigint not null default 0,
  last_scan_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists idx_qr_business on qr_codes (business_id);
create index if not exists idx_qr_product on qr_codes (product_id);

-- ── analytics ─────────────────────────────────────────────────────────────
-- Append-only, no PII. No IP, no fingerprint, no camera data — ever.

create table if not exists analytics_events (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  qr_code_id   uuid references qr_codes(id) on delete set null,
  event_type   text not null,
  -- Coarse buckets only: 'mobile' | 'Safari' | 'iOS'.
  device_type  text,
  browser      text,
  os           text,
  ar_tier      text,
  campaign     text,
  -- Random per page-load, not per person.
  session_key  text,
  created_at   timestamptz not null default now(),
  -- Denormalised YYYY-MM-DD for cheap grouping.
  day          date not null default current_date
);
create index if not exists idx_events_business_day on analytics_events (business_id, day);
create index if not exists idx_events_type on analytics_events (business_id, event_type, day);
create index if not exists idx_events_product on analytics_events (product_id, day);

-- ── billing ───────────────────────────────────────────────────────────────

create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  number          text not null unique,
  status          text not null default 'draft',
  currency        text not null default 'INR',
  subtotal_minor  bigint not null default 0,
  discount_minor  bigint not null default 0,
  tax_minor       bigint not null default 0,
  total_minor     bigint not null default 0,
  -- Denormalised sum of payments, recomputed inside a transaction. Never
  -- incremented by hand.
  paid_minor      bigint not null default 0,
  tax_name        text,
  tax_percent     double precision,
  issue_date      timestamptz not null default now(),
  due_date        timestamptz not null,
  paid_at         timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists idx_invoices_business on invoices (business_id, status);
create index if not exists idx_invoices_due on invoices (due_date, status);

create table if not exists invoice_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id) on delete cascade,
  description  text not null,
  quantity     integer not null default 1,
  unit_minor   bigint not null default 0,
  amount_minor bigint not null default 0,
  kind         text not null default 'custom',
  sort_order   integer not null default 0
);
create index if not exists idx_items_invoice on invoice_items (invoice_id, sort_order);

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  -- Payments outlive invoices for audit; never cascade-delete billing history.
  invoice_id   uuid references invoices(id) on delete set null,
  amount_minor bigint not null,
  currency     text not null default 'INR',
  method       text not null default 'cash',
  reference    text,
  proof_url    text,
  notes        text,
  paid_at      timestamptz not null default now(),
  recorded_by  uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_payments_invoice on payments (invoice_id);
create index if not exists idx_payments_business on payments (business_id, paid_at);

create table if not exists coupons (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  description        text,
  discount_type      text not null default 'percentage',
  discount_value     bigint not null default 0,
  duration           text not null default 'once',
  applicable_plans   jsonb,
  starts_at          timestamptz,
  expires_at         timestamptz,
  max_redemptions    integer,
  per_business_limit integer not null default 1,
  redemption_count   integer not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists promotions (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  discount_type    text not null default 'percentage',
  discount_value   bigint not null default 0,
  coupon_code      text,
  applicable_plans jsonb,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  banner_title     text,
  banner_message   text,
  banner_cta_label text,
  banner_cta_url   text,
  banner_color     text,
  show_banner      boolean not null default true,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── reminders & notifications ─────────────────────────────────────────────

create table if not exists reminder_rules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Negative = before due, 0 = on due, positive = after due.
  offset_days integer not null,
  subject     text not null,
  body        text not null,
  channel     text not null default 'in_app',
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  user_id     uuid references users(id) on delete cascade,
  title       text not null,
  body        text not null,
  kind        text not null default 'info',
  link_url    text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifs_business on notifications (business_id, created_at);
create index if not exists idx_notifs_user on notifications (user_id, read_at);

create table if not exists notification_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references businesses(id) on delete set null,
  invoice_id   uuid references invoices(id) on delete set null,
  rule_id      uuid references reminder_rules(id) on delete set null,
  recipient    text not null,
  channel      text not null,
  subject      text,
  content      text,
  status       text not null,
  provider     text,
  reference_id text,
  error        text,
  sent_at      timestamptz,
  failed_at    timestamptz,
  created_at   timestamptz not null default now()
);
-- Idempotency: one send per (invoice, rule). This constraint IS the guarantee —
-- a check-then-insert in application code would race.
create unique index if not exists idx_notiflog_once
  on notification_logs (invoice_id, rule_id)
  where invoice_id is not null and rule_id is not null;

-- ── CRM ───────────────────────────────────────────────────────────────────

create table if not exists crm_leads (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  business_name         text not null default '',
  business_type         text,
  phone                 text,
  email                 text,
  city                  text,
  website               text,
  instagram             text,
  source                text,
  stage                 text not null default 'new',
  expected_value_minor  bigint not null default 0,
  interested_plan_id    uuid references subscription_plans(id) on delete set null,
  assigned_to           uuid references users(id) on delete set null,
  converted_business_id uuid references businesses(id) on delete set null,
  next_follow_up_at     timestamptz,
  last_contact_at       timestamptz,
  lost_reason           text,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index if not exists idx_leads_stage on crm_leads (stage, sort_order);
create index if not exists idx_leads_followup on crm_leads (next_follow_up_at);

create table if not exists crm_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references crm_leads(id) on delete cascade,
  author_id  uuid references users(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_notes_lead on crm_notes (lead_id, created_at);

create table if not exists crm_tasks (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references crm_leads(id) on delete cascade,
  title        text not null,
  due_at       timestamptz,
  completed_at timestamptz,
  assigned_to  uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_tasks_due on crm_tasks (due_at, completed_at);

create table if not exists crm_activities (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references crm_leads(id) on delete cascade,
  actor_id   uuid references users(id) on delete set null,
  action     text not null,
  from_value text,
  to_value   text,
  created_at timestamptz not null default now()
);
create index if not exists idx_acts_lead on crm_activities (lead_id, created_at);

-- ── support ───────────────────────────────────────────────────────────────

create table if not exists support_tickets (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  opened_by   uuid references users(id) on delete set null,
  subject     text not null,
  category    text not null default 'technical',
  priority    text not null default 'normal',
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_tickets_business on support_tickets (business_id, status);

create table if not exists ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references support_tickets(id) on delete cascade,
  author_id  uuid references users(id) on delete set null,
  is_staff   boolean not null default false,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_tmsgs_ticket on ticket_messages (ticket_id, created_at);

-- ── platform ──────────────────────────────────────────────────────────────

create table if not exists system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists cms_sections (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  content    jsonb not null,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references users(id) on delete set null,
  actor_email  text,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  business_id  uuid references businesses(id) on delete set null,
  before_value jsonb,
  after_value  jsonb,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_audit_created on audit_logs (created_at);
create index if not exists idx_audit_entity on audit_logs (entity_type, entity_id);
