
-- 1) Tighten leads SELECT: only admins, owner, team of owner, or purchaser
DROP POLICY IF EXISTS "Contractors can view leads in their service areas" ON public.leads;

CREATE POLICY "Lead access: admin, owner, team, or purchaser"
ON public.leads
FOR SELECT
USING (
  is_admin()
  OR (owner_contractor_id IS NOT NULL AND owner_contractor_id = auth.uid())
  OR (owner_contractor_id IS NOT NULL AND is_team_member_of(owner_contractor_id))
  OR has_purchased_lead(id)
);

-- 2) Allow users to insert their own profile row (for signup flows / safety net)
CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());
