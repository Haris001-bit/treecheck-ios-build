
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS jobber_job_id text;
CREATE INDEX IF NOT EXISTS idx_leads_jobber_job_id ON public.leads(jobber_job_id) WHERE jobber_job_id IS NOT NULL;

-- Jobber-sourced leads may not have photos/estimates; relax NOT NULL for those fields.
ALTER TABLE public.leads ALTER COLUMN photo_url DROP NOT NULL;
ALTER TABLE public.leads ALTER COLUMN estimated_cost_min DROP NOT NULL;
ALTER TABLE public.leads ALTER COLUMN estimated_cost_max DROP NOT NULL;
ALTER TABLE public.leads ALTER COLUMN customer_email DROP NOT NULL;
ALTER TABLE public.leads ALTER COLUMN customer_phone DROP NOT NULL;
ALTER TABLE public.leads ALTER COLUMN city DROP NOT NULL;
