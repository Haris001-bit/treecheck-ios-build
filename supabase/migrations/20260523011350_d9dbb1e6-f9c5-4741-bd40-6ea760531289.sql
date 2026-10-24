
-- 1. Add owner_id to scout_captures (the business owner who approves)
ALTER TABLE public.scout_captures
  ADD COLUMN IF NOT EXISTS owner_id uuid;

-- Backfill: existing rows are owned by their submitter (solo behavior)
UPDATE public.scout_captures
  SET owner_id = contractor_id
  WHERE owner_id IS NULL;

ALTER TABLE public.scout_captures
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS scout_captures_owner_id_idx
  ON public.scout_captures(owner_id);

-- 2. Add owner toggle on profiles for auto-approving rep submissions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS scout_auto_approve_reps boolean NOT NULL DEFAULT false;

-- 3. Rewrite RLS so owners can manage their team's captures
DROP POLICY IF EXISTS "Contractors view own captures" ON public.scout_captures;
DROP POLICY IF EXISTS "Contractors update own captures" ON public.scout_captures;
DROP POLICY IF EXISTS "Contractors delete own captures" ON public.scout_captures;
DROP POLICY IF EXISTS "Contractors insert own captures" ON public.scout_captures;

CREATE POLICY "Scout: view own or team captures"
  ON public.scout_captures FOR SELECT
  TO authenticated
  USING (
    contractor_id = auth.uid()
    OR owner_id = auth.uid()
    OR public.is_admin()
  );

CREATE POLICY "Scout: insert own captures"
  ON public.scout_captures FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = auth.uid());

-- Only the owner (or admin) can edit/approve — reps cannot self-approve when under a team
CREATE POLICY "Scout: owner updates captures"
  ON public.scout_captures FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());

-- Reps may delete their own pending captures; owners may delete any team capture
CREATE POLICY "Scout: delete own or team captures"
  ON public.scout_captures FOR DELETE
  TO authenticated
  USING (
    contractor_id = auth.uid()
    OR owner_id = auth.uid()
    OR public.is_admin()
  );
