ALTER TABLE public.bid_requests
  ADD COLUMN IF NOT EXISTS climber_dates_status text,
  ADD COLUMN IF NOT EXISTS climber_dates_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS climber_dates_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_dates jsonb NOT NULL DEFAULT '[]'::jsonb;