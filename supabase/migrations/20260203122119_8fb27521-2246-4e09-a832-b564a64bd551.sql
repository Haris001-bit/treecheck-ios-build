-- Recreate the leads_secure view WITHOUT security_invoker
-- This makes the view execute with definer privileges, so RLS on base table doesn't apply to view queries
DROP VIEW IF EXISTS public.leads_secure;

CREATE VIEW public.leads_secure AS
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
FROM public.leads
WHERE is_admin() OR is_contractor_in_service_area(city);

-- Drop the existing contractor SELECT policy on base leads table
DROP POLICY IF EXISTS "Contractors can view leads in their service area" ON public.leads;

-- Now contractors CANNOT select from base leads table directly - only admins can
-- The leads_secure view handles contractor access with built-in masking