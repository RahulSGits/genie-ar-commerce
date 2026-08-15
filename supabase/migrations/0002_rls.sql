-- ═══════════════════════════════════════════════════════════════════════════
-- GENIE — Row Level Security
--
-- ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
--
-- Tenant isolation ALREADY holds without this file: every guard in
-- lib/auth/guards.ts re-resolves the tenant from the session, and every
-- repository read takes business_id as a required argument. RLS does not
-- replace that — it sits underneath it.
--
-- The value is the query nobody reviewed. A future `select * from products`
-- that forgets its where-clause returns nothing instead of every tenant's
-- catalog. Application-layer scoping is the primary control; this is the net
-- beneath it.
--
-- ── HOW THE CURRENT TENANT IS KNOWN ─────────────────────────────────────────
--
-- GENIE uses its own session table, not Supabase Auth, so `auth.uid()` is not
-- available. Instead the app sets three session-local variables inside the
-- transaction it is about to run:
--
--   set local app.user_id        = '<uuid>'
--   set local app.business_id    = '<uuid>'
--   set local app.is_super_admin = 'true' | 'false'
--
-- SET LOCAL is transaction-scoped, so a pooled connection cannot leak one
-- request's tenant into the next — which is the failure mode that makes
-- connection-pooled RLS dangerous if you use plain SET.
--
-- ── CRITICAL: THE APP MUST NOT CONNECT AS `postgres` ────────────────────────
--
-- Superusers and table owners bypass RLS. Connecting the app as `postgres`
-- would make every policy below decorative. This migration creates a dedicated
-- `genie_app` role with no bypass, and DATABASE_URL must use it.
-- Migrations and the seed continue to run as `postgres`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the application role ──────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'genie_app') then
    -- Password is set separately, out of version control:
    --   alter role genie_app with password '<secret>';
    create role genie_app login noinherit;
  end if;
end
$$;

grant usage on schema public to genie_app;
grant select, insert, update, delete on all tables in schema public to genie_app;
grant usage, select on all sequences in schema public to genie_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to genie_app;

-- ── context helpers ───────────────────────────────────────────────────────

create or replace function app_business_id() returns uuid
language sql stable as $$
  -- `true` = missing_ok: an unset variable yields NULL, and every policy below
  -- fails closed on NULL rather than matching everything.
  select nullif(current_setting('app.business_id', true), '')::uuid
$$;

create or replace function app_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_is_super_admin() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('app.is_super_admin', true), '')::boolean, false)
$$;

-- ── enable RLS everywhere ─────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'users','sessions','password_resets','businesses','business_members',
    'subscription_plans','subscriptions','three_d_models','menu_categories',
    'products','product_images','generation_jobs','collections',
    'collection_products','qr_codes','analytics_events','invoices',
    'invoice_items','payments','coupons','promotions','reminder_rules',
    'notifications','notification_logs','crm_leads','crm_notes','crm_tasks',
    'crm_activities','support_tickets','ticket_messages','system_settings',
    'cms_sections','audit_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end
$$;

-- ── tenant-scoped tables ──────────────────────────────────────────────────
-- One rule, applied uniformly: your own business_id, or super admin.

do $$
declare t text;
begin
  foreach t in array array[
    'businesses','business_members','subscriptions','three_d_models',
    'menu_categories','products','product_images','generation_jobs',
    'collections','qr_codes','analytics_events','invoices','payments',
    'notifications','support_tickets'
  ] loop
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($f$
      create policy tenant_isolation on %I
        for all
        using (
          app_is_super_admin()
          or %s = app_business_id()
        )
        with check (
          app_is_super_admin()
          or %s = app_business_id()
        )
    $f$, t,
      case when t = 'businesses' then 'id' else 'business_id' end,
      case when t = 'businesses' then 'id' else 'business_id' end);
  end loop;
end
$$;

-- ── child tables reached through a parent ─────────────────────────────────
-- These carry no business_id of their own, so the check walks up to the owner.

drop policy if exists tenant_isolation on invoice_items;
create policy tenant_isolation on invoice_items
  for all
  using (
    app_is_super_admin()
    or exists (
      select 1 from invoices i
       where i.id = invoice_items.invoice_id
         and i.business_id = app_business_id()
    )
  )
  with check (
    app_is_super_admin()
    or exists (
      select 1 from invoices i
       where i.id = invoice_items.invoice_id
         and i.business_id = app_business_id()
    )
  );

drop policy if exists tenant_isolation on collection_products;
create policy tenant_isolation on collection_products
  for all
  using (
    app_is_super_admin()
    or exists (
      select 1 from collections c
       where c.id = collection_products.collection_id
         and c.business_id = app_business_id()
    )
  )
  with check (
    app_is_super_admin()
    or exists (
      select 1 from collections c
       where c.id = collection_products.collection_id
         and c.business_id = app_business_id()
    )
  );

drop policy if exists tenant_isolation on ticket_messages;
create policy tenant_isolation on ticket_messages
  for all
  using (
    app_is_super_admin()
    or exists (
      select 1 from support_tickets t
       where t.id = ticket_messages.ticket_id
         and t.business_id = app_business_id()
    )
  )
  with check (
    app_is_super_admin()
    or exists (
      select 1 from support_tickets t
       where t.id = ticket_messages.ticket_id
         and t.business_id = app_business_id()
    )
  );

-- ── identity ──────────────────────────────────────────────────────────────
-- A user sees themselves. Sign-in reads by email BEFORE any context is set, so
-- that lookup runs as `postgres` in a dedicated code path.

drop policy if exists own_user on users;
create policy own_user on users
  for all
  using (app_is_super_admin() or id = app_user_id())
  with check (app_is_super_admin() or id = app_user_id());

drop policy if exists own_sessions on sessions;
create policy own_sessions on sessions
  for all
  using (app_is_super_admin() or user_id = app_user_id())
  with check (app_is_super_admin() or user_id = app_user_id());

drop policy if exists own_resets on password_resets;
create policy own_resets on password_resets
  for all
  using (app_is_super_admin() or user_id = app_user_id())
  with check (app_is_super_admin() or user_id = app_user_id());

-- ── super-admin only ──────────────────────────────────────────────────────
-- CRM, coupons, promotions, reminder rules and the audit trail are platform
-- data. A business must never see another operator's pipeline or margins.

do $$
declare t text;
begin
  foreach t in array array[
    'crm_leads','crm_notes','crm_tasks','crm_activities',
    'coupons','promotions','reminder_rules','notification_logs','audit_logs'
  ] loop
    execute format('drop policy if exists admin_only on %I', t);
    execute format($f$
      create policy admin_only on %I
        for all using (app_is_super_admin()) with check (app_is_super_admin())
    $f$, t);
  end loop;
end
$$;

-- ── platform configuration ────────────────────────────────────────────────
-- Readable by everyone (the landing page and public product pages need plans,
-- branding and CMS content), writable only by an admin.

do $$
declare t text;
begin
  foreach t in array array['subscription_plans','cms_sections','system_settings'] loop
    execute format('drop policy if exists public_read on %I', t);
    execute format('create policy public_read on %I for select using (true)', t);
    execute format('drop policy if exists admin_write on %I', t);
    execute format($f$
      create policy admin_write on %I
        for all using (app_is_super_admin()) with check (app_is_super_admin())
    $f$, t);
  end loop;
end
$$;

-- ── the public AR surface ─────────────────────────────────────────────────
-- Customers scanning a QR have no session and no tenant context. They may read
-- exactly one thing: a PUBLISHED product belonging to an ACTIVE business, plus
-- the assets needed to render it. Everything else stays invisible.

drop policy if exists public_active_business on businesses;
create policy public_active_business on businesses
  for select
  using (status = 'active' and deleted_at is null);

drop policy if exists public_published_products on products;
create policy public_published_products on products
  for select
  using (
    status = 'published'
    and deleted_at is null
    and exists (
      select 1 from businesses b
       where b.id = products.business_id
         and b.status = 'active'
         and b.deleted_at is null
    )
  );

drop policy if exists public_ready_models on three_d_models;
create policy public_ready_models on three_d_models
  for select
  using (status = 'ready' and deleted_at is null);

drop policy if exists public_published_categories on menu_categories;
create policy public_published_categories on menu_categories
  for select
  using (is_published and deleted_at is null);

-- The QR redirect must resolve a token with no session at all.
drop policy if exists public_active_qr on qr_codes;
create policy public_active_qr on qr_codes
  for select
  using (is_active and deleted_at is null);

drop policy if exists public_scan_counter on qr_codes;
create policy public_scan_counter on qr_codes
  for update
  using (is_active and deleted_at is null)
  with check (is_active and deleted_at is null);

-- Anonymous analytics ingest. Insert-only: a customer can add an event but can
-- never read anyone's analytics back out.
drop policy if exists public_event_ingest on analytics_events;
create policy public_event_ingest on analytics_events
  for insert
  with check (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- NOTE ON internal_notes
--
-- businesses.internal_notes is admin-only free text, but RLS is row-level, not
-- column-level: the public policy above exposes the whole row. It is kept out
-- of reach by the repository mapper, which never selects it for public views.
-- If that guarantee needs to be structural, move the column to its own
-- admin-only table rather than relying on the mapper.
-- ═══════════════════════════════════════════════════════════════════════════
