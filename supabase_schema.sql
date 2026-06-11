-- ============================================================
-- C24 Expansion Tracker — Complete Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS + DO blocks
-- ============================================================


-- ── 1. PROFILES ──────────────────────────────────────────────────
-- One row per authenticated user. Role controls what they see.
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text,
  full_name     text,
  role          text NOT NULL DEFAULT 'viewer', -- 'admin' | 'pm' | 'viewer'
  created_at    timestamptz DEFAULT now()
);

-- Auto-create profile row when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'viewer')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read their own profile" ON profiles;
CREATE POLICY "Users can read their own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin'));
DROP POLICY IF EXISTS "Admins can update profiles" ON profiles;
CREATE POLICY "Admins can update profiles"
  ON profiles FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role = 'admin'));
DROP POLICY IF EXISTS "Users can upsert own profile" ON profiles;
CREATE POLICY "Users can upsert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);


-- ── 2. SITES ─────────────────────────────────────────────────────
-- One row per site — canonical reference used by foreign keys.
CREATE TABLE IF NOT EXISTS sites (
  id              bigserial PRIMARY KEY,
  site_name       text UNIQUE NOT NULL,
  bu              text,
  zone            text,
  owner           text,
  vendor          text,
  status          text,
  planned_completion date,
  cost_center     text,
  serial_no       int,
  pct_completion  int DEFAULT 0,
  drive_folder_url text,
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read sites" ON sites;
CREATE POLICY "Authenticated users can read sites"
  ON sites FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins and PMs can upsert sites" ON sites;
CREATE POLICY "Admins and PMs can upsert sites"
  ON sites FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','pm')));


-- ── 3. SITE_FIELD_OVERRIDES ───────────────────────────────────────
-- Per-site per-field overrides (Owner, Vendor, % Completion, HEM delays, etc.)
-- Used instead of editing the source CSV.
CREATE TABLE IF NOT EXISTS site_field_overrides (
  id              bigserial PRIMARY KEY,
  site_name       text NOT NULL,
  field_name      text NOT NULL,        -- e.g. 'Owner', 'Vendor', 'hem_delays'
  field_value     text,
  updated_by_name text,
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (site_name, field_name)
);

ALTER TABLE site_field_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read overrides" ON site_field_overrides;
CREATE POLICY "Authenticated users can read overrides"
  ON site_field_overrides FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can upsert overrides" ON site_field_overrides;
CREATE POLICY "Authenticated users can upsert overrides"
  ON site_field_overrides FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can update overrides" ON site_field_overrides;
CREATE POLICY "Authenticated users can update overrides"
  ON site_field_overrides FOR UPDATE USING (auth.role() = 'authenticated');


-- ── 4. SITE_UPDATES ──────────────────────────────────────────────
-- Daily update log. Each row = one update entry for one site on one date.
CREATE TABLE IF NOT EXISTS site_updates (
  id              bigserial PRIMARY KEY,
  site_id         bigint REFERENCES sites(id) ON DELETE SET NULL,
  site_name       text,
  update_date     date,
  update_text     text,                 -- format: "[DD Mon] update text"
  update_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  update_by_name  text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_updates_site_name_idx ON site_updates(site_name);
CREATE INDEX IF NOT EXISTS site_updates_date_idx ON site_updates(update_date);

ALTER TABLE site_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read updates" ON site_updates;
CREATE POLICY "Authenticated users can read updates"
  ON site_updates FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can insert updates" ON site_updates;
CREATE POLICY "Authenticated users can insert updates"
  ON site_updates FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- ── 5. AUDIT_LOG ─────────────────────────────────────────────────
-- Immutable change log for all field edits.
CREATE TABLE IF NOT EXISTS audit_log (
  id              bigserial PRIMARY KEY,
  site_name       text,
  field_name      text,
  old_value       text,
  new_value       text,
  changed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  changed_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_site_idx ON audit_log(site_name);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read audit log" ON audit_log;
CREATE POLICY "Authenticated users can read audit log"
  ON audit_log FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can insert audit log" ON audit_log;
CREATE POLICY "Authenticated users can insert audit log"
  ON audit_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- ── 6. REVISION_HISTORY ──────────────────────────────────────────
-- Per-site SAT/UAT date revision log.
CREATE TABLE IF NOT EXISTS revision_history (
  id              bigserial PRIMARY KEY,
  site_name       text NOT NULL,
  changed_on      date,                 -- date the revision was logged
  revised_from    date,
  revised_to      date NOT NULL,
  reason          text,
  changed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revision_history_site_idx ON revision_history(site_name);

ALTER TABLE revision_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read revisions" ON revision_history;
CREATE POLICY "Authenticated users can read revisions"
  ON revision_history FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can insert revisions" ON revision_history;
CREATE POLICY "Authenticated users can insert revisions"
  ON revision_history FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- ── 7. VENDOR_RATINGS ────────────────────────────────────────────
-- Weighted vendor performance scores per site.
CREATE TABLE IF NOT EXISTS vendor_ratings (
  id              bigserial PRIMARY KEY,
  site_name       text,
  vendor_name     text,
  weighted_score  numeric(5,2),
  -- individual criteria scores (stored as-is from the JS object)
  quality         int,
  timeline        int,
  communication   int,
  safety          int,
  cleanliness     int,
  notes           text,
  rated_by        text,
  is_deleted      boolean DEFAULT false,
  rated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_ratings_site_idx ON vendor_ratings(site_name);

ALTER TABLE vendor_ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read ratings" ON vendor_ratings;
CREATE POLICY "Authenticated users can read ratings"
  ON vendor_ratings FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can insert ratings" ON vendor_ratings;
CREATE POLICY "Authenticated users can insert ratings"
  ON vendor_ratings FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can update ratings" ON vendor_ratings;
CREATE POLICY "Admins can update ratings"
  ON vendor_ratings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));


-- ── 8. SITE_PHOTOS ───────────────────────────────────────────────
-- Photo metadata. Actual files stored in Cloudflare R2.
CREATE TABLE IF NOT EXISTS site_photos (
  id              bigserial PRIMARY KEY,
  site_id         bigint REFERENCES sites(id) ON DELETE SET NULL,
  site_name       text,
  photo_date      date,
  storage_path    text,                 -- R2 object key
  original_name   text,
  file_size_kb    numeric,
  width           int,
  height          int,
  caption         text DEFAULT '',
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_name text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_photos_site_idx ON site_photos(site_name);

ALTER TABLE site_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read photos" ON site_photos;
CREATE POLICY "Authenticated users can read photos"
  ON site_photos FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can insert photos" ON site_photos;
CREATE POLICY "Authenticated users can insert photos"
  ON site_photos FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can delete own photos" ON site_photos;
CREATE POLICY "Authenticated users can delete own photos"
  ON site_photos FOR DELETE USING (uploaded_by = auth.uid());


-- ── 9. MILESTONE_GATES ───────────────────────────────────────────
-- Per-site construction milestone checklist.
CREATE TABLE IF NOT EXISTS milestone_gates (
  id              bigserial PRIMARY KEY,
  site_name       text NOT NULL,
  gate_name       text NOT NULL,
  gate_order      int,
  is_done         boolean DEFAULT false,
  done_date       date,
  done_by         text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS milestone_gates_site_idx ON milestone_gates(site_name);

ALTER TABLE milestone_gates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read gates" ON milestone_gates;
CREATE POLICY "Authenticated users can read gates"
  ON milestone_gates FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can insert gates" ON milestone_gates;
CREATE POLICY "Authenticated users can insert gates"
  ON milestone_gates FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can update gates" ON milestone_gates;
CREATE POLICY "Authenticated users can update gates"
  ON milestone_gates FOR UPDATE USING (auth.role() = 'authenticated');


-- ── 10. RFIS ─────────────────────────────────────────────────────
-- Requests For Information per site.
CREATE TABLE IF NOT EXISTS rfis (
  id              bigserial PRIMARY KEY,
  site_name       text NOT NULL,
  rfi_number      text,                 -- e.g. 'RFI-001'
  subject         text,
  raised_to       text,
  priority        text DEFAULT 'High',  -- Critical / High / Medium / Low
  description     text,
  status          text DEFAULT 'Open',  -- Open / Answered / Closed / On Hold
  raised_by       text,
  raised_date     date,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rfis_site_idx ON rfis(site_name);

ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read RFIs" ON rfis;
CREATE POLICY "Authenticated users can read RFIs"
  ON rfis FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can insert RFIs" ON rfis;
CREATE POLICY "Authenticated users can insert RFIs"
  ON rfis FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can update RFIs" ON rfis;
CREATE POLICY "Authenticated users can update RFIs"
  ON rfis FOR UPDATE USING (auth.role() = 'authenticated');


-- ── 11. MATERIAL_APPROVALS ───────────────────────────────────────
-- Material approval tracking per site.
CREATE TABLE IF NOT EXISTS material_approvals (
  id              bigserial PRIMARY KEY,
  site_name       text NOT NULL,
  material_name   text,
  submitted_by    text,                 -- vendor name
  specification   text,
  status          text DEFAULT 'Pending', -- Pending / Approved / Rejected
  submitted_date  date,
  reviewed_by     text,
  review_notes    text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS material_approvals_site_idx ON material_approvals(site_name);

ALTER TABLE material_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read materials" ON material_approvals;
CREATE POLICY "Authenticated users can read materials"
  ON material_approvals FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can insert materials" ON material_approvals;
CREATE POLICY "Authenticated users can insert materials"
  ON material_approvals FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can update materials" ON material_approvals;
CREATE POLICY "Authenticated users can update materials"
  ON material_approvals FOR UPDATE USING (auth.role() = 'authenticated');


-- ============================================================
-- DONE. All 11 tables created with RLS policies.
-- After running:
--   1. Go to Authentication → Policies and verify all tables show green lock icons.
--   2. In the app Admin panel, click "☁ Sync CSV → Supabase" after uploading your CSV.
--   3. If you had HEM delays saved in the browser, click "⏳ Migrate HEM Delays".
-- ============================================================
