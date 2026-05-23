-- Migration v3: add cost_center to sites + vendor_ratings table
-- Run in Supabase Dashboard → SQL Editor → New Query

-- 1. Add cost_center column to sites
alter table public.sites
  add column if not exists cost_center text;

-- 2. Vendor Ratings table (7-criteria weighted scoring, immutable after insert)
create table if not exists public.vendor_ratings (
  id uuid default uuid_generate_v4() primary key,
  site_name text not null,
  vendor_name text not null,
  -- 7 criteria (1-5 scale)
  quality_of_work       integer check (quality_of_work between 1 and 5),
  timely_completion     integer check (timely_completion between 1 and 5),
  response_extra_tasks  integer check (response_extra_tasks between 1 and 5),
  billing_accuracy      integer check (billing_accuracy between 1 and 5),
  snag_closure          integer check (snag_closure between 1 and 5),
  communication         integer check (communication between 1 and 5),
  compliance            integer check (compliance between 1 and 5),
  -- Weighted score (auto-calculated in app)
  weighted_score        decimal(4,2),
  notes                 text,
  rated_by              text,
  rated_at              timestamptz default now(),
  is_deleted            boolean default false
);

create index if not exists idx_vendor_ratings_site on public.vendor_ratings(site_name);
create index if not exists idx_vendor_ratings_vendor on public.vendor_ratings(vendor_name);

-- RLS
alter table public.vendor_ratings enable row level security;

create policy "vr_select" on public.vendor_ratings for select to authenticated using (true);
create policy "vr_insert" on public.vendor_ratings for insert to authenticated with check (true);
-- Update only for soft-delete (is_deleted), admin only enforced in app
create policy "vr_update" on public.vendor_ratings for update to authenticated using (true);
