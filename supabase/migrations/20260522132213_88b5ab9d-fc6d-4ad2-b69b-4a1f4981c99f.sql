
CREATE TABLE public.scout_captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  photo_path TEXT,
  voice_memo_path TEXT,
  notes_raw TEXT,
  notes_summary TEXT,
  circumference_inches NUMERIC,
  diameter_inches NUMERIC,
  address_street TEXT,
  address_city TEXT,
  address_state TEXT,
  address_zip TEXT,
  ai_service TEXT,
  ai_price_min NUMERIC,
  ai_price_max NUMERIC,
  ai_difficulty TEXT,
  ai_risk TEXT,
  ai_notes TEXT,
  final_service TEXT,
  final_price_min NUMERIC,
  final_price_max NUMERIC,
  final_notes TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scout_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors insert own captures"
ON public.scout_captures FOR INSERT TO authenticated
WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors view own captures"
ON public.scout_captures FOR SELECT TO authenticated
USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Contractors update own captures"
ON public.scout_captures FOR UPDATE TO authenticated
USING (contractor_id = auth.uid() OR is_admin());

CREATE POLICY "Admins manage captures"
ON public.scout_captures FOR ALL TO authenticated
USING (is_admin()) WITH CHECK (is_admin());

CREATE TRIGGER scout_captures_updated_at
BEFORE UPDATE ON public.scout_captures
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_scout_captures_contractor ON public.scout_captures(contractor_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.scout_captures;
ALTER TABLE public.scout_captures REPLICA IDENTITY FULL;

INSERT INTO storage.buckets (id, name, public) VALUES ('scout-media', 'scout-media', false);

CREATE POLICY "Contractors read own scout media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'scout-media' AND (auth.uid()::text = (storage.foldername(name))[1] OR is_admin()));

CREATE POLICY "Contractors upload own scout media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'scout-media' AND auth.uid()::text = (storage.foldername(name))[1]);
