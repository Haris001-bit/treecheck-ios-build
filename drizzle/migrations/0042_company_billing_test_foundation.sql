CREATE TABLE public.company_billing (
 owner_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 pricing_version text NOT NULL DEFAULT 'legacy',
 environment text NOT NULL DEFAULT 'sandbox',
 provider text NOT NULL DEFAULT 'stripe',
 billing_interval text NOT NULL DEFAULT 'month',
 status text NOT NULL DEFAULT 'unconfigured',
 stripe_customer_id text,
 stripe_subscription_id text UNIQUE,
 trial_ends_at timestamptz,
 current_period_end timestamptz,
 complimentary boolean NOT NULL DEFAULT false,
 dma_source text NOT NULL DEFAULT 'none',
 capacity jsonb NOT NULL DEFAULT '{"scout":0,"manager":0,"field":2}',
 pending_renewal jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT company_billing_version CHECK(pricing_version IN ('legacy','2026-10')),
 CONSTRAINT company_billing_environment CHECK(environment IN ('sandbox','live')),
 CONSTRAINT company_billing_interval CHECK(billing_interval IN ('month','year'))
);
GRANT SELECT ON public.company_billing TO authenticated;
GRANT ALL ON public.company_billing TO service_role;
ALTER TABLE public.company_billing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company billing owner reads" ON public.company_billing FOR SELECT TO authenticated USING(owner_id=auth.uid());
INSERT INTO public.company_billing(owner_id, complimentary, trial_ends_at) SELECT id, coalesce(is_founder,false), trial_ends_at FROM public.profiles WHERE parent_contractor_id IS NULL AND account_type='company' ON CONFLICT DO NOTHING;
CREATE TABLE public.team_member_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
 invitation_id uuid REFERENCES public.team_invitations(id) ON DELETE CASCADE,
 email text NOT NULL,
 seat_type text,
 member_kind text NOT NULL DEFAULT 'employee',
 permissions jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'invited',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,email),
 CONSTRAINT member_seat_type CHECK(seat_type IS NULL OR seat_type IN ('scout','manager','field')),
 CONSTRAINT member_kind CHECK(member_kind IN ('employee','capture','subcontractor')),
 CONSTRAINT member_status CHECK(status IN ('invited','active','removed'))
);
GRANT SELECT ON public.team_member_access TO authenticated;
GRANT ALL ON public.team_member_access TO service_role;
ALTER TABLE public.team_member_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Member access reads" ON public.team_member_access FOR SELECT TO authenticated USING(owner_id=auth.uid() OR user_id=auth.uid());
CREATE TABLE public.company_billing_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 request_key text NOT NULL, action text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
 preview jsonb, status text NOT NULL DEFAULT 'draft', expires_at timestamptz NOT NULL DEFAULT(now()+interval '10 minutes'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,request_key)
);
GRANT SELECT ON public.company_billing_changes TO authenticated;
GRANT ALL ON public.company_billing_changes TO service_role;
ALTER TABLE public.company_billing_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads billing changes" ON public.company_billing_changes FOR SELECT TO authenticated USING(owner_id=auth.uid());
CREATE TABLE public.company_access_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.company_access_audit TO authenticated;
GRANT ALL ON public.company_access_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.company_access_audit_id_seq TO service_role;
ALTER TABLE public.company_access_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads access audit" ON public.company_access_audit FOR SELECT TO authenticated USING(owner_id=auth.uid());
CREATE TABLE public.company_billing_locks(owner_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE, token uuid NOT NULL, expires_at timestamptz NOT NULL);
GRANT ALL ON public.company_billing_locks TO service_role;
ALTER TABLE public.company_billing_locks ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.company_billing_claim(p_owner uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.company_billing_locks(owner_id,token,expires_at) VALUES(p_owner,p_token,now()+interval '2 minutes') ON CONFLICT(owner_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE company_billing_locks.expires_at<now();
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.company_billing_claim(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.company_billing_claim(uuid,uuid) TO service_role;
CREATE FUNCTION public.company_has_permission(p_owner uuid,p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.company_billing b WHERE b.owner_id=p_owner AND b.pricing_version='2026-10') THEN true ELSE EXISTS(
 SELECT 1 FROM public.company_billing b JOIN public.profiles p ON p.id=auth.uid()
 LEFT JOIN public.team_member_access m ON m.owner_id=b.owner_id AND m.user_id=p.id AND m.status='active'
 WHERE b.owner_id=p_owner AND p.account_type='company' AND (p.id=p_owner OR p.parent_contractor_id=p_owner)
 AND (b.complimentary OR (b.status IN ('active','trialing') AND (b.current_period_end>now() OR b.trial_ends_at>now())))
 AND (p.id=p_owner OR (m.member_kind='employee' AND coalesce((m.permissions->>p_permission)::boolean,false)))
 AND (p_permission<>'createScout' OR b.status='trialing' OR b.complimentary OR (p.id=p_owner AND coalesce((b.capacity->>'ownerScout')::boolean,false)) OR m.seat_type='scout')
 ) END;
$$;
REVOKE ALL ON FUNCTION public.company_has_permission(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.company_has_permission(uuid,text) TO authenticated,service_role;
CREATE POLICY "Versioned quotes permission" ON public.bid_request_quotes AS RESTRICTIVE FOR SELECT TO authenticated USING(public.company_has_permission((SELECT owner_contractor_id FROM public.bid_requests WHERE id=bid_request_id),'reviewEstimates'));
CREATE POLICY "Versioned jobs permission" ON public.bid_requests AS RESTRICTIVE FOR ALL TO authenticated USING(public.company_has_permission(owner_contractor_id,'manageJobsSubs')) WITH CHECK(public.company_has_permission(owner_contractor_id,'manageJobsSubs'));
CREATE POLICY "Versioned crew management permission" ON public.crew_members AS RESTRICTIVE FOR ALL TO authenticated USING(public.company_has_permission(owner_contractor_id,'manageJobsSubs')) WITH CHECK(public.company_has_permission(owner_contractor_id,'manageJobsSubs'));
CREATE POLICY "Versioned DMA settings permission" ON public.dma_integrations AS RESTRICTIVE FOR ALL TO authenticated USING(public.company_has_permission(contractor_id,'dmaManage')) WITH CHECK(public.company_has_permission(contractor_id,'dmaManage'));
CREATE POLICY "Versioned DMA published permission" ON public.dma_published_projects AS RESTRICTIVE FOR SELECT TO authenticated USING(public.company_has_permission(contractor_id,'dmaManage'));
CREATE POLICY "Versioned Scout create permission" ON public.scout_captures AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.company_has_permission(coalesce(owner_id,contractor_id),'createScout'));
CREATE POLICY "Versioned Scout review permission" ON public.scout_captures AS RESTRICTIVE FOR SELECT TO authenticated USING(public.company_has_permission(coalesce(owner_id,contractor_id),'reviewEstimates') OR public.company_has_permission(coalesce(owner_id,contractor_id),'createScout'));
