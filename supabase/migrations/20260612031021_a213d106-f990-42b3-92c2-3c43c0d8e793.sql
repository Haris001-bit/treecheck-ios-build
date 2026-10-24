
-- Product entitlements: shared across TreeCheck app + tradesmarketing.ai
CREATE TABLE public.product_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product text NOT NULL CHECK (product IN ('scout','dma','google_reviews','lsa','leads')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','canceled','trialing')),
  seat_count integer NOT NULL DEFAULT 1,
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_end timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, product)
);

CREATE INDEX idx_product_entitlements_contractor ON public.product_entitlements(contractor_id);
CREATE INDEX idx_product_entitlements_product_status ON public.product_entitlements(product, status);

GRANT SELECT ON public.product_entitlements TO authenticated;
GRANT ALL ON public.product_entitlements TO service_role;

ALTER TABLE public.product_entitlements ENABLE ROW LEVEL SECURITY;

-- Owners and their team members can view their account's entitlements
CREATE POLICY "View own account entitlements"
ON public.product_entitlements
FOR SELECT
TO authenticated
USING (
  contractor_id = public.get_parent_contractor_id(auth.uid())
  OR public.is_admin()
);

-- Admins can manage everything (clients otherwise can't write)
CREATE POLICY "Admins manage entitlements"
ON public.product_entitlements
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- updated_at trigger
CREATE TRIGGER update_product_entitlements_updated_at
BEFORE UPDATE ON public.product_entitlements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper: does the logged-in user (or their account owner) have an active entitlement?
CREATE OR REPLACE FUNCTION public.has_product_entitlement(p_product text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  parent uuid;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  parent := public.get_parent_contractor_id(uid);

  RETURN EXISTS (
    SELECT 1 FROM public.product_entitlements
    WHERE contractor_id = parent
      AND product = p_product
      AND status IN ('active','trialing')
      AND (current_period_end IS NULL OR current_period_end > now())
  );
END;
$$;
