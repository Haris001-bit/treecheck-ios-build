
-- Track which premium member is next in the rotation
CREATE TABLE public.premium_rotation_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
  next_index integer NOT NULL DEFAULT 0, -- index into the sorted premium members list
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.premium_rotation_state ENABLE ROW LEVEL SECURITY;

-- Only admins can read (edge functions use service role)
CREATE POLICY "Admins can view rotation state"
  ON public.premium_rotation_state FOR SELECT
  USING (is_admin());

-- Insert the singleton row
INSERT INTO public.premium_rotation_state (id, next_index) VALUES (1, 0);

-- Add a function to check if a contractor has early access to a specific lead
-- Used by the leads_secure view to filter visibility
CREATE OR REPLACE FUNCTION public.has_early_access(p_lead_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.premium_rotation
    WHERE lead_id = p_lead_id 
    AND contractor_id = auth.uid()
    AND expires_at > now()
  );
END;
$$;

-- Add a function to check if a lead is past its early access window
CREATE OR REPLACE FUNCTION public.is_past_early_access(p_lead_created_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_lead_created_at + interval '90 minutes' <= now();
$$;

-- Update the leads_secure view to enforce 90-min delay for non-premium-rotation members
-- Premium rotation members see it immediately; everyone else waits 90 min
DROP VIEW IF EXISTS public.leads_secure;

CREATE VIEW public.leads_secure
WITH (security_invoker = on) AS
SELECT 
  id, city, photo_url, estimated_cost_min, estimated_cost_max, 
  status, purchase_count, created_at,
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
FROM public.leads
WHERE 
  public.is_admin() 
  OR (
    public.is_contractor_in_service_area(city) 
    AND (
      -- Lead is past 90-min window (visible to everyone in area)
      public.is_past_early_access(created_at)
      -- OR contractor has early access rotation slot
      OR public.has_early_access(id)
      -- OR contractor is a premium member (always sees leads, even if not in rotation)
      OR EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND subscription_tier = 'premium'
      )
    )
  );
