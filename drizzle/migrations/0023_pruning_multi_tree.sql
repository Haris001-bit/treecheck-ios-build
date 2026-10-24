ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS photo_paths text[];
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS trees jsonb;
ALTER TABLE public.scout_captures ADD COLUMN IF NOT EXISTS trees jsonb;