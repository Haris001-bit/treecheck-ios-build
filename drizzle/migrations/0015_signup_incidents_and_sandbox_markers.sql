ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;
ALTER TABLE public.crew_profiles ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.crew_profiles ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE public.crew_profiles ADD COLUMN IF NOT EXISTS location_label text;
ALTER TABLE public.service_areas ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.service_areas ADD COLUMN IF NOT EXISTS longitude double precision;

CREATE TABLE public.signup_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_ref text NOT NULL UNIQUE,
  fingerprint text NOT NULL,
  journey text NOT NULL,
  action text NOT NULL,
  safe_summary text NOT NULL,
  account_email text,
  severity text NOT NULL DEFAULT 'serious',
  sms_sent boolean NOT NULL DEFAULT false,
  sms_suppressed boolean NOT NULL DEFAULT false,
  delivery_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT ON public.signup_incidents TO authenticated;
GRANT ALL ON public.signup_incidents TO service_role;
ALTER TABLE public.signup_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read signup incidents" ON public.signup_incidents
FOR SELECT TO authenticated USING (public.is_admin());

CREATE TABLE public.signup_sandbox_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  audience text NOT NULL,
  simulated_state text NOT NULL DEFAULT 'new_signup',
  test_email text NOT NULL,
  test_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_sandbox_sessions TO authenticated;
GRANT ALL ON public.signup_sandbox_sessions TO service_role;
ALTER TABLE public.signup_sandbox_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage signup sandbox" ON public.signup_sandbox_sessions
FOR ALL TO authenticated USING (public.is_admin() AND admin_user_id = auth.uid())
WITH CHECK (public.is_admin() AND admin_user_id = auth.uid());

CREATE INDEX signup_incidents_fingerprint_created_idx ON public.signup_incidents (fingerprint, created_at DESC);
CREATE INDEX signup_sandbox_admin_idx ON public.signup_sandbox_sessions (admin_user_id, created_at DESC);

CREATE TRIGGER signup_sandbox_sessions_updated_at
BEFORE UPDATE ON public.signup_sandbox_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();