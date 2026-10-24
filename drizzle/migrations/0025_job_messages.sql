CREATE TABLE public.job_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  crew_member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL,
  sender_name text,
  sender_side text NOT NULL CHECK (sender_side IN ('office','crew')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_messages_thread_idx ON public.job_messages (bid_request_id, crew_member_id, created_at);
GRANT SELECT ON public.job_messages TO authenticated;
GRANT ALL ON public.job_messages TO service_role;
ALTER TABLE public.job_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Office reads job messages" ON public.job_messages FOR SELECT TO authenticated
  USING (public.is_bid_request_owner(bid_request_id));
CREATE POLICY "Crew reads own job messages" ON public.job_messages FOR SELECT TO authenticated
  USING (public.owns_crew_member(crew_member_id));

CREATE TABLE public.job_message_reads (
  user_id uuid NOT NULL,
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  crew_member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  last_alert_at timestamptz,
  PRIMARY KEY (user_id, bid_request_id, crew_member_id)
);
GRANT SELECT, INSERT, UPDATE ON public.job_message_reads TO authenticated;
GRANT ALL ON public.job_message_reads TO service_role;
ALTER TABLE public.job_message_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own read markers" ON public.job_message_reads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.job_messages;