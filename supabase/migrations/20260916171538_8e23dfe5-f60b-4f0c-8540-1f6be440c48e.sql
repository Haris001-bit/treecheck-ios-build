ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS customer_notes text;

ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS jobber_quote_id text,
  ADD COLUMN IF NOT EXISTS jobber_quote_number text,
  ADD COLUMN IF NOT EXISTS quote_status text,
  ADD COLUMN IF NOT EXISTS hired_at timestamptz;

CREATE INDEX IF NOT EXISTS bid_requests_lead_id_idx ON public.bid_requests(lead_id);
CREATE INDEX IF NOT EXISTS bid_requests_jobber_quote_id_idx ON public.bid_requests(jobber_quote_id);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS crew_auto_broadcast boolean NOT NULL DEFAULT false;