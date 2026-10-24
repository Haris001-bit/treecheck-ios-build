ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS needs_mini_skid boolean;
ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS mini_skid_hours numeric;