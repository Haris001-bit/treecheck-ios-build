CREATE TABLE public.communication_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('account', 'marketing')),
  granted boolean NOT NULL,
  channels text[] NOT NULL DEFAULT '{}',
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  email text,
  phone text,
  source text NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.communication_consents IS 'Append-only record of what each person agreed to at signup (account messages, marketing). Written only by signup functions with the service role; the newest row per user and kind is the current answer.';

CREATE INDEX communication_consents_user_kind_idx ON public.communication_consents (user_id, kind, created_at DESC);

GRANT SELECT ON public.communication_consents TO authenticated;
GRANT ALL ON public.communication_consents TO service_role;

ALTER TABLE public.communication_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "People read their own consent records"
ON public.communication_consents FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());