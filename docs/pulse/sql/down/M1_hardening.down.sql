-- Rollback for M1: restores the original policy from migration 20260522135159.
drop policy if exists "Users can insert their own profile" on public.profiles;

create policy "Users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());
