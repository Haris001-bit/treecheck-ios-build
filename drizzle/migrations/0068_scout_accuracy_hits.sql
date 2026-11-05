DROP FUNCTION IF EXISTS public.home_scout_accuracy();
CREATE FUNCTION public.home_scout_accuracy()
 RETURNS TABLE(month date, jobs integer, avg_error numeric, hits integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH j AS (
    SELECT date_trunc('month', (br.quote_pick->>'picked_at')::timestamptz)::date AS m,
           (br.quote_pick->>'amount')::numeric AS sold,
           least(coalesce(sc.ai_price_min, sc.ai_price_max), coalesce(sc.ai_price_max, sc.ai_price_min)) AS lo,
           greatest(coalesce(sc.ai_price_min, sc.ai_price_max), coalesce(sc.ai_price_max, sc.ai_price_min)) AS hi
    FROM bid_requests br
    JOIN scout_captures sc ON sc.id = br.capture_id
    WHERE br.owner_contractor_id = get_parent_contractor_id(auth.uid())
      AND br.quote_pick ? 'amount' AND (br.quote_pick->>'amount')::numeric > 0
      AND coalesce(sc.ai_price_min, sc.ai_price_max) IS NOT NULL
      AND coalesce(sc.final_service, sc.requested_service, sc.ai_service, '') !~* 'prun|trim'
      AND coalesce(br.city, '') !~* 'testville'
  )
  SELECT m, count(*)::int,
         avg(abs((lo + hi) / 2.0 - sold) / sold),
         count(*) FILTER (WHERE (sold BETWEEN lo AND hi) OR abs((lo + hi) / 2.0 - sold) / sold <= 0.15)::int
  FROM j GROUP BY m
$function$;
REVOKE ALL ON FUNCTION public.home_scout_accuracy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_scout_accuracy() TO authenticated, service_role;