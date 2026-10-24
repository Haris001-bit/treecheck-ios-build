
-- 1. Profile additions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_founder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_contractor_id uuid;

CREATE INDEX IF NOT EXISTS idx_profiles_parent_contractor_id
  ON public.profiles(parent_contractor_id);

-- 2. team_seats: tracks each company's seat subscription
CREATE TABLE IF NOT EXISTS public.team_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL UNIQUE,
  stripe_subscription_id text,
  stripe_price_id text,
  seat_quantity integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'inactive',
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_seats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view own seats"
  ON public.team_seats FOR SELECT
  USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Admins manage seats"
  ON public.team_seats FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE TRIGGER trg_team_seats_updated
  BEFORE UPDATE ON public.team_seats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. team_invitations: email-based worker invites
CREATE TABLE IF NOT EXISTS public.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_contractor_id uuid NOT NULL,
  email text NOT NULL,
  invite_token uuid NOT NULL DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_parent ON public.team_invitations(parent_contractor_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON public.team_invitations(invite_token);

ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage own invitations"
  ON public.team_invitations FOR ALL
  USING (parent_contractor_id = auth.uid() OR is_admin())
  WITH CHECK (parent_contractor_id = auth.uid() OR is_admin());

-- 4. Helper functions
CREATE OR REPLACE FUNCTION public.get_parent_contractor_id(p_user uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(parent_contractor_id, p_user)
  FROM public.profiles WHERE id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.is_team_member_of(p_parent uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND parent_contractor_id = p_parent
  );
$$;

-- 5. Update access rules so team members see parent's data

-- lead_purchases: team members see parent's purchases
DROP POLICY IF EXISTS "Contractors can view their own purchases" ON public.lead_purchases;
CREATE POLICY "Contractors can view their own purchases"
  ON public.lead_purchases FOR SELECT
  USING (
    contractor_id = auth.uid()
    OR is_admin()
    OR is_team_member_of(contractor_id)
  );

-- leads: team members see parent's owned leads + leads in parent's service areas
DROP POLICY IF EXISTS "Contractors can view leads in their service areas" ON public.leads;
CREATE POLICY "Contractors can view leads in their service areas"
  ON public.leads FOR SELECT
  USING (
    is_admin()
    OR (owner_contractor_id IS NOT NULL AND owner_contractor_id = auth.uid())
    OR (owner_contractor_id IS NOT NULL AND is_team_member_of(owner_contractor_id))
    OR (owner_contractor_id IS NULL AND is_contractor_in_service_area(city))
    OR (owner_contractor_id IS NULL AND EXISTS (
        SELECT 1 FROM public.profiles p
        JOIN public.service_areas sa ON sa.contractor_id = p.parent_contractor_id
        WHERE p.id = auth.uid() AND LOWER(sa.city) = LOWER(leads.city)
    ))
  );

-- DMA integrations: team members can view & update parent's row
DROP POLICY IF EXISTS "Contractors can view own dma integrations" ON public.dma_integrations;
CREATE POLICY "Contractors can view own dma integrations"
  ON public.dma_integrations FOR SELECT TO authenticated
  USING (contractor_id = auth.uid() OR is_admin() OR is_team_member_of(contractor_id));

DROP POLICY IF EXISTS "Contractors can update own dma integrations" ON public.dma_integrations;
CREATE POLICY "Contractors can update own dma integrations"
  ON public.dma_integrations FOR UPDATE TO authenticated
  USING (contractor_id = auth.uid() OR is_team_member_of(contractor_id));

-- DMA review templates: team members can view & update parent's
DROP POLICY IF EXISTS "Contractors can view own review template" ON public.dma_review_templates;
CREATE POLICY "Contractors can view own review template"
  ON public.dma_review_templates FOR SELECT TO authenticated
  USING (contractor_id = auth.uid() OR is_admin() OR is_team_member_of(contractor_id));

DROP POLICY IF EXISTS "Contractors can update own review template" ON public.dma_review_templates;
CREATE POLICY "Contractors can update own review template"
  ON public.dma_review_templates FOR UPDATE TO authenticated
  USING (contractor_id = auth.uid() OR is_team_member_of(contractor_id));

-- DMA subscriptions: team members can view parent's status
DROP POLICY IF EXISTS "Contractors can view own dma subscription" ON public.dma_subscriptions;
CREATE POLICY "Contractors can view own dma subscription"
  ON public.dma_subscriptions FOR SELECT TO authenticated
  USING (contractor_id = auth.uid() OR is_admin() OR is_team_member_of(contractor_id));

-- 6. Seed: mark founder + link Kostner to Mark
UPDATE public.profiles
  SET is_founder = true
  WHERE email = 'mark@tradesmarketing.ai';

UPDATE public.profiles
  SET parent_contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843'
  WHERE id = '8dd9d174-71f4-4528-a36a-e4740bfb8537';
