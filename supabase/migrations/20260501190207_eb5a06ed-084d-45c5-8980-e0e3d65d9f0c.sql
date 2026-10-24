
CREATE TABLE public.estimator_waitlist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  user_id uuid,
  source text NOT NULL DEFAULT 'instant_tree_estimator',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.estimator_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can join waitlist"
  ON public.estimator_waitlist FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view waitlist"
  ON public.estimator_waitlist FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can manage waitlist"
  ON public.estimator_waitlist FOR ALL
  TO authenticated
  USING (is_admin());

CREATE INDEX estimator_waitlist_email_idx ON public.estimator_waitlist (email);
