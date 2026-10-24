CREATE TABLE public.production_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL,
  photo_paths text[] NOT NULL DEFAULT '{}',
  owner_hints jsonb,
  ai_characteristics jsonb,
  ai_model text,
  confirmed_characteristics jsonb,
  inputs jsonb,
  engine_version text,
  predicted_plan jsonb,
  actual_method text,
  actual_crew jsonb,
  actual_duration_hours numeric,
  actual_person_hours numeric,
  actual_equipment text[],
  actual_loads numeric,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  predicted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.production_pricing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL,
  calibration_id uuid UNIQUE REFERENCES public.production_calibrations(id) ON DELETE CASCADE,
  sold_price numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_calibrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_pricing_history TO authenticated;
GRANT ALL ON public.production_calibrations, public.production_pricing_history TO service_role;

ALTER TABLE public.production_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_pricing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company access" ON public.production_calibrations FOR ALL TO authenticated
  USING (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin())
  WITH CHECK (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin());
CREATE POLICY "Company access" ON public.production_pricing_history FOR ALL TO authenticated
  USING (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin())
  WITH CHECK (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin());

CREATE OR REPLACE FUNCTION public.protect_calibration_prediction() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.ai_characteristics IS NOT NULL THEN NEW.ai_characteristics := OLD.ai_characteristics; NEW.ai_model := OLD.ai_model; END IF;
  IF OLD.predicted_plan IS NOT NULL THEN
    NEW.predicted_plan := OLD.predicted_plan;
    NEW.confirmed_characteristics := OLD.confirmed_characteristics;
    NEW.inputs := OLD.inputs;
    NEW.engine_version := OLD.engine_version;
    NEW.predicted_at := OLD.predicted_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER production_calibrations_protect BEFORE UPDATE ON public.production_calibrations
  FOR EACH ROW EXECUTE FUNCTION public.protect_calibration_prediction();