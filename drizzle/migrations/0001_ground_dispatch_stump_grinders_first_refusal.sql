-- Stump grinding + first-refusal fields on bid requests
ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS needs_stump_grinding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stump_diameter_inches numeric,
  ADD COLUMN IF NOT EXISTS ground_pay_per_worker numeric,
  ADD COLUMN IF NOT EXISTS awarded_stump_bid_id uuid,
  ADD COLUMN IF NOT EXISTS first_refusal_until timestamptz,
  ADD COLUMN IF NOT EXISTS first_refusal_released_at timestamptz;

ALTER TABLE public.crew_members
  ADD COLUMN IF NOT EXISTS first_refusal boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_refusal_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE public.pricing_defaults
  ADD COLUMN IF NOT EXISTS ground_pay_per_worker numeric NOT NULL DEFAULT 200;

-- Ground-worker call-outs on a won job
CREATE TABLE IF NOT EXISTS public.job_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  owner_contractor_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'ground',
  slots integer NOT NULL DEFAULT 1,
  pay_per_worker numeric,
  pay_rate_type text NOT NULL DEFAULT 'day',
  scheduled_date date,
  address text,
  status text NOT NULL DEFAULT 'open',
  first_refusal_until timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_dispatch_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.job_dispatches(id) ON DELETE CASCADE,
  crew_member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispatch_id, crew_member_id)
);

CREATE TABLE IF NOT EXISTS public.job_dispatch_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.job_dispatches(id) ON DELETE CASCADE,
  crew_member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  response text NOT NULL DEFAULT 'claimed',
  status text NOT NULL DEFAULT 'confirmed',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispatch_id, crew_member_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_dispatches TO authenticated;
GRANT ALL ON public.job_dispatches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_dispatch_recipients TO authenticated;
GRANT ALL ON public.job_dispatch_recipients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_dispatch_responses TO authenticated;
GRANT ALL ON public.job_dispatch_responses TO service_role;

CREATE OR REPLACE FUNCTION public.owns_job_dispatch(p_dispatch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.job_dispatches d
    WHERE d.id = p_dispatch_id
      AND d.owner_contractor_id = public.get_parent_contractor_id(auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_job_dispatch_recipient(p_dispatch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.job_dispatch_recipients r
    JOIN public.crew_members c ON c.id = r.crew_member_id
    WHERE r.dispatch_id = p_dispatch_id
      AND c.user_id = auth.uid()
      AND c.status = 'active'
  );
$$;

ALTER TABLE public.job_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_dispatch_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_dispatch_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their dispatches" ON public.job_dispatches
  FOR ALL TO authenticated
  USING (owner_contractor_id = public.get_parent_contractor_id(auth.uid()))
  WITH CHECK (owner_contractor_id = public.get_parent_contractor_id(auth.uid()));

CREATE POLICY "Crew see dispatches sent to them" ON public.job_dispatches
  FOR SELECT TO authenticated
  USING (public.is_job_dispatch_recipient(id));

CREATE POLICY "Owners manage dispatch recipients" ON public.job_dispatch_recipients
  FOR ALL TO authenticated
  USING (public.owns_job_dispatch(dispatch_id))
  WITH CHECK (public.owns_job_dispatch(dispatch_id));

CREATE POLICY "Crew see their own dispatch invite" ON public.job_dispatch_recipients
  FOR SELECT TO authenticated
  USING (public.owns_crew_member(crew_member_id));

CREATE POLICY "Owners see dispatch responses" ON public.job_dispatch_responses
  FOR SELECT TO authenticated
  USING (public.owns_job_dispatch(dispatch_id));

CREATE POLICY "Crew see their own dispatch response" ON public.job_dispatch_responses
  FOR SELECT TO authenticated
  USING (public.owns_crew_member(crew_member_id));

CREATE TRIGGER job_dispatches_updated_at
  BEFORE UPDATE ON public.job_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();