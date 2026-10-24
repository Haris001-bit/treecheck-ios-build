CREATE TABLE public.refund_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL,
  contractor_id UUID NOT NULL,
  purchase_id UUID NOT NULL,
  purchase_amount NUMERIC NOT NULL,
  reason_code TEXT NOT NULL,
  reason_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  refund_amount NUMERIC,
  lead_action TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (purchase_id)
);

CREATE INDEX idx_refund_requests_status ON public.refund_requests(status);
CREATE INDEX idx_refund_requests_contractor ON public.refund_requests(contractor_id);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors can view their own refund requests"
ON public.refund_requests FOR SELECT
USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Contractors can create refund requests for their purchases"
ON public.refund_requests FOR INSERT
WITH CHECK (
  contractor_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.lead_purchases lp
    WHERE lp.id = purchase_id
      AND lp.contractor_id = auth.uid()
      AND lp.lead_id = refund_requests.lead_id
      AND lp.purchased_at >= now() - interval '7 days'
  )
);

CREATE POLICY "Admins can manage all refund requests"
ON public.refund_requests FOR ALL
USING (is_admin());

CREATE TRIGGER update_refund_requests_updated_at
BEFORE UPDATE ON public.refund_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();