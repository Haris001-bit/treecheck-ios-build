GRANT SELECT ON public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO service_role;

GRANT SELECT ON public.lead_purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_purchases TO service_role;