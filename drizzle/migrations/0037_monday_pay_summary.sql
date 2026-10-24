ALTER TABLE public.bids ADD COLUMN IF NOT EXISTS agreed_pay numeric;
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS paid_by uuid;

CREATE OR REPLACE FUNCTION public.stamp_job_completed()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.workflow_status = 'job_complete' AND (OLD.workflow_status IS DISTINCT FROM 'job_complete') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSIF NEW.workflow_status IS DISTINCT FROM 'job_complete' AND OLD.workflow_status = 'job_complete' AND NEW.paid_at IS NULL THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_job_completed ON public.bid_requests;
CREATE TRIGGER trg_stamp_job_completed BEFORE UPDATE OF workflow_status ON public.bid_requests
FOR EACH ROW EXECUTE FUNCTION public.stamp_job_completed();

UPDATE public.bid_requests SET completed_at = updated_at
WHERE workflow_status = 'job_complete' AND completed_at IS NULL;

CREATE TABLE public.job_ground_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  owner_contractor_id uuid NOT NULL,
  crew_member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  hours numeric,
  pay numeric,
  entered_by uuid,
  entered_at timestamptz,
  asked_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bid_request_id, crew_member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_ground_hours TO authenticated;
GRANT ALL ON public.job_ground_hours TO service_role;
ALTER TABLE public.job_ground_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Office manages ground hours" ON public.job_ground_hours FOR ALL TO authenticated
  USING (owner_contractor_id = auth.uid() OR public.is_team_member_of(owner_contractor_id) OR public.is_admin())
  WITH CHECK (owner_contractor_id = auth.uid() OR public.is_team_member_of(owner_contractor_id) OR public.is_admin());
CREATE POLICY "Workers read own hours" ON public.job_ground_hours FOR SELECT TO authenticated
  USING (crew_member_id IN (SELECT id FROM public.crew_members WHERE user_id = auth.uid()));
CREATE TRIGGER trg_job_ground_hours_updated BEFORE UPDATE ON public.job_ground_hours
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.pay_week_notices (
  owner_contractor_id uuid NOT NULL,
  week_start date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_contractor_id, week_start)
);
GRANT ALL ON public.pay_week_notices TO service_role;
ALTER TABLE public.pay_week_notices ENABLE ROW LEVEL SECURITY;