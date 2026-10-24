ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS operating_model text NOT NULL DEFAULT 'subcontractors';

CREATE TABLE public.production_labor_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL,
  role_key text NOT NULL,
  name text NOT NULL,
  loaded_hourly_cost numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, role_key)
);
CREATE TABLE public.production_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL,
  equipment_key text NOT NULL,
  name text NOT NULL,
  hourly_cost numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, equipment_key)
);
CREATE TABLE public.production_pricing (
  contractor_id uuid PRIMARY KEY,
  target_margin numeric NOT NULL DEFAULT 0.30,
  minimum_job_charge numeric,
  disposal_per_load numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.production_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL,
  capture_id uuid NOT NULL UNIQUE REFERENCES public.scout_captures(id) ON DELETE CASCADE,
  engine_version text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  original_plan jsonb NOT NULL,
  adjusted_plan jsonb,
  ballpark_min numeric,
  ballpark_max numeric,
  expected_cost numeric,
  recommended_price numeric,
  final_price numeric,
  confidence text,
  actual_crew jsonb,
  actual_hours numeric,
  actual_equipment jsonb,
  actual_cost numeric,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_labor_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_equipment TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_pricing TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.production_plans TO authenticated;
GRANT ALL ON public.production_labor_roles, public.production_equipment, public.production_pricing, public.production_plans TO service_role;

ALTER TABLE public.production_labor_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company access" ON public.production_labor_roles FOR ALL TO authenticated
  USING (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin())
  WITH CHECK (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin());
CREATE POLICY "Company access" ON public.production_equipment FOR ALL TO authenticated
  USING (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin())
  WITH CHECK (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin());
CREATE POLICY "Company access" ON public.production_pricing FOR ALL TO authenticated
  USING (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin())
  WITH CHECK (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin());
CREATE POLICY "Company access" ON public.production_plans FOR ALL TO authenticated
  USING (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin())
  WITH CHECK (contractor_id = COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) OR public.is_admin());

CREATE OR REPLACE FUNCTION public.protect_original_production_plan() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.original_plan := OLD.original_plan;
  NEW.engine_version := OLD.engine_version;
  NEW.inputs := OLD.inputs;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER production_plans_protect_original BEFORE UPDATE ON public.production_plans
  FOR EACH ROW EXECUTE FUNCTION public.protect_original_production_plan();