-- 1. Drop the existing leads_secure view
DROP VIEW IF EXISTS public.leads_secure;

-- 2. Recreate the view WITHOUT security_invoker (uses definer permissions to bypass RLS)
-- This view masks PII unless the user is admin or has purchased the lead
CREATE VIEW public.leads_secure AS
SELECT 
  id,
  photo_url,
  city,
  estimated_cost_min,
  estimated_cost_max,
  status,
  purchase_count,
  created_at,
  CASE 
    WHEN public.is_admin() OR public.has_purchased_lead(id) THEN customer_name
    ELSE NULL
  END as customer_name,
  CASE 
    WHEN public.is_admin() OR public.has_purchased_lead(id) THEN customer_phone
    ELSE NULL
  END as customer_phone,
  CASE 
    WHEN public.is_admin() OR public.has_purchased_lead(id) THEN customer_email
    ELSE NULL
  END as customer_email
FROM public.leads
WHERE public.is_admin() OR public.is_contractor_in_service_area(city);

-- 3. Grant access to the view for authenticated users
GRANT SELECT ON public.leads_secure TO authenticated;

-- 4. Remove the contractor SELECT policy from leads table (contractors must use leads_secure view)
DROP POLICY IF EXISTS "Contractors can view leads in their service areas" ON public.leads;