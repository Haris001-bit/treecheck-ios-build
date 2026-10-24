CREATE TABLE public.dma_email_posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 contractor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 notes text NOT NULL CHECK(length(notes) BETWEEN 1 AND 5000),
 photo_paths text[] NOT NULL DEFAULT '{}',
 title text NOT NULL DEFAULT '' CHECK(length(title)<=200),
 article text NOT NULL DEFAULT '' CHECK(length(article)<=20000),
 google_caption text NOT NULL DEFAULT '' CHECK(length(google_caption)<=5000),
 facebook_caption text NOT NULL DEFAULT '' CHECK(length(facebook_caption)<=5000),
 instagram_caption text NOT NULL DEFAULT '' CHECK(length(instagram_caption)<=5000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','queued','sent','failed')),
 delivery_email text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.dma_email_posts TO authenticated;
GRANT ALL ON public.dma_email_posts TO service_role;
ALTER TABLE public.dma_email_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company DMA content read" ON public.dma_email_posts FOR SELECT TO authenticated USING (
 public.company_has_permission(contractor_id,'dmaManage') AND (contractor_id=auth.uid() OR EXISTS(SELECT 1 FROM public.team_member_access m WHERE m.owner_id=contractor_id AND m.user_id=auth.uid() AND m.status='active' AND m.member_kind='employee' AND m.permissions->'dmaManage'='true'::jsonb))
);
ALTER POLICY "Company DMA setup read" ON public.dma_company_setup USING (
 public.company_has_permission(contractor_id,'dmaManage') AND (contractor_id=auth.uid() OR EXISTS(SELECT 1 FROM public.team_member_access m WHERE m.owner_id=contractor_id AND m.user_id=auth.uid() AND m.status='active' AND m.member_kind='employee' AND m.permissions->'dmaManage'='true'::jsonb))
);
CREATE INDEX dma_email_posts_company_created ON public.dma_email_posts(contractor_id,created_at DESC);