-- ═══════════════════════════════════════════════════════════════════════════
-- Move businesses.internal_notes out of the businesses row.
--
-- RLS is row-level, not column-level. The public policy on `businesses` has to
-- expose the whole row so an anonymous visitor can render a product page —
-- which means admin-only notes were reachable by any query that selected *,
-- and the only thing preventing it was the repository mapper choosing not to.
--
-- A convention is not a guarantee. Moving the column to its own table makes the
-- protection structural: there is no policy on this table that a business user
-- or an anonymous visitor can satisfy.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists business_internal_notes (
  business_id uuid primary key references businesses(id) on delete cascade,
  notes       text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users(id) on delete set null
);

-- Carry across anything already written, then drop the column so no future
-- query can reach it by habit.
insert into business_internal_notes (business_id, notes)
select id, internal_notes from businesses
 where internal_notes is not null and internal_notes <> ''
on conflict (business_id) do nothing;

alter table businesses drop column if exists internal_notes;

alter table business_internal_notes enable row level security;

drop policy if exists admin_only on business_internal_notes;
create policy admin_only on business_internal_notes
  for all using (app_is_super_admin()) with check (app_is_super_admin());

grant select, insert, update, delete on business_internal_notes to genie_app;
