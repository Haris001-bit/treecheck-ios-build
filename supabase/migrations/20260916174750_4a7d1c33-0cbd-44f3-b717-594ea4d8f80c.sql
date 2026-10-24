ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS pricing_inputs jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.pricing_defaults (
  contractor_id uuid PRIMARY KEY,
  fixed_dollar numeric NOT NULL DEFAULT 300,
  fixed_percent numeric NOT NULL DEFAULT 0,
  crew_share numeric NOT NULL DEFAULT 0.40,
  estimator_dollar numeric NOT NULL DEFAULT 0,
  estimator_percent numeric NOT NULL DEFAULT 0,
  labor_rate numeric NOT NULL DEFAULT 33,
  disposal_rate numeric NOT NULL DEFAULT 80,
  owner_minimum numeric NOT NULL DEFAULT 0.30,
  owner_minimum_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_defaults TO authenticated;
GRANT ALL ON public.pricing_defaults TO service_role;

ALTER TABLE public.pricing_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their own pricing defaults"
  ON public.pricing_defaults FOR ALL TO authenticated
  USING (contractor_id = auth.uid() OR contractor_id = public.get_parent_contractor_id(auth.uid()))
  WITH CHECK (contractor_id = auth.uid() OR contractor_id = public.get_parent_contractor_id(auth.uid()));

CREATE TRIGGER update_pricing_defaults_updated_at
  BEFORE UPDATE ON public.pricing_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();