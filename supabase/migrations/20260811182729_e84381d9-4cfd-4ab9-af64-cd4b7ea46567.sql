CREATE TABLE public.dma_published_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contractor_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  location text,
  service_category text,
  public_url text,
  publish_endpoint_url text,
  photo_paths text[] NOT NULL DEFAULT '{}',
  copy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'published',
  revision_count integer NOT NULL DEFAULT 0,
  last_error text,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, slug)
);

GRANT SELECT ON public.dma_published_projects TO authenticated;
GRANT ALL ON public.dma_published_projects TO service_role;

ALTER TABLE public.dma_published_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors and team can view their published projects"
ON public.dma_published_projects FOR SELECT TO authenticated
USING (
  contractor_id = public.get_parent_contractor_id(auth.uid())
  OR public.is_admin()
);

CREATE TRIGGER update_dma_published_projects_updated_at
BEFORE UPDATE ON public.dma_published_projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.dma_project_revisions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.dma_published_projects(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL,
  requested_by uuid,
  transcript text,
  voice_memo_path text,
  copy_before jsonb,
  copy_after jsonb,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dma_project_revisions TO authenticated;
GRANT ALL ON public.dma_project_revisions TO service_role;

ALTER TABLE public.dma_project_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors and team can view their project revisions"
ON public.dma_project_revisions FOR SELECT TO authenticated
USING (
  contractor_id = public.get_parent_contractor_id(auth.uid())
  OR public.is_admin()
);

CREATE TRIGGER update_dma_project_revisions_updated_at
BEFORE UPDATE ON public.dma_project_revisions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_dma_published_projects_contractor ON public.dma_published_projects(contractor_id, published_at DESC);
CREATE INDEX idx_dma_project_revisions_project ON public.dma_project_revisions(project_id, created_at DESC);