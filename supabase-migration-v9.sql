-- v9: Allow admin users to update any profile's role
-- Previously profiles_update only allowed users to update their own row (auth.uid() = id)
-- This blocked admins from changing other team members' roles via the Admin panel

drop policy if exists "profiles_update" on public.profiles;

create policy "profiles_update" on public.profiles for update to authenticated
  using (
    auth.uid() = id
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
