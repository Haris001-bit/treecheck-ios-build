ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS discount_quote_sent_at timestamptz;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS closed_weekdays smallint[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.stamp_quote_sent() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.workflow_status = 'quote_sent' AND (TG_OP = 'INSERT' OR OLD.workflow_status IS DISTINCT FROM 'quote_sent') THEN
    NEW.quote_sent_at := now(); NEW.quote_followup_alerted_at := NULL; NEW.discount_quote_sent_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE public.job_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  kind text NOT NULL,
  summary text NOT NULL,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_activity_job_idx ON public.job_activity (bid_request_id, created_at DESC);
GRANT SELECT ON public.job_activity TO authenticated;
GRANT ALL ON public.job_activity TO service_role;
ALTER TABLE public.job_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Office reads job activity" ON public.job_activity FOR SELECT TO authenticated
  USING (public.is_bid_request_owner(bid_request_id));

CREATE TABLE public.job_activity_reads (
  user_id uuid NOT NULL,
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bid_request_id)
);
GRANT SELECT, INSERT, UPDATE ON public.job_activity_reads TO authenticated;
GRANT ALL ON public.job_activity_reads TO service_role;
ALTER TABLE public.job_activity_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own activity reads" ON public.job_activity_reads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());