ALTER TABLE public.crew_members ADD COLUMN worked_together_before boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.protect_crew_past_work() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.worked_together_before) OR (TG_OP = 'UPDATE' AND NEW.worked_together_before IS DISTINCT FROM OLD.worked_together_before) THEN
    IF auth.role() IS DISTINCT FROM 'service_role' AND NEW.owner_contractor_id IS DISTINCT FROM public.get_parent_contractor_id(auth.uid()) THEN
      RAISE EXCEPTION 'Only the company can mark past work';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_crew_past_work BEFORE INSERT OR UPDATE ON public.crew_members FOR EACH ROW EXECUTE FUNCTION public.protect_crew_past_work();
CREATE OR REPLACE FUNCTION public.completed_crew_work() RETURNS TABLE(crew_member_id uuid) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH completed AS (SELECT id, awarded_bid_id, awarded_ground_bid_id, awarded_stump_bid_id FROM public.bid_requests WHERE owner_contractor_id = public.get_parent_contractor_id(auth.uid()) AND workflow_status = 'job_complete')
  SELECT DISTINCT b.crew_member_id FROM public.bids b JOIN completed j ON b.id IN (j.awarded_bid_id, j.awarded_ground_bid_id, j.awarded_stump_bid_id)
  UNION
  SELECT DISTINCT unnest(d.hired_crew_member_ids) FROM public.job_dispatches d JOIN completed j ON d.bid_request_id = j.id;
$$;
REVOKE ALL ON FUNCTION public.completed_crew_work() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.completed_crew_work() TO authenticated, service_role;