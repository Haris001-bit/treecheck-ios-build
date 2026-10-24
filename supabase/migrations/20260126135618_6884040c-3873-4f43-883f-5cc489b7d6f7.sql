-- Drop and recreate policies to use the new is_admin function
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Contractors can view their own service areas" ON public.service_areas;
DROP POLICY IF EXISTS "Admins can do everything with leads" ON public.leads;
DROP POLICY IF EXISTS "Contractors can view their own purchases" ON public.lead_purchases;
DROP POLICY IF EXISTS "Only admins can manage invitations" ON public.invitations;

-- Recreate profiles policies
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
USING (id = auth.uid() OR public.is_admin());

-- Recreate service_areas policies
CREATE POLICY "Contractors can view their own service areas"
ON public.service_areas FOR SELECT
USING (contractor_id = auth.uid() OR public.is_admin());

-- Recreate leads policies
CREATE POLICY "Admins can do everything with leads"
ON public.leads FOR ALL
USING (public.is_admin());

-- Recreate lead_purchases policies
CREATE POLICY "Contractors can view their own purchases"
ON public.lead_purchases FOR SELECT
USING (contractor_id = auth.uid() OR public.is_admin());

-- Recreate invitations policies
CREATE POLICY "Only admins can manage invitations"
ON public.invitations FOR ALL
USING (public.is_admin());