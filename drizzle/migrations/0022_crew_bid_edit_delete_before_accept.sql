GRANT DELETE ON public.bids TO authenticated;
DROP POLICY IF EXISTS "Crew updates own bid" ON public.bids;
CREATE POLICY "Crew updates own bid" ON public.bids FOR UPDATE TO authenticated
  USING (owns_crew_member(crew_member_id) AND status = 'submitted')
  WITH CHECK (owns_crew_member(crew_member_id) AND status = 'submitted');
CREATE POLICY "Crew deletes own pending bid" ON public.bids FOR DELETE TO authenticated
  USING (owns_crew_member(crew_member_id) AND status = 'submitted');
GRANT DELETE ON public.bid_requests TO authenticated;