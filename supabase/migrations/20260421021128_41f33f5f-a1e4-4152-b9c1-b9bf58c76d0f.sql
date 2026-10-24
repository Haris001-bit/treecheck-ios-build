
-- DMA Subscriptions
CREATE TABLE public.dma_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL,
  stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'active',
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  canceled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.dma_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors can view own dma subscription"
  ON public.dma_subscriptions FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Contractors can insert own dma subscription"
  ON public.dma_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors can update own dma subscription"
  ON public.dma_subscriptions FOR UPDATE
  TO authenticated
  USING (contractor_id = auth.uid());

CREATE POLICY "Admins can manage all dma subscriptions"
  ON public.dma_subscriptions FOR ALL
  TO authenticated
  USING (public.is_admin());

CREATE TRIGGER update_dma_subscriptions_updated_at
  BEFORE UPDATE ON public.dma_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- DMA Integrations
CREATE TABLE public.dma_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL UNIQUE,

  -- Meta / Facebook
  facebook_page_id text,
  facebook_page_access_token text,
  facebook_page_name text,
  instagram_business_account_id text,
  instagram_handle text,

  -- Google Business Profile
  google_account_id text,
  google_location_id text,
  google_access_token text,
  google_refresh_token text,
  google_token_expires_at timestamp with time zone,
  google_review_link text,
  google_business_name text,

  -- Website
  has_first_impression boolean NOT NULL DEFAULT false,
  website_url text,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.dma_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors can view own dma integrations"
  ON public.dma_integrations FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Contractors can insert own dma integrations"
  ON public.dma_integrations FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors can update own dma integrations"
  ON public.dma_integrations FOR UPDATE
  TO authenticated
  USING (contractor_id = auth.uid());

CREATE POLICY "Admins can manage all dma integrations"
  ON public.dma_integrations FOR ALL
  TO authenticated
  USING (public.is_admin());

CREATE TRIGGER update_dma_integrations_updated_at
  BEFORE UPDATE ON public.dma_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- DMA Review Templates
CREATE TABLE public.dma_review_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL UNIQUE,
  template_text text NOT NULL DEFAULT 'Hi {customer_name}, thanks for choosing {company_name}! If we earned it, would you leave us a quick Google review? {review_link} — {contractor_first_name}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.dma_review_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors can view own review template"
  ON public.dma_review_templates FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Contractors can insert own review template"
  ON public.dma_review_templates FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors can update own review template"
  ON public.dma_review_templates FOR UPDATE
  TO authenticated
  USING (contractor_id = auth.uid());

CREATE POLICY "Admins can manage all review templates"
  ON public.dma_review_templates FOR ALL
  TO authenticated
  USING (public.is_admin());

CREATE TRIGGER update_dma_review_templates_updated_at
  BEFORE UPDATE ON public.dma_review_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
