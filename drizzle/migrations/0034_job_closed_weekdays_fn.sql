CREATE OR REPLACE FUNCTION public.job_closed_weekdays(p_request_ids uuid[])
RETURNS TABLE(bid_request_id uuid, closed_weekdays smallint[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT br.id, COALESCE(cs.closed_weekdays, '{}')
  FROM public.bid_requests br
  LEFT JOIN public.company_settings cs ON cs.contractor_id = br.owner_contractor_id
  WHERE br.id = ANY(p_request_ids)
    AND (public.is_bid_request_owner(br.id) OR public.is_crew_recipient(br.id))
$$;
REVOKE ALL ON FUNCTION public.job_closed_weekdays(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_closed_weekdays(uuid[]) TO authenticated;