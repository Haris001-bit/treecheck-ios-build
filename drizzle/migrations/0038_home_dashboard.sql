CREATE TABLE public.job_views (
  user_id uuid NOT NULL,
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bid_request_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_views TO authenticated;
GRANT ALL ON public.job_views TO service_role;
ALTER TABLE public.job_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own job views" ON public.job_views FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.home_scout_accuracy()
RETURNS TABLE(month date, jobs integer, avg_error numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT date_trunc('month', (br.quote_pick->>'picked_at')::timestamptz)::date,
         count(*)::int,
         avg(abs(((coalesce(sc.ai_price_min, sc.ai_price_max) + coalesce(sc.ai_price_max, sc.ai_price_min)) / 2.0)
             - (br.quote_pick->>'amount')::numeric) / nullif((br.quote_pick->>'amount')::numeric, 0))
  FROM bid_requests br
  JOIN scout_captures sc ON sc.id = br.capture_id
  WHERE br.owner_contractor_id = get_parent_contractor_id(auth.uid())
    AND br.quote_pick ? 'amount' AND (br.quote_pick->>'amount')::numeric > 0
    AND coalesce(sc.ai_price_min, sc.ai_price_max) IS NOT NULL
    AND coalesce(sc.final_service, sc.requested_service, sc.ai_service, '') !~* 'prun|trim'
    AND coalesce(br.city, '') !~* 'testville'
  GROUP BY 1
$$;
REVOKE ALL ON FUNCTION public.home_scout_accuracy() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.home_scout_accuracy() TO authenticated;

CREATE OR REPLACE FUNCTION public.home_dma_counts()
RETURNS TABLE(this_month integer, last_month integer, total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH p AS (
    SELECT coalesce(published_at, created_at) AS at FROM dma_published_projects
    WHERE contractor_id = get_parent_contractor_id(auth.uid()) AND status IN ('published','revising')
  ), m AS (SELECT date_trunc('month', now() AT TIME ZONE 'America/Chicago') AS s)
  SELECT count(*) FILTER (WHERE (at AT TIME ZONE 'America/Chicago') >= m.s)::int,
         count(*) FILTER (WHERE (at AT TIME ZONE 'America/Chicago') >= m.s - interval '1 month' AND (at AT TIME ZONE 'America/Chicago') < m.s)::int,
         count(*)::int
  FROM p, m GROUP BY m.s
$$;
REVOKE ALL ON FUNCTION public.home_dma_counts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.home_dma_counts() TO authenticated;