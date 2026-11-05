-- PL3: Core includes copy-and-paste Marketing (Mark, 2026-10-29). Same function as PL2 (0055) minus the line that
-- required a paid DMA add-on or website for dmaManage/dmaSubmit. Free and locked companies are unchanged.
-- No billing rows, Stripe or RevenueCat changes. Rollback: re-apply 0055's version.
CREATE OR REPLACE FUNCTION public.company_has_permission(p_owner uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.company_billing b WHERE b.owner_id=p_owner AND b.pricing_version='2026-10') THEN true
 WHEN public.company_plan(p_owner) = 'free' THEN (auth.uid() = p_owner AND p_permission IN ('manageJobsSubs','operationalSettings'))
 WHEN public.company_plan(p_owner) = 'locked' AND EXISTS(SELECT 1 FROM public.company_billing b WHERE b.owner_id=p_owner
      AND b.pricing_version='2026-10' AND b.status='incomplete' AND b.stripe_subscription_id IS NULL)
   THEN (auth.uid() = p_owner AND p_permission = 'operationalSettings')
 ELSE EXISTS(
 SELECT 1 FROM public.company_billing b JOIN public.profiles p ON p.id=auth.uid()
 LEFT JOIN public.team_member_access m ON m.owner_id=b.owner_id AND m.user_id=p.id AND m.status='active'
 WHERE b.owner_id=p_owner AND p.account_type='company' AND (p.id=p_owner OR p.parent_contractor_id=p_owner)
 AND (b.complimentary OR (b.status='active' AND b.current_period_end>now()) OR (b.status='trialing' AND b.trial_ends_at>now())
      OR (b.status='past_due' AND public.company_past_due_grace(b.current_period_end, b.billing_interval)))
 AND (p.id=p_owner OR ((m.member_kind='employee' OR (m.member_kind='capture' AND p_permission='dmaSubmit')) AND m.permissions->p_permission='true'::jsonb))
 AND (p_permission<>'createScout' OR b.status='trialing' OR b.complimentary OR (p.id=p_owner AND b.capacity->'ownerScout'='true'::jsonb) OR m.seat_type='scout')
 ) END;
$$;