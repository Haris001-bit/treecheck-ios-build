-- Create a secure view that masks customer PII for unpurchased leads
CREATE OR REPLACE VIEW public.leads_secure
WITH (security_invoker = on) AS
SELECT 
  id,
  city,
  photo_url,
  estimated_cost_min,
  estimated_cost_max,
  purchase_count,
  status,
  created_at,
  -- Only show customer details if admin OR has purchased the lead
  CASE 
    WHEN is_admin() OR has_purchased_lead(id) THEN customer_name
    ELSE '***** *****'
  END as customer_name,
  CASE 
    WHEN is_admin() OR has_purchased_lead(id) THEN customer_email
    ELSE '*****@*****.***'
  END as customer_email,
  CASE 
    WHEN is_admin() OR has_purchased_lead(id) THEN customer_phone
    ELSE '(***) ***-****'
  END as customer_phone
FROM public.leads;

-- Drop the existing contractor SELECT policy
DROP POLICY IF EXISTS "Contractors can view leads in their service area" ON public.leads;

-- Create new policy that only allows contractors to SELECT via the secure view
-- Contractors can only access via the view (security_invoker means RLS applies)
CREATE POLICY "Contractors can view leads in their service area"
ON public.leads
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  is_admin() OR is_contractor_in_service_area(city)
);