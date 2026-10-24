CREATE TABLE public.scout_rate_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contractor_id uuid NOT NULL UNIQUE,
  climber_hourly numeric NOT NULL DEFAULT 125,
  ground_crew_hourly numeric NOT NULL DEFAULT 65,
  crane_hourly numeric NOT NULL DEFAULT 350,
  crane_mobilization_fee numeric NOT NULL DEFAULT 0,
  rigging_intermediate_pct numeric NOT NULL DEFAULT 10,
  rigging_advanced_pct numeric NOT NULL DEFAULT 25,
  disposal_per_load numeric NOT NULL DEFAULT 150,
  stump_base_price numeric NOT NULL DEFAULT 250,
  stump_base_inches numeric NOT NULL DEFAULT 12,
  stump_per_inch numeric NOT NULL DEFAULT 7,
  markup_pct numeric NOT NULL DEFAULT 0,
  minimum_job_price numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scout_rate_cards TO authenticated;
GRANT ALL ON public.scout_rate_cards TO service_role;

ALTER TABLE public.scout_rate_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their own rate card"
ON public.scout_rate_cards FOR ALL TO authenticated
USING (contractor_id = auth.uid() OR public.is_admin())
WITH CHECK (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Team members can read their owner rate card"
ON public.scout_rate_cards FOR SELECT TO authenticated
USING (contractor_id = public.get_parent_contractor_id(auth.uid()));

CREATE TRIGGER scout_rate_cards_updated_at
BEFORE UPDATE ON public.scout_rate_cards
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.scout_captures
  ADD COLUMN wk_climber_required boolean,
  ADD COLUMN wk_rigging_level text,
  ADD COLUMN wk_ground_crew integer,
  ADD COLUMN wk_hours numeric,
  ADD COLUMN wk_loads numeric,
  ADD COLUMN wk_crane_required boolean,
  ADD COLUMN wk_crane_hours numeric,
  ADD COLUMN wk_stump boolean,
  ADD COLUMN wk_stump_diameter_inches numeric,
  ADD COLUMN wk_extras_amount numeric,
  ADD COLUMN wk_extras_note text,
  ADD COLUMN wk_total numeric,
  ADD COLUMN wk_breakdown jsonb,
  ADD COLUMN price_source text;