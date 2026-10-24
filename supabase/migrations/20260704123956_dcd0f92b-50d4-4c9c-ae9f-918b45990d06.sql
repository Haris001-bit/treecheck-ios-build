-- 1. Split dma → dma_basic + dma_web in product_entitlements
UPDATE public.product_entitlements SET product = 'dma_basic' WHERE product = 'dma';

-- 2. Add site_provider to dma_integrations
ALTER TABLE public.dma_integrations
  ADD COLUMN IF NOT EXISTS site_provider TEXT
  CHECK (site_provider IN ('first_impression', 'external') OR site_provider IS NULL);

COMMENT ON COLUMN public.dma_integrations.site_provider IS
  'Who built the contractor website. first_impression = we built it (DMA Web eligible). external = they built it. NULL = unknown.';

-- 3. Helper: is this contractor eligible for DMA Web (i.e. we host their site)?
CREATE OR REPLACE FUNCTION public.is_dma_web_eligible(p_contractor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dma_integrations
    WHERE contractor_id = p_contractor_id
      AND site_provider = 'first_impression'
  );
$$;