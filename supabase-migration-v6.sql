-- Migration v6: open RLS on sites so any authenticated user can upsert field edits
-- Also ensures unique index on site_name exists (required for onConflict upsert)
-- Safe to run even if migrations v2–v5 were already applied (all IF NOT EXISTS / drop+recreate)
-- Run in Supabase Dashboard → SQL Editor → New Query

-- 1. Unique index on sites.site_name (needed for upsert onConflict:'site_name')
create unique index if not exists idx_sites_site_name on public.sites (site_name);

-- 2. Open INSERT policy — any authenticated user can create a site row via upsert
drop policy if exists "sites_insert" on public.sites;
create policy "sites_insert" on public.sites
  for insert to authenticated with check (true);

-- 3. Open UPDATE policy — any authenticated user can update site fields
drop policy if exists "sites_update" on public.sites;
drop policy if exists "sites_upsert" on public.sites;
create policy "sites_update" on public.sites
  for update to authenticated using (true) with check (true);

-- 4. Ensure site_updates also allows update (for future use)
drop policy if exists "updates_update" on public.site_updates;
create policy "updates_update" on public.site_updates
  for update to authenticated using (true);
