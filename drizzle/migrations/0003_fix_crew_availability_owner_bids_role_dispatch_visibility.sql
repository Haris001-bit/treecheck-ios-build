-- Owner-side helper: true when the caller's account owns the crew member record.
CREATE OR REPLACE FUNCTION public.owns_crew_member_as_owner(p_crew_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crew_members cm
    WHERE cm.id = p_crew_member_id
      AND cm.owner_contractor_id = public.get_parent_contractor_id(auth.uid())
  );
$$;

-- Owners can read/manage their crew's availability (previous policy checked the crew member's own account).
DROP POLICY IF EXISTS "Owner manage crew availability" ON public.crew_availability;
CREATE POLICY "Owner manage crew availability"
  ON public.crew_availability FOR ALL
  TO authenticated
  USING (public.owns_crew_member_as_owner(crew_member_id))
  WITH CHECK (public.owns_crew_member_as_owner(crew_member_id));

-- Dispatched crew can see how many spots are already claimed on a call-out they were sent.
CREATE POLICY "Recipients see dispatch claim counts"
  ON public.job_dispatch_responses FOR SELECT
  TO authenticated
  USING (public.is_job_dispatch_recipient(dispatch_id));

-- Allow one bid per (request, crew member, role) so workers who do both roles can bid twice.
ALTER TABLE public.bids DROP CONSTRAINT IF EXISTS bids_bid_request_id_crew_member_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS bids_request_member_role_key
  ON public.bids (bid_request_id, crew_member_id, bid_role);
