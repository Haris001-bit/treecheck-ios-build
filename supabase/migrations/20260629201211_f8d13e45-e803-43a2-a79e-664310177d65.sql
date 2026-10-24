CREATE TABLE public.jobber_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  account_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.jobber_tokens TO authenticated;
GRANT ALL ON public.jobber_tokens TO service_role;
ALTER TABLE public.jobber_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can view own jobber tokens"
ON public.jobber_tokens FOR SELECT TO authenticated
USING (contractor_id = auth.uid() OR public.is_admin());

CREATE TABLE public.jobber_oauth_states (
  state text PRIMARY KEY,
  contractor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.jobber_oauth_states TO service_role;
ALTER TABLE public.jobber_oauth_states ENABLE ROW LEVEL SECURITY;