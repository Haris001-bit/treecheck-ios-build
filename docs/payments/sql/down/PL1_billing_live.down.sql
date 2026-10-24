-- Rollback of PL1 (company plans go live). Turns the plans off everywhere and puts company_plan() and
-- company_has_permission() back exactly as in 0051 (a failed renewal locks at once again). Deploy the functions from
-- before PR 1 first: create-trial-signup, company-start-trial, company-billing and billing-reminders read these
-- tables. Without them the plans read as closed and the reminders fail quietly.
CREATE OR REPLACE FUNCTION public.company_plan(p_owner uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; b record;
BEGIN
  SELECT id, account_type, parent_contractor_id, is_founder, subscription_tier, trial_ends_at INTO p FROM public.profiles WHERE id = p_owner;
  IF NOT FOUND OR p.parent_contractor_id IS NOT NULL OR coalesce(p.account_type, 'company') <> 'company' THEN RETURN 'none'; END IF;
  IF p_owner = '705cecc2-5926-48c1-a728-b3ebd6b920a2'::uuid OR coalesce(p.is_founder, false) THEN RETURN 'paid'; END IF;
  SELECT pricing_version, status, trial_ends_at, current_period_end, complimentary INTO b FROM public.company_billing WHERE owner_id = p_owner;
  IF FOUND AND b.complimentary THEN RETURN 'paid'; END IF;
  IF FOUND AND b.pricing_version = '2026-10' THEN
    IF b.status = 'active' AND b.current_period_end > now() THEN RETURN 'paid'; END IF;
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

CREATE OR REPLACE FUNCTION public.company_has_permission(p_owner uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.company_billing b WHERE b.owner_id=p_owner AND b.pricing_version='2026-10') THEN true
 WHEN public.company_plan(p_owner) = 'free' THEN (auth.uid() = p_owner AND p_permission IN ('manageJobsSubs','operationalSettings'))
 ELSE EXISTS(
 SELECT 1 FROM public.company_billing b JOIN public.profiles p ON p.id=auth.uid()
 LEFT JOIN public.team_member_access m ON m.owner_id=b.owner_id AND m.user_id=p.id AND m.status='active'
 WHERE b.owner_id=p_owner AND p.account_type='company' AND (p.id=p_owner OR p.parent_contractor_id=p_owner)
 AND (b.complimentary OR (b.status='active' AND b.current_period_end>now()) OR (b.status='trialing' AND b.trial_ends_at>now()))
 AND (p.id=p_owner OR ((m.member_kind='employee' OR (m.member_kind='capture' AND p_permission='dmaSubmit')) AND m.permissions->p_permission='true'::jsonb))
 AND (p_permission<>'createScout' OR b.status='trialing' OR b.complimentary OR (p.id=p_owner AND b.capacity->'ownerScout'='true'::jsonb) OR m.seat_type='scout')
 AND (p_permission NOT IN ('dmaManage','dmaSubmit') OR b.status='trialing' OR b.complimentary OR b.dma_source IN ('paid','website'))
 ) END;
$$;

drop function if exists public.company_past_due_grace(timestamptz, text);
drop function if exists public.billing_rollout_status();
drop table if exists public.billing_reminders;
drop table if exists public.billing_rollout;
