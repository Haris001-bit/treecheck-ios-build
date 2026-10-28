-- The owner's office team (profiles under their account) with contact details only.
-- profiles RLS lets a user read only their own row, so the Team page could never list LesLee and others.
CREATE OR REPLACE FUNCTION public.team_directory()
RETURNS TABLE(id uuid, email text, full_name text, phone text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name, p.phone, p.created_at
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.parent_contractor_id = auth.uid()
  ORDER BY p.full_name NULLS LAST, p.email;
$$;

REVOKE ALL ON FUNCTION public.team_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_directory() TO authenticated;
