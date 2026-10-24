ALTER TABLE public.lead_closeouts
  ADD COLUMN IF NOT EXISTS jobber_client_id text,
  ADD COLUMN IF NOT EXISTS jobber_job_id text,
  ADD COLUMN IF NOT EXISTS jobber_invoice_id text,
  ADD COLUMN IF NOT EXISTS jobber_invoice_number text,
  ADD COLUMN IF NOT EXISTS jobber_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS jobber_sync_error text,
  ADD COLUMN IF NOT EXISTS jobber_synced_at timestamptz;