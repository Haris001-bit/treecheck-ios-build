
-- =========================================================================
-- 1. Add payment source tracking columns to credit_transactions
-- =========================================================================
ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS source_platform text DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS purchase_origin text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_stripe_event_id_key
  ON public.credit_transactions (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- =========================================================================
-- 2. Protect sensitive profile/payment fields from client writes
--    (Only service_role and admins may change these — Stripe webhooks etc.)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.protect_profile_payment_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_service boolean := (current_setting('request.jwt.claim.role', true) = 'service_role')
                       OR (auth.role() = 'service_role');
BEGIN
  IF is_service OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_tier        IS DISTINCT FROM OLD.subscription_tier
  OR NEW.subscription_ends_at     IS DISTINCT FROM OLD.subscription_ends_at
  OR NEW.stripe_customer_id       IS DISTINCT FROM OLD.stripe_customer_id
  OR NEW.stripe_subscription_id   IS DISTINCT FROM OLD.stripe_subscription_id
  OR NEW.credit_balance           IS DISTINCT FROM OLD.credit_balance
  OR NEW.trial_ends_at            IS DISTINCT FROM OLD.trial_ends_at
  OR NEW.discount_next_lead       IS DISTINCT FROM OLD.discount_next_lead
  OR NEW.is_founder               IS DISTINCT FROM OLD.is_founder
  OR NEW.role                     IS DISTINCT FROM OLD.role
  OR NEW.parent_contractor_id     IS DISTINCT FROM OLD.parent_contractor_id THEN
    RAISE EXCEPTION 'Payment/entitlement fields cannot be modified by client. Use backend.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_payment_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_payment_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_payment_fields();

-- =========================================================================
-- 3. Mobile entitlement RPC — read-only, uses auth.uid()
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_mobile_contractor_entitlements()
RETURNS TABLE (
  contractor_id uuid,
  account_owner_id uuid,
  role text,
  mobile_access_enabled boolean,
  account_status text,
  can_view_assigned_leads boolean,
  can_view_unlocked_leads boolean,
  can_use_scout boolean,
  can_use_dma boolean,
  can_use_lsa boolean,
  can_use_marketing_package boolean,
  premium_active boolean,
  subscription_status text,
  subscription_current_period_end timestamptz,
  ios_app_store_safe_mode boolean,
  last_entitlement_sync_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS contractor_id,
    public.get_parent_contractor_id(p.id) AS account_owner_id,
    p.role,
    COALESCE(p.is_active, true) AS mobile_access_enabled,
    CASE
      WHEN COALESCE(p.is_active, true) = false THEN 'disabled'
      WHEN p.subscription_tier IN ('pro','premium') THEN 'premium'
      WHEN p.trial_ends_at IS NOT NULL AND p.trial_ends_at > now() THEN 'trialing'
      ELSE 'active'
    END::text AS account_status,
    true AS can_view_assigned_leads,
    true AS can_view_unlocked_leads,
    true AS can_use_scout,
    COALESCE(p.dma_beta_enabled, false)
      OR EXISTS (SELECT 1 FROM public.dma_subscriptions s
                 WHERE s.contractor_id = p.id AND s.status = 'active') AS can_use_dma,
    EXISTS (SELECT 1 FROM public.lsa_settings ls
            WHERE ls.contractor_id = p.id AND ls.enabled = true) AS can_use_lsa,
    EXISTS (SELECT 1 FROM public.marketing_profiles mp
            WHERE mp.contractor_id = p.id AND mp.is_active = true) AS can_use_marketing_package,
    (p.subscription_tier IN ('pro','premium')
       AND (p.subscription_ends_at IS NULL OR p.subscription_ends_at > now())) AS premium_active,
    COALESCE(p.subscription_tier, 'free')::text AS subscription_status,
    p.subscription_ends_at AS subscription_current_period_end,
    true AS ios_app_store_safe_mode,
    now() AS last_entitlement_sync_at
  FROM public.profiles p
  WHERE p.id = uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_mobile_contractor_entitlements() TO authenticated;

-- =========================================================================
-- 4. Mobile accessible leads RPC — read-only, no pricing fields
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_mobile_accessible_leads()
RETURNS TABLE (
  lead_id uuid,
  created_at timestamptz,
  source text,
  job_type text,
  city text,
  status text,
  urgency text,
  customer_name text,
  customer_phone text,
  customer_address text,
  photo_url text,
  estimate_range text,
  contractor_lead_status text,
  unlocked_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  parent uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  parent := public.get_parent_contractor_id(uid);

  RETURN QUERY
  SELECT
    l.id AS lead_id,
    l.created_at,
    l.source,
    l.job_type,
    l.city,
    l.status,
    l.urgency,
    l.customer_name,
    l.customer_phone,
    l.customer_address,
    l.photo_url,
    (l.estimated_cost_min::text || '-' || l.estimated_cost_max::text) AS estimate_range,
    CASE
      WHEN l.owner_contractor_id = parent THEN 'owned'
      WHEN EXISTS (SELECT 1 FROM public.lead_purchases lp
                   WHERE lp.lead_id = l.id AND lp.contractor_id = parent) THEN 'unlocked'
      ELSE 'accessible'
    END::text AS contractor_lead_status,
    (SELECT lp.purchased_at FROM public.lead_purchases lp
     WHERE lp.lead_id = l.id AND lp.contractor_id = parent
     ORDER BY lp.purchased_at DESC LIMIT 1) AS unlocked_at
  FROM public.leads l
  WHERE
    l.owner_contractor_id = parent
    OR EXISTS (
      SELECT 1 FROM public.lead_purchases lp
      WHERE lp.lead_id = l.id AND lp.contractor_id = parent
    )
  ORDER BY l.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_mobile_accessible_leads() TO authenticated;
