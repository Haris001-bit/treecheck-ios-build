-- Update premium_rotation default expires_at from 90 to 30 minutes
ALTER TABLE public.premium_rotation ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 minutes');

-- Update is_past_early_access function from 90 to 30 minutes
CREATE OR REPLACE FUNCTION public.is_past_early_access(p_lead_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT p_lead_created_at + interval '30 minutes' <= now();
$$;