DROP POLICY IF EXISTS "Contractors can create refund requests for their purchases" ON public.refund_requests;

CREATE POLICY "Contractors can create refund requests for their purchases"
ON public.refund_requests
FOR INSERT
WITH CHECK (
  contractor_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.lead_purchases lp
    WHERE lp.id = refund_requests.purchase_id
      AND lp.contractor_id = auth.uid()
      AND lp.lead_id = refund_requests.lead_id
      AND (is_admin() OR lp.purchased_at >= (now() - interval '7 days'))
  )
);