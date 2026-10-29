-- A Scout job's official quote defaults to the owner's own Scout price (edited or approved).
-- It never replaces a price someone picked by hand, and stops once a crew offer is awarded.
CREATE OR REPLACE FUNCTION public.scout_price_pick(p_min numeric, p_max numeric)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(p_min, p_max) IS NULL OR coalesce(p_max, p_min) <= 0 THEN NULL
    ELSE jsonb_build_object(
      'bid_id', NULL,
      'option', 'ai',
      'amount', round((coalesce(p_min, p_max) + coalesce(p_max, p_min)) / 2),
      'climber_pay', NULL,
      'picked_by_name', 'Your Scout price',
      'picked_at', now(),
      'auto', 'scout_price'
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.bid_request_default_scout_pick()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  IF NEW.capture_id IS NULL OR NEW.quote_pick IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT final_price_min, final_price_max, free_preview_locked INTO c
    FROM public.scout_captures WHERE id = NEW.capture_id;
  IF FOUND AND coalesce(c.free_preview_locked, false) = false THEN
    NEW.quote_pick := public.scout_price_pick(c.final_price_min, c.final_price_max);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.scout_capture_price_to_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p jsonb;
BEGIN
  IF coalesce(NEW.free_preview_locked, false) THEN
    RETURN NEW;
  END IF;
  IF NEW.final_price_min IS NOT DISTINCT FROM OLD.final_price_min
     AND NEW.final_price_max IS NOT DISTINCT FROM OLD.final_price_max THEN
    RETURN NEW;
  END IF;
  p := public.scout_price_pick(NEW.final_price_min, NEW.final_price_max);
  IF p IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.bid_requests
     SET quote_pick = p
   WHERE capture_id = NEW.id
     AND awarded_bid_id IS NULL
     AND (quote_pick IS NULL OR quote_pick->>'auto' = 'scout_price');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bid_request_default_scout_pick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scout_capture_price_to_jobs() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bid_requests_default_scout_pick ON public.bid_requests;
CREATE TRIGGER bid_requests_default_scout_pick
  BEFORE INSERT ON public.bid_requests
  FOR EACH ROW EXECUTE FUNCTION public.bid_request_default_scout_pick();

DROP TRIGGER IF EXISTS scout_captures_price_to_jobs ON public.scout_captures;
CREATE TRIGGER scout_captures_price_to_jobs
  AFTER UPDATE OF final_price_min, final_price_max ON public.scout_captures
  FOR EACH ROW EXECUTE FUNCTION public.scout_capture_price_to_jobs();