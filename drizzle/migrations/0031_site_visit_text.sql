ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS visit_calendly_url text,
  ADD COLUMN IF NOT EXISTS visit_callback_phone text,
  ADD COLUMN IF NOT EXISTS visit_signature text;
ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS visit_text_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS visit_text_estimate_view text,
  ADD COLUMN IF NOT EXISTS visit_text_body text,
  ADD COLUMN IF NOT EXISTS needs_site_visit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS site_visit_done_at timestamptz;