-- Add source + ownership columns
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'treecheck',
  ADD COLUMN IF NOT EXISTS owner_contractor_id uuid;

CREATE INDEX IF NOT EXISTS idx_leads_owner_contractor_id
  ON public.leads (owner_contractor_id)
  WHERE owner_contractor_id IS NOT NULL;

-- Replace the contractor SELECT policy so owned leads are hidden from everyone but the owner.
DROP POLICY IF EXISTS "Contractors can view leads in their service areas" ON public.leads;

CREATE POLICY "Contractors can view leads in their service areas"
ON public.leads
FOR SELECT
USING (
  is_admin()
  OR (
    -- Personally-owned lead: only the owner sees it (bypasses service area)
    owner_contractor_id IS NOT NULL AND owner_contractor_id = auth.uid()
  )
  OR (
    -- Normal TreeCheck.ai lead: must be unowned + in contractor's service area
    owner_contractor_id IS NULL AND is_contractor_in_service_area(city)
  )
);