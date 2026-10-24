CREATE TABLE public.mobile_unlock_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text UNIQUE NOT NULL,
  contractor_id uuid NOT NULL,
  user_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  quoted_unlock_fee numeric NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  source_platform text NOT NULL DEFAULT 'ios',
  status text NOT NULL DEFAULT 'created',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE INDEX idx_mobile_unlock_intents_user ON public.mobile_unlock_intents(user_id);
CREATE INDEX idx_mobile_unlock_intents_lead ON public.mobile_unlock_intents(lead_id);

GRANT SELECT ON public.mobile_unlock_intents TO authenticated;
GRANT ALL ON public.mobile_unlock_intents TO service_role;

ALTER TABLE public.mobile_unlock_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own intents"
  ON public.mobile_unlock_intents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_admin());
