
-- Update can_purchase_lead to cap at 3
CREATE OR REPLACE FUNCTION public.can_purchase_lead(p_lead_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  lead_record RECORD;
BEGIN
  SELECT purchase_count, status INTO lead_record 
  FROM public.leads WHERE id = p_lead_id;
  
  RETURN lead_record.purchase_count < 3 AND lead_record.status = 'available';
END;
$function$;

-- Update trigger to mark sold_out at 3
CREATE OR REPLACE FUNCTION public.update_lead_purchase_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.leads 
  SET purchase_count = purchase_count + 1,
      status = CASE WHEN purchase_count + 1 >= 3 THEN 'sold_out' ELSE status END
  WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$function$;
