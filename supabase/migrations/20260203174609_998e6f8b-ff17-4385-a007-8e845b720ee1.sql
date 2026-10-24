-- Remove the INSERT policy that allowed direct purchases
-- Purchases must now go through the purchase-lead edge function with Stripe payment
DROP POLICY IF EXISTS "Contractors can purchase leads" ON public.lead_purchases;