ALTER TABLE public.dma_integrations
  ADD COLUMN IF NOT EXISTS publish_endpoint_url text,
  ADD COLUMN IF NOT EXISTS public_site_url text;