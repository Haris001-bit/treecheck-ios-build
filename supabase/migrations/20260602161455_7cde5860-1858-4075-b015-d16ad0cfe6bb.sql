CREATE TABLE public.account_deletion_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  email TEXT,
  reason TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.account_deletion_feedback TO authenticated;
GRANT ALL ON public.account_deletion_feedback TO service_role;

ALTER TABLE public.account_deletion_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read deletion feedback"
ON public.account_deletion_feedback
FOR SELECT
TO authenticated
USING (public.is_admin());