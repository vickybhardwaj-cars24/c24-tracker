-- Migration v2: fix site_updates FK + add unique constraint on sites.site_name
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. Add UNIQUE constraint on sites.site_name so upsert works
alter table public.sites
  add constraint if not exists sites_site_name_unique unique (site_name);

-- 2. Drop the NOT NULL + FK constraint on site_updates.site_id
--    We save updates by site_name, not UUID, so site_id must be nullable
alter table public.site_updates
  alter column site_id drop not null;

-- 3. Add site_name column to site_updates if not already there
--    (site_name is the lookup key when site_id is null)
alter table public.site_updates
  add column if not exists site_name text;

-- 4. Index for loadSupabaseUpdates query (fetches by site_name ordered by created_at)
create index if not exists idx_site_updates_name_created
  on public.site_updates(site_name, created_at asc);

-- 5. Fix RLS policy on site_updates so authenticated users can insert
drop policy if exists "site_updates_insert" on public.site_updates;
create policy "site_updates_insert" on public.site_updates
  for insert to authenticated with check (true);

drop policy if exists "site_updates_select" on public.site_updates;
create policy "site_updates_select" on public.site_updates
  for select to authenticated using (true);

-- 6. RLS for sites table: allow upsert by authenticated users
drop policy if exists "sites_insert" on public.sites;
create policy "sites_insert" on public.sites
  for insert to authenticated with check (true);

drop policy if exists "sites_upsert" on public.sites;
create policy "sites_upsert" on public.sites
  for update to authenticated using (true) with check (true);

-- Done. Now saveSiteFieldToSupabase can upsert by site_name,
-- and saveUpdateToSupabase can insert with site_id=null + site_name set.
