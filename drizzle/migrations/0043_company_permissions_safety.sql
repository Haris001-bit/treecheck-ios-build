CREATE OR REPLACE FUNCTION public.company_has_permission(p_owner uuid,p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.company_billing b WHERE b.owner_id=p_owner AND b.pricing_version='2026-10') THEN true ELSE EXISTS(
 SELECT 1 FROM public.company_billing b JOIN public.profiles p ON p.id=auth.uid()
 LEFT JOIN public.team_member_access m ON m.owner_id=b.owner_id AND m.user_id=p.id AND m.status='active'
 WHERE b.owner_id=p_owner AND p.account_type='company' AND (p.id=p_owner OR p.parent_contractor_id=p_owner)
 AND (b.complimentary OR (b.status='active' AND b.current_period_end>now()) OR (b.status='trialing' AND b.trial_ends_at>now()))
 AND (p.id=p_owner OR ((m.member_kind='employee' OR (m.member_kind='capture' AND p_permission='dmaSubmit')) AND m.permissions->p_permission='true'::jsonb))
 AND (p_permission<>'createScout' OR b.status='trialing' OR b.complimentary OR (p.id=p_owner AND b.capacity->'ownerScout'='true'::jsonb) OR m.seat_type='scout')
 AND (p_permission NOT IN ('dmaManage','dmaSubmit') OR b.status='trialing' OR b.complimentary OR b.dma_source IN ('paid','website'))
 ) END;
$$;
ALTER POLICY "Versioned jobs permission" ON public.bid_requests USING(public.company_has_permission(owner_contractor_id,'manageJobsSubs') OR public.is_crew_recipient(id)) WITH CHECK(public.company_has_permission(owner_contractor_id,'manageJobsSubs'));
ALTER POLICY "Versioned crew management permission" ON public.crew_members USING(public.company_has_permission(owner_contractor_id,'manageJobsSubs') OR user_id=auth.uid()) WITH CHECK(public.company_has_permission(owner_contractor_id,'manageJobsSubs') OR user_id=auth.uid());
CREATE POLICY "Versioned pay office permission" ON public.job_ground_hours AS RESTRICTIVE FOR ALL TO authenticated USING(public.company_has_permission(owner_contractor_id,'manageJobsSubs') OR crew_member_id IN(SELECT id FROM public.crew_members WHERE user_id=auth.uid())) WITH CHECK(public.company_has_permission(owner_contractor_id,'manageJobsSubs'));
CREATE POLICY "Versioned DMA revisions permission" ON public.dma_project_revisions AS RESTRICTIVE FOR SELECT TO authenticated USING(public.company_has_permission(contractor_id,'dmaManage'));
CREATE POLICY "Versioned settings permission" ON public.company_settings AS RESTRICTIVE FOR ALL TO authenticated USING(public.company_has_permission(contractor_id,'operationalSettings')) WITH CHECK(public.company_has_permission(contractor_id,'operationalSettings'));
