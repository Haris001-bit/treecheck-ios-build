
-- Log table for Jobber webhook events
CREATE TABLE public.jobber_webhook_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  topic TEXT NOT NULL,
  item_id TEXT,
  account_id TEXT,
  payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  processed BOOLEAN NOT NULL DEFAULT false,
  process_error TEXT,
  closeout_id UUID,
  lead_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
GRANT ALL ON public.jobber_webhook_events TO service_role;
ALTER TABLE public.jobber_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view jobber webhook events"
  ON public.jobber_webhook_events FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX idx_jobber_webhook_events_item_id ON public.jobber_webhook_events(item_id);
CREATE INDEX idx_jobber_webhook_events_topic ON public.jobber_webhook_events(topic);

-- Trace which Jobber client corresponds to a lead
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS jobber_client_id TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS jobber_invoice_id TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_jobber_invoice_id ON public.leads(jobber_invoice_id);
CREATE INDEX IF NOT EXISTS idx_leads_jobber_client_id ON public.leads(jobber_client_id);

-- Mark closeouts that came from Jobber vs. app
ALTER TABLE public.lead_closeouts ADD COLUMN IF NOT EXISTS source_origin TEXT NOT NULL DEFAULT 'app';
CREATE INDEX IF NOT EXISTS idx_lead_closeouts_jobber_invoice_id ON public.lead_closeouts(jobber_invoice_id);
