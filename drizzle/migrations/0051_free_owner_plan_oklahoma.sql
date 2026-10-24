-- Free owner plan (Oklahoma only): business location, plan level, monthly usage.
CREATE TABLE public.company_locations (
  owner_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  city text NOT NULL,
  state text NOT NULL,
  latitude double precision,
  longitude double precision,
  label text,
  free_override boolean,
  free_grace_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_locations_state CHECK (state ~ '^[A-Z]{2}$')
);
GRANT SELECT ON public.company_locations TO authenticated;
GRANT ALL ON public.company_locations TO service_role;
ALTER TABLE public.company_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company location reads" ON public.company_locations FOR SELECT TO authenticated
  USING (owner_id = public.get_parent_contractor_id(auth.uid()) OR public.is_admin());

-- Leaving an eligible state keeps Free until the end of that month (Central time).
CREATE OR REPLACE FUNCTION public.free_plan_states() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['OK']::text[] $$;

CREATE OR REPLACE FUNCTION public.company_location_grace() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.state = ANY(public.free_plan_states()) THEN
    NEW.free_grace_until := NULL;
  ELSIF TG_OP = 'UPDATE' AND OLD.state = ANY(public.free_plan_states()) THEN
    NEW.free_grace_until := (date_trunc('month', now() AT TIME ZONE 'America/Chicago') + interval '1 month') AT TIME ZONE 'America/Chicago';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER company_location_grace BEFORE INSERT OR UPDATE ON public.company_locations
  FOR EACH ROW EXECUTE FUNCTION public.company_location_grace();

CREATE OR REPLACE FUNCTION public.company_free_eligible(p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.company_locations l ON l.owner_id = p.id
    WHERE p.id = p_owner AND p.parent_contractor_id IS NULL AND coalesce(p.account_type, 'company') = 'company'
      AND CASE WHEN l.free_override IS NOT NULL THEN l.free_override
               ELSE (l.state = ANY(public.free_plan_states()) OR l.free_grace_until > now()) END
  )
$$;

-- 'paid' | 'trialing' | 'free' | 'locked' | 'none' (not a company owner).
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

-- A trial never restarts: any earlier trial date, Scout entitlement or subscription counts as used.
CREATE OR REPLACE FUNCTION public.company_trial_used(p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_owner AND (p.trial_ends_at IS NOT NULL OR p.stripe_subscription_id IS NOT NULL OR p.subscription_tier IN ('demo_trial','demo_paid','pro','premium')))
      OR EXISTS (SELECT 1 FROM public.company_billing b WHERE b.owner_id = p_owner AND (b.trial_ends_at IS NOT NULL OR b.stripe_subscription_id IS NOT NULL))
      OR EXISTS (SELECT 1 FROM public.product_entitlements e WHERE e.contractor_id = p_owner AND e.product = 'scout')
$$;

CREATE TABLE public.free_plan_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref_id uuid NOT NULL,
  month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT free_plan_usage_kind CHECK (kind IN ('job','scout_preview','dma_preview')),
  UNIQUE (owner_id, kind, ref_id)
);
CREATE INDEX free_plan_usage_month ON public.free_plan_usage (owner_id, kind, month);
GRANT SELECT ON public.free_plan_usage TO authenticated;
GRANT ALL ON public.free_plan_usage TO service_role;
ALTER TABLE public.free_plan_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Free usage owner reads" ON public.free_plan_usage FOR SELECT TO authenticated
  USING (owner_id = public.get_parent_contractor_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.free_plan_limit(p_kind text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_kind WHEN 'job' THEN 5 WHEN 'scout_preview' THEN 3 WHEN 'dma_preview' THEN 3 END
$$;

CREATE OR REPLACE FUNCTION public.free_plan_month(p_at timestamptz DEFAULT now()) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', p_at AT TIME ZONE 'America/Chicago')::date
$$;

-- Atomic claim; the same ref never counts twice; deleting the job never gives the use back.
CREATE OR REPLACE FUNCTION public.free_plan_claim(p_owner uuid, p_kind text, p_ref uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_month date := public.free_plan_month(); v_limit int := public.free_plan_limit(p_kind); v_used int;
BEGIN
  IF v_limit IS NULL OR p_owner IS NULL OR p_ref IS NULL THEN RAISE EXCEPTION 'free_plan_claim: bad input'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('free_plan_' || p_owner::text || '_' || p_kind));
  SELECT count(*) INTO v_used FROM public.free_plan_usage WHERE owner_id = p_owner AND kind = p_kind AND month = v_month;
  IF EXISTS (SELECT 1 FROM public.free_plan_usage WHERE owner_id = p_owner AND kind = p_kind AND ref_id = p_ref) THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'used', v_used, 'limit', v_limit);
  END IF;
  IF v_used >= v_limit THEN RETURN jsonb_build_object('ok', false, 'used', v_used, 'limit', v_limit); END IF;
  INSERT INTO public.free_plan_usage (owner_id, kind, ref_id, month) VALUES (p_owner, p_kind, p_ref, v_month);
  RETURN jsonb_build_object('ok', true, 'used', v_used + 1, 'limit', v_limit);
END $$;
REVOKE EXECUTE ON FUNCTION public.free_plan_claim(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_plan_claim(uuid, text, uuid) TO service_role;

-- What the signed-in company person's screens need to know.
CREATE OR REPLACE FUNCTION public.free_plan_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid := public.get_parent_contractor_id(auth.uid()); v_month date := public.free_plan_month(); l record;
BEGIN
  IF auth.uid() IS NULL OR v_owner IS NULL THEN RETURN jsonb_build_object('plan', 'none'); END IF;
  SELECT city, state, label INTO l FROM public.company_locations WHERE owner_id = v_owner;
  RETURN jsonb_build_object(
    'plan', public.company_plan(v_owner),
    'trial_used', public.company_trial_used(v_owner),
    'location_set', l.city IS NOT NULL,
    'location_label', l.label,
    'eligible', public.company_free_eligible(v_owner),
    'jobs_used', (SELECT count(*) FROM public.free_plan_usage WHERE owner_id = v_owner AND kind = 'job' AND month = v_month),
    'jobs_limit', public.free_plan_limit('job'),
    'scout_used', (SELECT count(*) FROM public.free_plan_usage WHERE owner_id = v_owner AND kind = 'scout_preview' AND month = v_month),
    'scout_limit', public.free_plan_limit('scout_preview'),
    'dma_used', (SELECT count(*) FROM public.free_plan_usage WHERE owner_id = v_owner AND kind = 'dma_preview' AND month = v_month),
    'dma_limit', public.free_plan_limit('dma_preview')
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.free_plan_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.free_plan_status() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.company_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_plan(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.company_trial_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_trial_used(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.company_free_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_free_eligible(uuid) TO service_role;

-- Versioned companies on Free: the owner keeps Jobs/Subs and settings; never Scout, DMA, Pulse or team tools.
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