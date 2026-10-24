ALTER TABLE public.job_dispatches
  ADD COLUMN IF NOT EXISTS offered_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS awarded_date date,
  ADD COLUMN IF NOT EXISTS hired_crew_member_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS jobber_job_id text,
  ADD COLUMN IF NOT EXISTS jobber_visit_id text,
  ADD COLUMN IF NOT EXISTS jobber_status text,
  ADD COLUMN IF NOT EXISTS jobber_error text;
ALTER TABLE public.job_dispatch_responses
  ADD COLUMN IF NOT EXISTS available_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();