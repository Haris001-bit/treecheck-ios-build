ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'open';
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS workflow_notes text;