CREATE TABLE public.home_ai_summaries (
  contractor_id uuid PRIMARY KEY,
  stats_key text NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.home_ai_summaries TO authenticated;
GRANT ALL ON public.home_ai_summaries TO service_role;
ALTER TABLE public.home_ai_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their dashboard summary" ON public.home_ai_summaries
  FOR SELECT TO authenticated USING (contractor_id = auth.uid());
COMMENT ON TABLE public.home_ai_summaries IS 'Cached AI month summary for the Dashboard, built from TreeCheck job activity only (never Financial Pulse data). Written only by the home-summary function.';