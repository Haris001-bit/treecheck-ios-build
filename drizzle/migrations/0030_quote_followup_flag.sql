ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS quote_sent_at timestamptz, ADD COLUMN IF NOT EXISTS quote_followup_alerted_at timestamptz;
UPDATE public.bid_requests SET quote_sent_at = now() WHERE workflow_status = 'quote_sent' AND quote_sent_at IS NULL;
CREATE OR REPLACE FUNCTION public.stamp_quote_sent() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.workflow_status = 'quote_sent' AND (TG_OP = 'INSERT' OR OLD.workflow_status IS DISTINCT FROM 'quote_sent') THEN
    NEW.quote_sent_at := now(); NEW.quote_followup_alerted_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_quote_sent ON public.bid_requests;
CREATE TRIGGER trg_stamp_quote_sent BEFORE INSERT OR UPDATE OF workflow_status ON public.bid_requests FOR EACH ROW EXECUTE FUNCTION public.stamp_quote_sent();