CREATE TABLE public.giveaway_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway text NOT NULL,
  user_id uuid,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  company_name text,
  region text,
  country text CHECK (country IS NULL OR country IN ('US', 'CA')),
  source text NOT NULL,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  rules_version text NOT NULL,
  ip text,
  user_agent text,
  drawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.giveaway_entries IS 'One entry per email per giveaway, with the marketing wording the person agreed to. Written only by the giveaway-enter and create-trial-signup functions (service role); drawn only by giveaway-draw, which sets drawn_at.';

CREATE UNIQUE INDEX giveaway_entries_one_per_email ON public.giveaway_entries (giveaway, lower(email));
CREATE INDEX giveaway_entries_ip_idx ON public.giveaway_entries (ip, created_at DESC);

GRANT SELECT ON public.giveaway_entries TO authenticated;
GRANT ALL ON public.giveaway_entries TO service_role;

ALTER TABLE public.giveaway_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read giveaway entries"
ON public.giveaway_entries FOR SELECT TO authenticated
USING (public.is_admin());