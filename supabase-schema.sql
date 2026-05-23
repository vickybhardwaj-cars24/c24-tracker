-- CARS24 Projects Tracker — Supabase Schema
-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor → New Query)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS & ROLES
-- ─────────────────────────────────────────────────────────────────────────────

-- User profiles table (extends Supabase auth.users)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text,
  role text not null default 'pm' check (role in ('admin', 'pm', 'viewer')),
  slack_handle text,
  phone text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- SITES (main project data — replaces CSV_DATA)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.sites (
  id uuid default uuid_generate_v4() primary key,
  serial_no integer,
  site_name text not null,
  bu text,                          -- Business Unit
  zone text,
  owner text,                       -- PM name
  owner_id uuid references public.profiles(id),
  vendor text,
  vendor_rating text,
  pct_completion integer default 0,
  status text default 'WIP',        -- WIP / SAT Done / UAT Done / On Hold / etc.
  po_date date,
  kickoff_date date,
  work_start_date date,
  sat_date date,
  uat_date date,
  planned_completion date,
  revised_completion date,
  reason_for_delay text,
  drive_folder_url text,
  notes text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DAILY UPDATES (replaces date columns in CSV)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.site_updates (
  id uuid default uuid_generate_v4() primary key,
  site_id uuid references public.sites(id) on delete cascade not null,
  update_date date not null default current_date,
  update_text text not null,
  update_by uuid references public.profiles(id),
  update_by_name text,
  created_at timestamptz default now()
);

create index if not exists idx_site_updates_site_date on public.site_updates(site_id, update_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT LOG (tracks all field changes per user)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.audit_log (
  id uuid default uuid_generate_v4() primary key,
  site_id uuid references public.sites(id) on delete cascade,
  site_name text,
  field_name text not null,
  old_value text,
  new_value text,
  changed_by uuid references public.profiles(id),
  changed_by_name text,
  changed_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SNAG LIST
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.snags (
  id uuid default uuid_generate_v4() primary key,
  site_id uuid references public.sites(id) on delete cascade not null,
  site_name text not null,
  area text,
  title text not null,
  description text,
  status text default 'Pending' check (status in ('Pending', 'WIP', 'Completed', 'NA', 'Closed')),
  priority text default 'Medium' check (priority in ('Critical', 'High', 'Medium', 'Low')),
  responsible_party text,           -- Vendor / HEM / PM / Design
  reported_by text,
  open_since_days integer,
  photo_url text,
  resolved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_snags_site on public.snags(site_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- TICKETS
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.tickets (
  id uuid default uuid_generate_v4() primary key,
  ticket_ref text,                  -- External ID from processflows
  site_id uuid references public.sites(id),
  site_name text,
  title text not null,
  status text default 'Open',
  priority text default 'Medium',
  assigned_to text,
  category text,
  description text,
  created_at timestamptz default now(),
  resolved_at timestamptz,
  open_since_days integer,
  is_closed boolean default false
);

create index if not exists idx_tickets_site on public.tickets(site_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- SITE PHOTOS (compressed, date-wise)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.site_photos (
  id uuid default uuid_generate_v4() primary key,
  site_id uuid references public.sites(id) on delete cascade not null,
  site_name text not null,
  photo_date date not null default current_date,
  storage_path text not null,       -- Supabase Storage path: sites/{site_id}/{date}/{filename}
  original_name text,
  file_size_kb integer,
  width integer,
  height integer,
  caption text,
  uploaded_by uuid references public.profiles(id),
  uploaded_by_name text,
  created_at timestamptz default now()
);

create index if not exists idx_photos_site_date on public.site_photos(site_id, photo_date desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- EMAIL LOG (tracks which emails were sent, replaces emailLog in localStorage)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.email_log (
  id uuid default uuid_generate_v4() primary key,
  site_id uuid references public.sites(id),
  site_name text,
  email_type text not null,         -- sat_delay / uat_delay / snag_vendor / hem_design_sat / etc.
  sent_by uuid references public.profiles(id),
  sent_by_name text,
  sent_at timestamptz default now(),
  subject text,
  notes text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.site_updates enable row level security;
alter table public.audit_log enable row level security;
alter table public.snags enable row level security;
alter table public.tickets enable row level security;
alter table public.site_photos enable row level security;
alter table public.email_log enable row level security;

-- PROFILES: users can see all profiles, edit only their own
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update" on public.profiles for update to authenticated using (auth.uid() = id);

-- SITES: all authenticated users can read; only admin or assigned PM can update
create policy "sites_select" on public.sites for select to authenticated using (true);
create policy "sites_insert" on public.sites for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "sites_update" on public.sites for update to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or owner_id = auth.uid()
  );

-- UPDATES: anyone authenticated can insert; all can read
create policy "updates_select" on public.site_updates for select to authenticated using (true);
create policy "updates_insert" on public.site_updates for insert to authenticated with check (true);
create policy "updates_update" on public.site_updates for update to authenticated
  using (update_by = auth.uid() or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- AUDIT LOG: read-only for all; system writes only
create policy "audit_select" on public.audit_log for select to authenticated using (true);

-- SNAGS: all can read/write
create policy "snags_select" on public.snags for select to authenticated using (true);
create policy "snags_insert" on public.snags for insert to authenticated with check (true);
create policy "snags_update" on public.snags for update to authenticated using (true);

-- TICKETS: all can read/write
create policy "tickets_select" on public.tickets for select to authenticated using (true);
create policy "tickets_insert" on public.tickets for insert to authenticated with check (true);
create policy "tickets_update" on public.tickets for update to authenticated using (true);

-- PHOTOS: all can read; authenticated can upload
create policy "photos_select" on public.site_photos for select to authenticated using (true);
create policy "photos_insert" on public.site_photos for insert to authenticated with check (true);

-- EMAIL LOG: all can read/write
create policy "email_log_select" on public.email_log for select to authenticated using (true);
create policy "email_log_insert" on public.email_log for insert to authenticated with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE BUCKET for site photos
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this in Supabase Dashboard → Storage → New Bucket:
--   Name: site-photos
--   Public: false (use signed URLs)
--   File size limit: 5MB
--   Allowed types: image/jpeg, image/png, image/webp

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: Initial admin user
-- (After running schema, go to Supabase → Authentication → Invite User)
-- Then run: update public.profiles set role = 'admin' where email = 'vicky.bhardwaj@cars24.com';
-- ─────────────────────────────────────────────────────────────────────────────
