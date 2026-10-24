-- Track when contractors close out a purchased lead with the final sale price
CREATE TABLE public.lead_closeouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_id UUID NOT NULL UNIQUE,
  lead_id UUID NOT NULL,
  contractor_id UUID NOT NULL,
  sale_amount NUMERIC NOT NULL,
  review_requested BOOLEAN NOT NULL DEFAULT false,
  review_requested_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_closeouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors can view own closeouts"
ON public.lead_closeouts FOR SELECT
USING ((contractor_id = auth.uid()) OR is_admin());

CREATE POLICY "Contractors can insert own closeouts"
ON public.lead_closeouts FOR INSERT
WITH CHECK (
  contractor_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.lead_purchases lp
    WHERE lp.id = purchase_id
      AND lp.contractor_id = auth.uid()
      AND lp.lead_id = lead_closeouts.lead_id
  )
);

CREATE POLICY "Contractors can update own closeouts"
ON public.lead_closeouts FOR UPDATE
USING ((contractor_id = auth.uid()) OR is_admin());

CREATE POLICY "Admins can manage closeouts"
ON public.lead_closeouts FOR ALL
USING (is_admin());

CREATE TRIGGER update_lead_closeouts_updated_at
BEFORE UPDATE ON public.lead_closeouts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_lead_closeouts_contractor ON public.lead_closeouts(contractor_id);
CREATE INDEX idx_lead_closeouts_purchase ON public.lead_closeouts(purchase_id);