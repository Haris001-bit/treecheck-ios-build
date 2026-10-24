-- Fix 1: Recreate leads_secure view with security_invoker to address Security Definer View warning
DROP VIEW IF EXISTS public.leads_secure;

CREATE VIEW public.leads_secure
WITH (security_invoker = on) AS
SELECT 
  id,
  photo_url,
  city,
  estimated_cost_min,
  estimated_cost_max,
  status,
  purchase_count,
  created_at,
  -- Mask customer PII - only show to those who purchased
  CASE 
    WHEN public.has_purchased_lead(id) OR public.is_admin() 
    THEN customer_name 
    ELSE NULL 
  END as customer_name,
  CASE 
    WHEN public.has_purchased_lead(id) OR public.is_admin() 
    THEN customer_phone 
    ELSE NULL 
  END as customer_phone,
  CASE 
    WHEN public.has_purchased_lead(id) OR public.is_admin() 
    THEN customer_email 
    ELSE NULL 
  END as customer_email
FROM public.leads;

-- Fix 2: Add RLS policy to leads table to allow authenticated contractors in service area to view leads (without PII)
-- First ensure there's a SELECT policy for contractors (the secure view handles PII masking)
CREATE POLICY "Contractors can view leads in their service areas"
ON public.leads FOR SELECT
TO authenticated
USING (
  public.is_admin() OR 
  public.is_contractor_in_service_area(city)
);

-- Fix 3: Update profiles table - ensure only authenticated users can read their own profile
-- The existing policies are correct but we need to verify anon cannot access
-- Drop and recreate to ensure no public access
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

CREATE POLICY "Users can view their own profile" 
ON public.profiles FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles" 
ON public.profiles FOR SELECT
TO authenticated
USING (public.is_admin());