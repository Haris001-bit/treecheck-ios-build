
-- Add job_type column
ALTER TABLE public.leads ADD COLUMN job_type text NOT NULL DEFAULT 'Tree Removal';

-- Drop and recreate the view
DROP VIEW IF EXISTS public.leads_secure;
CREATE VIEW public.leads_secure AS
SELECT
  id,
  photo_url,
  city,
  estimated_cost_min,
  estimated_cost_max,
  purchase_count,
  status,
  created_at,
  job_type,
  CASE
    WHEN has_purchased_lead(id) THEN customer_name
    ELSE NULL
  END AS customer_name,
  CASE
    WHEN has_purchased_lead(id) THEN customer_email
    ELSE NULL
  END AS customer_email,
  CASE
    WHEN has_purchased_lead(id) THEN customer_phone
    ELSE NULL
  END AS customer_phone
FROM public.leads;
