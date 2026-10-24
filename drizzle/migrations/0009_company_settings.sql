CREATE TABLE public.company_settings (
  contractor_id uuid PRIMARY KEY,
  sub_usage text NOT NULL DEFAULT 'rarely',
  sub_roles text[] NOT NULL DEFAULT '{}',
  in_house_roles text[] NOT NULL DEFAULT '{}',
  lead_sources text[] NOT NULL DEFAULT '{}',
  crm text NOT NULL DEFAULT 'none',
  crm_other text,
  auto_broadcast boolean NOT NULL DEFAULT false,
  ai_estimate_visibility text NOT NULL DEFAULT 'owner_office',
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.company_settings TO authenticated;
GRANT ALL ON public.company_settings TO service_role;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner manages settings" ON public.company_settings FOR ALL TO authenticated
  USING (contractor_id = auth.uid()) WITH CHECK (contractor_id = auth.uid());
CREATE POLICY "Team reads owner settings" ON public.company_settings FOR SELECT TO authenticated
  USING (contractor_id = public.get_parent_contractor_id(auth.uid()));
CREATE TRIGGER company_settings_updated BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.scout_rate_cards ADD COLUMN IF NOT EXISTS chipper_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.scout_rate_cards ADD COLUMN IF NOT EXISTS chipper_rate_type text NOT NULL DEFAULT 'day';
ALTER TABLE public.scout_captures ADD COLUMN IF NOT EXISTS wk_chipper boolean;
ALTER TABLE public.scout_captures ADD COLUMN IF NOT EXISTS wk_chipper_amount numeric;