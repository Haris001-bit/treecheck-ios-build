-- Extend device_tokens for App Store-safe push behavior
ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'fcm',
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS lead_alerts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS account_alerts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS marketing_alerts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS device_tokens_active_contractor_idx
  ON public.device_tokens (contractor_id) WHERE revoked_at IS NULL;

-- RPC: confirm the calling contractor (or their team owner) has access to a lead.
-- Used by send-push (with service role + p_user) AND by the iOS app (auth.uid()).
CREATE OR REPLACE FUNCTION public.mobile_can_access_lead(p_lead_id uuid, p_user uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := COALESCE(p_user, auth.uid());
  parent uuid;
BEGIN
  IF uid IS NULL OR p_lead_id IS NULL THEN
    RETURN false;
  END IF;

  parent := public.get_parent_contractor_id(uid);

  RETURN EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = p_lead_id
      AND (
        l.owner_contractor_id = parent
        OR EXISTS (
          SELECT 1 FROM public.lead_purchases lp
          WHERE lp.lead_id = l.id AND lp.contractor_id = parent
        )
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mobile_can_access_lead(uuid, uuid) TO authenticated, service_role;

-- Audit table for safe-mode notification events (optional but useful for QA)
CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL,
  notification_type text NOT NULL,
  lead_id uuid,
  platform text,
  delivered boolean NOT NULL DEFAULT false,
  blocked_reason text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_events TO authenticated;
GRANT ALL ON public.notification_events TO service_role;

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors view own notification events"
  ON public.notification_events FOR SELECT TO authenticated
  USING (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Admins manage notification events"
  ON public.notification_events FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS notification_events_contractor_idx
  ON public.notification_events (contractor_id, created_at DESC);