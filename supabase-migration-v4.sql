-- Migration v4: revision_history table for Supabase-backed date change tracking
-- Run in Supabase Dashboard → SQL Editor → New Query

-- 1. Revision history table — one row per UI-triggered revised-date change
create table if not exists public.revision_history (
  id            uuid default uuid_generate_v4() primary key,
  site_name     text not null,
  changed_on    date not null default current_date,
  revised_from  text,                               -- previous Revised Completion value
  revised_to    text not null,                      -- new Revised Completion value
  reason        text,
  changed_by    uuid references public.profiles(id),
  changed_by_name text,
  created_at    timestamptz default now()
);

create index if not exists idx_rev_hist_site on public.revision_history(site_name, created_at desc);

-- 2. RLS
alter table public.revision_history enable row level security;

create policy "rev_hist_select" on public.revision_history
  for select to authenticated using (true);

create policy "rev_hist_insert" on public.revision_history
  for insert to authenticated with check (true);
