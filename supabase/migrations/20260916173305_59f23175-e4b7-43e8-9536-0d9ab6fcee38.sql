ALTER TABLE public.crew_members
  ADD COLUMN IF NOT EXISTS insured text,
  ADD COLUMN IF NOT EXISTS wants_ground_work boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_skid_steer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_chipper boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crane_certified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS truck_trailer_experience boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disposal_runs_ok boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS owns_saws boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_drivers_license boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tree_experience_level text,
  ADD COLUMN IF NOT EXISTS years_climbing integer;

ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS role_needed text NOT NULL DEFAULT 'climber',
  ADD COLUMN IF NOT EXISTS awarded_ground_bid_id uuid,
  ADD COLUMN IF NOT EXISTS awarded_ground_date date;

ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS bid_role text NOT NULL DEFAULT 'climber',
  ADD COLUMN IF NOT EXISTS rate_type text,
  ADD COLUMN IF NOT EXISTS people_count integer;

CREATE TABLE IF NOT EXISTS public.crew_availability (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  crew_member_id uuid NOT NULL UNIQUE REFERENCES public.crew_members(id) ON DELETE CASCADE,
  weekly_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  taking_work boolean NOT NULL DEFAULT true,
  unavailable_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  available_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_availability TO authenticated;
GRANT ALL ON public.crew_availability TO service_role;

ALTER TABLE public.crew_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Crew manage own availability"
ON public.crew_availability FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.crew_members cm WHERE cm.id = crew_availability.crew_member_id AND cm.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.crew_members cm WHERE cm.id = crew_availability.crew_member_id AND cm.user_id = auth.uid()));

CREATE POLICY "Owner manage crew availability"
ON public.crew_availability FOR ALL TO authenticated
USING (public.owns_crew_member(crew_member_id))
WITH CHECK (public.owns_crew_member(crew_member_id));

CREATE TRIGGER update_crew_availability_updated_at
BEFORE UPDATE ON public.crew_availability
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS crew_availability_crew_member_idx ON public.crew_availability(crew_member_id);
CREATE INDEX IF NOT EXISTS bids_request_role_idx ON public.bids(bid_request_id, bid_role);