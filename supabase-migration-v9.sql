-- Migration v9: uat_warning_exceptions table — dedicated table for UAT warning exemptions
-- The app code has referenced this table since v4.x, but the table itself was never
-- created in the database. Every read/write to it has been failing silently, so
-- exemptions only ever lived in each user's browser localStorage — invisible to
-- teammates, and gone the moment someone opens the tracker on a different device.
-- Run in Supabase Dashboard → SQL Editor → New Query

create table if not exists public.uat_warning_exceptions (
  id         bigint generated always as identity primary key,
  site_name  text not null unique,
  reason     text,
  logged_by  text,
  logged_at  text,
  created_at timestamptz default now()
);

alter table public.uat_warning_exceptions enable row level security;

grant select on public.uat_warning_exceptions to anon;

drop policy if exists "public read" on public.uat_warning_exceptions;
create policy "public read" on public.uat_warning_exceptions
  for select using (true);

drop policy if exists "auth write" on public.uat_warning_exceptions;
create policy "auth write" on public.uat_warning_exceptions
  for all to authenticated using (true) with check (true);
