DROP VIEW IF EXISTS public.leads_secure;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS urgency text DEFAULT 'Flexible';

CREATE VIEW public.leads_secure
WITH (security_invoker=on) AS
SELECT id,
    photo_url,
    city,
    estimated_cost_min,
    estimated_cost_max,
    purchase_count,
    status,
    created_at,
    job_type,
    is_sample,
    urgency,
    CASE
        WHEN has_purchased_lead(id) THEN customer_name
        ELSE NULL::text
    END AS customer_name,
    CASE
        WHEN has_purchased_lead(id) THEN customer_email
        ELSE NULL::text
    END AS customer_email,
    CASE
        WHEN has_purchased_lead(id) THEN customer_phone
        ELSE NULL::text
    END AS customer_phone
FROM leads;