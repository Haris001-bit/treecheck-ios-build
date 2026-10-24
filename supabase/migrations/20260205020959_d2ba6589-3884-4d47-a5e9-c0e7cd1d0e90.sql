-- Drop the existing SECURITY DEFINER view
DROP VIEW IF EXISTS public.leads_secure;

-- Recreate the view with SECURITY INVOKER (runs with querying user's permissions)
CREATE VIEW public.leads_secure
WITH (security_invoker=on) AS
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
        WHEN (is_admin() OR has_purchased_lead(id)) THEN customer_name
        ELSE NULL::text
    END AS customer_name,
    CASE
        WHEN (is_admin() OR has_purchased_lead(id)) THEN customer_phone
        ELSE NULL::text
    END AS customer_phone,
    CASE
        WHEN (is_admin() OR has_purchased_lead(id)) THEN customer_email
        ELSE NULL::text
    END AS customer_email
FROM leads
WHERE (is_admin() OR is_contractor_in_service_area(city));

-- Grant permissions on the view
GRANT SELECT ON public.leads_secure TO authenticated;