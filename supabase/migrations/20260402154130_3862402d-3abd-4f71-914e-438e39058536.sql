CREATE OR REPLACE FUNCTION public.update_engagement_on_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  lead_created timestamp with time zone;
  response_minutes double precision;
BEGIN
  INSERT INTO public.contractor_engagement (contractor_id, last_purchase_at, current_streak)
  VALUES (NEW.contractor_id, now(), 0)
  ON CONFLICT (contractor_id) DO UPDATE SET
    last_purchase_at = now(),
    winback_14d_sent_at = NULL,
    winback_30d_sent_at = NULL,
    winback_60d_sent_at = NULL,
    cycle_count = 0,
    flagged_for_outreach = false,
    updated_at = now();

  SELECT created_at INTO lead_created FROM public.leads WHERE id = NEW.lead_id;
  response_minutes := EXTRACT(EPOCH FROM (NEW.purchased_at - lead_created)) / 60.0;

  IF response_minutes <= 15 THEN
    UPDATE public.contractor_engagement
    SET current_streak = current_streak + 1, last_streak_lead_at = now()
    WHERE contractor_id = NEW.contractor_id;
  ELSE
    UPDATE public.contractor_engagement
    SET current_streak = 0, last_streak_lead_at = now()
    WHERE contractor_id = NEW.contractor_id;
  END IF;

  RETURN NEW;
END;
$function$;