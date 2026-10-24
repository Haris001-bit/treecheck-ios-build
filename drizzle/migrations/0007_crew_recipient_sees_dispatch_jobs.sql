-- Ground-crew recipients were sent a job's call-out, so they may read that
-- job's basic card details (title, city). Street address and customer contact
-- stay hidden from them.
CREATE OR REPLACE FUNCTION public.is_crew_recipient(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.bid_request_recipients r
    JOIN public.crew_members c ON c.id = r.crew_member_id
    WHERE r.bid_request_id = p_request_id
      AND c.user_id = auth.uid()
      AND c.status = 'active'
  ) INTO ok;
  IF ok THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.job_dispatches d
    JOIN public.job_dispatch_recipients r ON r.dispatch_id = d.id
    JOIN public.crew_members c ON c.id = r.crew_member_id
    WHERE d.bid_request_id = p_request_id
      AND c.user_id = auth.uid()
      AND c.status = 'active'
  );
END;
$$;