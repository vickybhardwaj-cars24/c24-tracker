-- Migration v7: site_field_overrides — reliable field-level persistence for all roles
-- Replaces the unreliable sites-table upsert approach.
-- Stores each field edit as (site_name, field_name, field_value) — all text, no type issues.
-- Unique CONSTRAINT (not just index) so Supabase onConflict upsert works correctly.
-- Run in Supabase Dashboard → SQL Editor → New Query

create table if not exists public.site_field_overrides (
  id              uuid default uuid_generate_v4() primary key,
  site_name       text not null,
  field_name      text not null,   -- CSV column name: 'SAT Date', 'Revised Completion', etc.
  field_value     text,            -- display string: '15 May 2025', 'WIP', etc.
  updated_by_name text,
  updated_at      timestamptz default now(),
  constraint sfo_site_field_unique unique (site_name, field_name)
);

alter table public.site_field_overrides enable row level security;

create policy "sfo_select" on public.site_field_overrides
  for select to authenticated using (true);

create policy "sfo_insert" on public.site_field_overrides
  for insert to authenticated with check (true);

create policy "sfo_update" on public.site_field_overrides
  for update to authenticated using (true) with check (true);
