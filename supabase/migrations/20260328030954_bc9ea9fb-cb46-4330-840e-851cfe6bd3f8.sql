
CREATE TABLE public.estimate_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_estimate_low numeric NOT NULL,
  ai_estimate_high numeric NOT NULL,
  feedback text NOT NULL CHECK (feedback IN ('too_low', 'about_right', 'too_high')),
  job_type text NOT NULL,
  location text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, contractor_id)
);

ALTER TABLE public.estimate_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors can view their own feedback"
  ON public.estimate_feedback FOR SELECT
  TO authenticated
  USING (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Contractors can insert their own feedback"
  ON public.estimate_feedback FOR INSERT
  TO authenticated
  WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors can update their own feedback"
  ON public.estimate_feedback FOR UPDATE
  TO authenticated
  USING (contractor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.update_estimate_feedback_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_estimate_feedback_updated_at
  BEFORE UPDATE ON public.estimate_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_estimate_feedback_updated_at();
