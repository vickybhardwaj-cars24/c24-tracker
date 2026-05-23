-- Migration v8: allow anonymous (unauthenticated) reads on revision_history and vendor_ratings
-- Run in Supabase Dashboard → SQL Editor → New Query

-- revision_history: drop authenticated-only select, re-add for anon + authenticated
drop policy if exists "rev_hist_select" on public.revision_history;
create policy "rev_hist_select" on public.revision_history
  for select to anon, authenticated using (true);

-- vendor_ratings: drop authenticated-only select, re-add for anon + authenticated
drop policy if exists "vr_select" on public.vendor_ratings;
create policy "vr_select" on public.vendor_ratings
  for select to anon, authenticated using (true);
