CREATE OR REPLACE FUNCTION public.calendar_jobs()
RETURNS TABLE(bid_request_id uuid, title text, customer_name text, customer_address text, city text, workflow_status text, day date, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (SELECT auth.uid() AS uid, get_parent_contractor_id(auth.uid()) AS owner_id),
  mine AS (SELECT cm.id FROM crew_members cm, me WHERE cm.user_id = me.uid AND cm.status = 'active'),
  owned AS (SELECT br.* FROM bid_requests br, me WHERE br.owner_contractor_id = me.owner_id),
  owner_days AS (
    SELECT id, awarded_date AS day, 'scheduled' AS kind FROM owned WHERE awarded_date IS NOT NULL
    UNION SELECT id, awarded_ground_date, 'scheduled' FROM owned WHERE awarded_ground_date IS NOT NULL
    UNION SELECT d.bid_request_id, coalesce(d.scheduled_date, d.awarded_date), 'scheduled'
      FROM job_dispatches d JOIN owned o ON o.id = d.bid_request_id WHERE coalesce(d.scheduled_date, d.awarded_date) IS NOT NULL
    UNION SELECT id, (completed_at AT TIME ZONE 'America/Chicago')::date, 'completed' FROM owned WHERE completed_at IS NOT NULL
  ),
  crew_hired AS (
    SELECT br.id, br.awarded_date AS day FROM bid_requests br JOIN bids b ON b.id IN (br.awarded_bid_id, br.awarded_stump_bid_id)
      WHERE b.crew_member_id IN (SELECT id FROM mine)
    UNION SELECT br.id, coalesce(br.awarded_ground_date, br.awarded_date) FROM bid_requests br JOIN bids b ON b.id = br.awarded_ground_bid_id
      WHERE b.crew_member_id IN (SELECT id FROM mine)
    UNION SELECT d.bid_request_id, coalesce(d.scheduled_date, d.awarded_date) FROM job_dispatches d
      WHERE d.hired_crew_member_ids && ARRAY(SELECT id FROM mine)
  ),
  crew_days AS (
    SELECT id, day, 'scheduled' AS kind FROM crew_hired WHERE day IS NOT NULL
    UNION SELECT br.id, (br.completed_at AT TIME ZONE 'America/Chicago')::date, 'completed'
      FROM bid_requests br WHERE br.completed_at IS NOT NULL AND br.id IN (SELECT id FROM crew_hired)
  ),
  all_days AS (SELECT * FROM owner_days UNION SELECT * FROM crew_days)
  SELECT br.id, br.title, br.customer_name, br.customer_address, br.city, br.workflow_status, a.day, a.kind
  FROM all_days a JOIN bid_requests br ON br.id = a.id
$$;
REVOKE ALL ON FUNCTION public.calendar_jobs() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.calendar_jobs() TO authenticated;