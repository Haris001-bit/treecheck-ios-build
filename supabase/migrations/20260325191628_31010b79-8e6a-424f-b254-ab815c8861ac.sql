
-- 1. Add expires_at and reason_code to credit_transactions
ALTER TABLE public.credit_transactions 
  ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reason_code text DEFAULT NULL;

-- 2. Create contractor_engagement table for win-back tracking and streaks
CREATE TABLE public.contractor_engagement (
  contractor_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_purchase_at timestamp with time zone DEFAULT NULL,
  winback_7d_sent_at timestamp with time zone DEFAULT NULL,
  winback_14d_sent_at timestamp with time zone DEFAULT NULL,
  winback_30d_sent_at timestamp with time zone DEFAULT NULL,
  cycle_count integer NOT NULL DEFAULT 0,
  flagged_for_outreach boolean NOT NULL DEFAULT false,
  current_streak integer NOT NULL DEFAULT 0,
  last_streak_lead_at timestamp with time zone DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.contractor_engagement ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own engagement" ON public.contractor_engagement
  FOR SELECT TO authenticated
  USING (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Admins can manage engagement" ON public.contractor_engagement
  FOR ALL TO authenticated
  USING (public.is_admin());

-- 3. Add last_purchased_at to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_purchased_at timestamp with time zone DEFAULT NULL;

-- 4. Update existing trigger to also set last_purchased_at
CREATE OR REPLACE FUNCTION public.update_lead_purchase_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.leads 
  SET purchase_count = purchase_count + 1,
      last_purchased_at = now(),
      status = CASE WHEN purchase_count + 1 >= 3 THEN 'sold_out' ELSE status END
  WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$function$;

-- 5. Function to update engagement on purchase (called by trigger)
CREATE OR REPLACE FUNCTION public.update_engagement_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  prev_purchase_at timestamp with time zone;
  prev_streak integer;
  lead_created timestamp with time zone;
  response_minutes double precision;
BEGIN
  -- Upsert engagement record
  INSERT INTO public.contractor_engagement (contractor_id, last_purchase_at, current_streak)
  VALUES (NEW.contractor_id, now(), 0)
  ON CONFLICT (contractor_id) DO UPDATE SET
    last_purchase_at = now(),
    winback_7d_sent_at = NULL,
    winback_14d_sent_at = NULL,
    winback_30d_sent_at = NULL,
    cycle_count = 0,
    flagged_for_outreach = false,
    updated_at = now();

  -- Check streak: did they purchase within 15 min of lead creation?
  SELECT created_at INTO lead_created FROM public.leads WHERE id = NEW.lead_id;
  response_minutes := EXTRACT(EPOCH FROM (NEW.purchased_at - lead_created)) / 60.0;

  IF response_minutes <= 15 THEN
    UPDATE public.contractor_engagement
    SET current_streak = current_streak + 1,
        last_streak_lead_at = now()
    WHERE contractor_id = NEW.contractor_id;
  ELSE
    UPDATE public.contractor_engagement
    SET current_streak = 0,
        last_streak_lead_at = now()
    WHERE contractor_id = NEW.contractor_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Create trigger on lead_purchases for engagement tracking
DROP TRIGGER IF EXISTS trg_update_engagement ON public.lead_purchases;
CREATE TRIGGER trg_update_engagement
  AFTER INSERT ON public.lead_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_engagement_on_purchase();

-- 6. Function for metro leaderboard rank (purchases in last 30 days in same service areas)
CREATE OR REPLACE FUNCTION public.get_metro_rank(p_contractor_id uuid)
RETURNS TABLE(rank bigint, total_purchases bigint, total_contractors bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  contractor_cities text[];
BEGIN
  -- Get this contractor's service area cities
  SELECT array_agg(LOWER(city)) INTO contractor_cities
  FROM public.service_areas
  WHERE contractor_id = p_contractor_id;

  IF contractor_cities IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  WITH metro_contractors AS (
    SELECT DISTINCT sa.contractor_id
    FROM public.service_areas sa
    WHERE LOWER(sa.city) = ANY(contractor_cities)
  ),
  purchase_counts AS (
    SELECT mc.contractor_id, COUNT(lp.id) AS cnt
    FROM metro_contractors mc
    LEFT JOIN public.lead_purchases lp ON lp.contractor_id = mc.contractor_id
      AND lp.purchased_at >= now() - interval '30 days'
    GROUP BY mc.contractor_id
  ),
  ranked AS (
    SELECT pc.contractor_id, pc.cnt,
           RANK() OVER (ORDER BY pc.cnt DESC) AS rnk,
           COUNT(*) OVER () AS total
    FROM purchase_counts pc
  )
  SELECT r.rnk, r.cnt, r.total
  FROM ranked r
  WHERE r.contractor_id = p_contractor_id;
END;
$function$;

-- 7. Enable realtime on contractor_engagement for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.contractor_engagement;
