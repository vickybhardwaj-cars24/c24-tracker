-- Migration v10: email_log table — race-free storage for "email sent" tracking
-- Previously, the "Sent ✓" badges (SAT/UAT communication, HEM+Design emails,
-- vendor/procurement delay notices) were stored as ONE whole JSON blob per
-- tool in an R2 bucket (via the Cloudflare Worker's /mappings endpoint). Every
-- save read the whole blob, changed one key, and wrote the whole blob back —
-- so if two PMs marked different sites' emails as sent around the same time,
-- whichever save landed second silently erased the first person's entry.
-- This table stores one row per (site_name, email_type) with upsert
-- semantics, so concurrent writes from different people never collide.
-- Run in Supabase Dashboard → SQL Editor → New Query

create table if not exists public.email_log (
  id              bigint generated always as identity primary key,
  site_name       text not null,
  email_type      text not null,
  sent_at         timestamptz,
  sent_count      integer default 1,
  last_sent_date  text,
  subject         text,
  sent_by         text,
  created_at      timestamptz default now(),
  constraint email_log_site_type_unique unique (site_name, email_type)
);

alter table public.email_log enable row level security;

grant select on public.email_log to anon;

drop policy if exists "email_log_public_read" on public.email_log;
create policy "email_log_public_read" on public.email_log
  for select using (true);

drop policy if exists "email_log_auth_write" on public.email_log;
create policy "email_log_auth_write" on public.email_log
  for all to authenticated using (true) with check (true);
