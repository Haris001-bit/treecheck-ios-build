CREATE TABLE public.dma_company_setup (
 contractor_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 company_name text NOT NULL DEFAULT '' CHECK (length(company_name)<=150),
 contact_name text NOT NULL DEFAULT '' CHECK (length(contact_name)<=100),
 delivery_email text NOT NULL CHECK (length(delivery_email)<=255),
 service_area text NOT NULL DEFAULT '' CHECK (length(service_area)<=200),
 website_url text NOT NULL DEFAULT '' CHECK (length(website_url)<=500),
 voice_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
 brand_voice text NOT NULL DEFAULT '' CHECK(length(brand_voice)<=12000),
 voice_preview text NOT NULL DEFAULT '' CHECK(length(voice_preview)<=2000),
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.dma_company_setup TO authenticated;
GRANT ALL ON public.dma_company_setup TO service_role;
ALTER TABLE public.dma_company_setup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company DMA setup read" ON public.dma_company_setup FOR SELECT TO authenticated USING ((contractor_id=auth.uid() OR public.is_team_member_of(contractor_id)) AND public.company_has_permission(contractor_id,'dmaManage'));
COMMENT ON TABLE public.dma_company_setup IS 'Company delivery destination and short voice survey; writes through authenticated dma-setup function, separate from login email and website publishing configuration.';