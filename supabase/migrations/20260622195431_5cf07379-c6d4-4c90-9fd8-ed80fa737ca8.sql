DROP POLICY IF EXISTS "Lead access: admin, owner, team, or purchaser" ON public.leads;

CREATE POLICY "Lead access: admin, owner, team, purchaser, or service-area public"
ON public.leads
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR (
    owner_contractor_id IS NOT NULL
    AND owner_contractor_id = public.get_parent_contractor_id(auth.uid())
  )
  OR (
    owner_contractor_id IS NOT NULL
    AND public.is_team_member_of(owner_contractor_id)
  )
  OR public.has_purchased_lead(id)
  OR (
    owner_contractor_id IS NULL
    AND status = 'available'
    AND public.is_contractor_in_service_area(city)
  )
);