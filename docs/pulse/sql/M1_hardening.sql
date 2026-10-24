-- M1: security hardening before Financial Pulse (H4), 2026-09-29.
-- Reference SQL. Applied through Lovable (TreeCheck project) exactly as written.
-- Safe to apply twice.
--
-- Browsers cannot create a profile as an admin, on someone else's team, or with founder
-- status, credits, a plan or feature flags already switched on. Every signup already gets its
-- profile from the handle_new_user trigger and no app code inserts profiles from the browser.
-- (Live, subscription_tier defaults to 'free', so a browser self-insert must send it as null.)
-- Server code writes profiles with the service role and is unaffected.

drop policy if exists "Users can insert their own profile" on public.profiles;

create policy "Users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and role = 'contractor'
  and parent_contractor_id is null
  and coalesce(is_founder, false) = false
  and coalesce(credit_balance, 0) = 0
  and coalesce(dma_beta_enabled, false) = false
  and coalesce(is_sandbox, false) = false
  and subscription_tier is null
  and stripe_customer_id is null
  and stripe_subscription_id is null
);
