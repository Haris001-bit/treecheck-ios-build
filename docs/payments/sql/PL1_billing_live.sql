-- PL1: the company plans go live (TreeCheck App Improvements, payments milestone), 2026-10-21.
-- Reference SQL. Applied through Lovable (TreeCheck project) as the next drizzle migration (0054, after SL1's 0053),
-- exactly as written. Run checks/readback_PL1.sql after (every column true). Safe to apply twice.
-- Touches no Financial Pulse table or function. Rollback: down/PL1_billing_live.down.sql.
--
-- * billing_rollout: one row, the switch. web_live opens the company plans, the card at signup and the plan picker on
--   the website; it stays off until Haris turns it on in the SQL editor. test_owner_ids opens them for listed throwaway
--   owners first. store_sandbox_owner_ids lists who App Store and Google Play sandbox purchases may unlock. Sealed.
-- * billing_rollout_status(): what the app may show: web_live, and whether the caller is a test owner.
-- * billing_reminders: one row per trial reminder sent by billing-reminders, so none repeats. Sealed.
-- * company_past_due_grace(): a company whose renewal payment failed keeps access for 7 days from the renewal date
--   while Stripe retries. company_plan() and company_has_permission() used to drop it at once; both are redefined
--   here exactly as in 0051, with that one grace line added to each.

-- ---------------------------------------------------------------------------
-- 1. The switch (service_role only; read through billing_rollout_status)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_rollout (
  id int primary key default 1 check (id = 1),
  web_live boolean not null default false,
  test_owner_ids uuid[] not null default '{}',
  store_sandbox_owner_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.billing_rollout (id) values (1) on conflict (id) do nothing;
alter table public.billing_rollout enable row level security;
revoke all on public.billing_rollout from anon, authenticated;
grant select, insert, update on public.billing_rollout to service_role;

create or replace function public.billing_rollout_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'web_live', coalesce((select r.web_live from public.billing_rollout r where r.id = 1), false),
    'test_owner', coalesce((select auth.uid() = any(r.test_owner_ids) from public.billing_rollout r where r.id = 1), false)
  );
$$;
revoke execute on function public.billing_rollout_status() from public;
grant execute on function public.billing_rollout_status() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Trial reminders sent (service_role only)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_reminders (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (owner_id, kind)
);
alter table public.billing_reminders enable row level security;
revoke all on public.billing_reminders from anon, authenticated;
grant select, insert, delete on public.billing_reminders to service_role;

-- ---------------------------------------------------------------------------
-- 3. Seven days' grace after a failed renewal
-- ---------------------------------------------------------------------------
-- Stripe moves the period on at renewal, so the renewal date is the period end less one interval.
create or replace function public.company_past_due_grace(p_period_end timestamptz, p_interval text) returns boolean
language sql stable set search_path = public as $$
  select p_period_end is not null
     and p_period_end - (case when p_interval = 'year' then interval '1 year' else interval '1 month' end) + interval '7 days' > now();
$$;
revoke execute on function public.company_past_due_grace(timestamptz, text) from public, anon, authenticated;
grant execute on function public.company_past_due_grace(timestamptz, text) to service_role;

-- 'paid' | 'trialing' | 'free' | 'locked' | 'none' (not a company owner). As in 0051, plus the past_due grace line.
CREATE OR REPLACE FUNCTION public.company_plan(p_owner uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; b record;
BEGIN
  SELECT id, account_type, parent_contractor_id, is_founder, subscription_tier, trial_ends_at INTO p FROM public.profiles WHERE id = p_owner;
  IF NOT FOUND OR p.parent_contractor_id IS NOT NULL OR coalesce(p.account_type, 'company') <> 'company' THEN RETURN 'none'; END IF;
  IF p_owner = '705cecc2-5926-48c1-a728-b3ebd6b920a2'::uuid OR coalesce(p.is_founder, false) THEN RETURN 'paid'; END IF;
  SELECT pricing_version, status, trial_ends_at, current_period_end, complimentary, billing_interval INTO b FROM public.company_billing WHERE owner_id = p_owner;
  IF FOUND AND b.complimentary THEN RETURN 'paid'; END IF;
  IF FOUND AND b.pricing_version = '2026-10' THEN
    IF b.status = 'active' AND b.current_period_end > now() THEN RETURN 'paid'; END IF;
    IF b.status = 'past_due' AND public.company_past_due_grace(b.current_period_end, b.billing_interval) THEN RETURN 'paid'; END IF;
    IF b.status = 'trialing' AND b.trial_ends_at > now() THEN RETURN 'trialing'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.product_entitlements e WHERE e.contractor_id = p_owner AND e.product = 'scout'
               AND e.status = 'active' AND (e.current_period_end IS NULL OR e.current_period_end > now())) THEN RETURN 'paid'; END IF;
    IF EXISTS (SELECT 1 FROM public.product_entitlements e WHERE e.contractor_id = p_owner AND e.product = 'scout'
               AND e.status = 'trialing' AND (e.current_period_end IS NULL OR e.current_period_end > now())) THEN RETURN 'trialing'; END IF;
    IF p.subscription_tier = 'demo_trial' AND (p.trial_ends_at IS NULL OR p.trial_ends_at > now()) THEN RETURN 'trialing'; END IF;
  END IF;
  IF public.company_free_eligible(p_owner) THEN RETURN 'free'; END IF;
  RETURN 'locked';
END $$;
REVOKE EXECUTE ON FUNCTION public.company_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_plan(uuid) TO service_role;

-- Versioned companies on Free: the owner keeps Jobs/Subs and settings; never Scout, DMA, Pulse or team tools.
-- As in 0051, plus the past_due grace in the access line.
CREATE OR REPLACE FUNCTION public.company_has_permission(p_owner uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.company_billing b WHERE b.owner_id=p_owner AND b.pricing_version='2026-10') THEN true
 WHEN public.company_plan(p_owner) = 'free' THEN (auth.uid() = p_owner AND p_permission IN ('manageJobsSubs','operationalSettings'))
 ELSE EXISTS(
 SELECT 1 FROM public.company_billing b JOIN public.profiles p ON p.id=auth.uid()
 LEFT JOIN public.team_member_access m ON m.owner_id=b.owner_id AND m.user_id=p.id AND m.status='active'
 WHERE b.owner_id=p_owner AND p.account_type='company' AND (p.id=p_owner OR p.parent_contractor_id=p_owner)
 AND (b.complimentary OR (b.status='active' AND b.current_period_end>now()) OR (b.status='trialing' AND b.trial_ends_at>now())
      OR (b.status='past_due' AND public.company_past_due_grace(b.current_period_end, b.billing_interval)))
 AND (p.id=p_owner OR ((m.member_kind='employee' OR (m.member_kind='capture' AND p_permission='dmaSubmit')) AND m.permissions->p_permission='true'::jsonb))
 AND (p_permission<>'createScout' OR b.status='trialing' OR b.complimentary OR (p.id=p_owner AND b.capacity->'ownerScout'='true'::jsonb) OR m.seat_type='scout')
 AND (p_permission NOT IN ('dmaManage','dmaSubmit') OR b.status='trialing' OR b.complimentary OR b.dma_source IN ('paid','website'))
 ) END;
$$;
