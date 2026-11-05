-- The First Impression switch (site_provider + publish address) decides whether Marketing publishes to a website,
-- so only TreeCheck admins (or server functions) may set it; owners editing their own row keep the old values.
CREATE OR REPLACE FUNCTION public.dma_first_impression_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'authenticated' AND NOT public.is_admin() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.site_provider := NULL;
      NEW.publish_endpoint_url := NULL;
    ELSE
      NEW.site_provider := OLD.site_provider;
      NEW.publish_endpoint_url := OLD.publish_endpoint_url;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.dma_first_impression_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS dma_first_impression_guard ON public.dma_integrations;
CREATE TRIGGER dma_first_impression_guard BEFORE INSERT OR UPDATE ON public.dma_integrations
FOR EACH ROW EXECUTE FUNCTION public.dma_first_impression_guard();