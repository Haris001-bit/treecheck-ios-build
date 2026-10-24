-- LSA per-contractor settings
CREATE TABLE public.lsa_settings (
  contractor_id UUID PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  callback_number TEXT,
  sms_template TEXT NOT NULL DEFAULT 'Hi {name}, thanks for reaching out! This is {company}. We got your request about {job_type}. What time works best for a quick call today?',
  office_hours_start TIME NOT NULL DEFAULT '08:00',
  office_hours_end TIME NOT NULL DEFAULT '18:00',
  after_hours_behavior TEXT NOT NULL DEFAULT 'always' CHECK (after_hours_behavior IN ('always','office_only')),
  retell_agent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lsa_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors view own lsa settings" ON public.lsa_settings
  FOR SELECT USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Contractors insert own lsa settings" ON public.lsa_settings
  FOR INSERT WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors update own lsa settings" ON public.lsa_settings
  FOR UPDATE USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Admins manage lsa settings" ON public.lsa_settings
  FOR ALL USING (is_admin());

CREATE TRIGGER lsa_settings_updated_at
  BEFORE UPDATE ON public.lsa_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- LSA leads ingested from n8n
CREATE TABLE public.lsa_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL,
  lead_type TEXT NOT NULL CHECK (lead_type IN ('call','message')),
  customer_name TEXT,
  customer_phone TEXT,
  job_type TEXT,
  message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at TIMESTAMPTZ,
  response_channel TEXT,
  outcome TEXT NOT NULL DEFAULT 'new' CHECK (outcome IN ('new','contacted','booked','follow_up','lost')),
  retell_call_id TEXT,
  notes TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lsa_leads_contractor_received_idx ON public.lsa_leads (contractor_id, received_at DESC);

ALTER TABLE public.lsa_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors view own lsa leads" ON public.lsa_leads
  FOR SELECT USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Contractors update own lsa leads" ON public.lsa_leads
  FOR UPDATE USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Admins manage lsa leads" ON public.lsa_leads
  FOR ALL USING (is_admin());

CREATE TRIGGER lsa_leads_updated_at
  BEFORE UPDATE ON public.lsa_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();