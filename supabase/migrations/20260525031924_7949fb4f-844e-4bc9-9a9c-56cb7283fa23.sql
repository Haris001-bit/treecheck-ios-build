DROP VIEW IF EXISTS public.leads_secure;
CREATE VIEW public.leads_secure
WITH (security_invoker=on) AS
SELECT
  id,
  photo_url,
  city,
  estimated_cost_min,
  estimated_cost_max,
  purchase_count,
  created_at,
  is_sample,
  status,
  job_type,
  urgency,
  last_purchased_at,
  source,
  owner_contractor_id,
  CASE WHEN has_purchased_lead(id) THEN customer_name ELSE '—' END AS customer_name,
  CASE WHEN has_purchased_lead(id) THEN customer_phone ELSE '—' END AS customer_phone,
  CASE WHEN has_purchased_lead(id) THEN customer_email ELSE '—' END AS customer_email,
  CASE WHEN has_purchased_lead(id) THEN customer_address ELSE NULL END AS customer_address
FROM public.leads;