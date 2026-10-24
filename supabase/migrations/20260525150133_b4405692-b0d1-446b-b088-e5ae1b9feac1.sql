
-- Add return address to profiles (JSON: { street, city, state, zip })
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS return_address jsonb;

-- Track postcard mailings
CREATE TABLE IF NOT EXISTS public.postcard_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL,
  scout_capture_id uuid NOT NULL REFERENCES public.scout_captures(id) ON DELETE CASCADE,
  postgrid_id text,
  postgrid_template_id text,
  status text NOT NULL DEFAULT 'queued',
  recipient_name text,
  recipient_address jsonb NOT NULL,
  return_address jsonb NOT NULL,
  merge_variables jsonb,
  cost_cents integer,
  is_test boolean NOT NULL DEFAULT true,
  error_message text,
  send_to_postgrid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_postcard_sends_contractor ON public.postcard_sends(contractor_id);
CREATE INDEX IF NOT EXISTS idx_postcard_sends_capture ON public.postcard_sends(scout_capture_id);
CREATE INDEX IF NOT EXISTS idx_postcard_sends_postgrid ON public.postcard_sends(postgrid_id);

ALTER TABLE public.postcard_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors view own postcards"
ON public.postcard_sends FOR SELECT
USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Admins manage postcards"
ON public.postcard_sends FOR ALL
USING (is_admin())
WITH CHECK (is_admin());

CREATE TRIGGER trg_postcard_sends_updated
BEFORE UPDATE ON public.postcard_sends
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
