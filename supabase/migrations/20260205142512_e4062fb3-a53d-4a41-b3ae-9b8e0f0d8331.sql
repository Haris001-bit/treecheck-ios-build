
-- Allow contractors to view leads in their service areas
CREATE POLICY "Contractors can view leads in their service areas"
ON public.leads
FOR SELECT
USING (
  is_admin() OR is_contractor_in_service_area(city)
);
