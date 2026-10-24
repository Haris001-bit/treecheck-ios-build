ALTER TABLE public.leads ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
UPDATE public.leads SET is_sample = true;