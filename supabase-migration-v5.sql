-- Migration v5: make site_id nullable in site_updates, snags, site_photos
-- Required because CSV sites are identified by name only (not yet synced to sites table).
-- Without this, saveUpdateToSupabase / snag inserts silently fail the NOT NULL constraint.
-- Run in Supabase Dashboard → SQL Editor → New Query

alter table public.site_updates  alter column site_id drop not null;
alter table public.snags          alter column site_id drop not null;
alter table public.site_photos    alter column site_id drop not null;
