-- ============ helper functions ============
CREATE OR REPLACE FUNCTION public.owns_crew_member(p_crew_member_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.crew_members
    WHERE id = p_crew_member_id AND user_id = auth.uid()
  ) INTO ok;
  RETURN ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_bid_request_owner(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.bid_requests
    WHERE id = p_request_id
      AND owner_contractor_id = public.get_parent_contractor_id(auth.uid())
  ) INTO ok;
  RETURN ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_crew_recipient(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.bid_request_recipients r
    JOIN public.crew_members c ON c.id = r.crew_member_id
    WHERE r.bid_request_id = p_request_id
      AND c.user_id = auth.uid()
      AND c.status = 'active'
  ) INTO ok;
  RETURN ok;
END;
$$;

-- ============ crew_members ============
CREATE TABLE public.crew_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_contractor_id uuid NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text,
  phone text,
  email text,
  trade text NOT NULL DEFAULT 'climber',
  certifications text,
  equipment text,
  status text NOT NULL DEFAULT 'pending',
  rating_avg numeric,
  jobs_completed integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crew_members_owner_user_uniq ON public.crew_members(owner_contractor_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX crew_members_owner_idx ON public.crew_members(owner_contractor_id);
CREATE INDEX crew_members_user_idx ON public.crew_members(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_members TO authenticated;
GRANT ALL ON public.crew_members TO service_role;
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own crew" ON public.crew_members FOR ALL TO authenticated
  USING (owner_contractor_id = public.get_parent_contractor_id(auth.uid()))
  WITH CHECK (owner_contractor_id = public.get_parent_contractor_id(auth.uid()));
CREATE POLICY "Crew reads own row" ON public.crew_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Crew updates own row" ON public.crew_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER crew_members_updated_at BEFORE UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ bid_requests ============
CREATE TABLE public.bid_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_contractor_id uuid NOT NULL,
  created_by uuid,
  capture_id uuid REFERENCES public.scout_captures(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  photo_path text,
  city text,
  status text NOT NULL DEFAULT 'open',
  deadline_at timestamptz,
  offered_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_margin_pct numeric NOT NULL DEFAULT 30,
  owner_cost numeric NOT NULL DEFAULT 0,
  awarded_bid_id uuid,
  awarded_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bid_requests_owner_idx ON public.bid_requests(owner_contractor_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bid_requests TO authenticated;
GRANT ALL ON public.bid_requests TO service_role;
ALTER TABLE public.bid_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own bid requests" ON public.bid_requests FOR ALL TO authenticated
  USING (owner_contractor_id = public.get_parent_contractor_id(auth.uid()))
  WITH CHECK (owner_contractor_id = public.get_parent_contractor_id(auth.uid()));
CREATE POLICY "Invited crew reads bid request" ON public.bid_requests FOR SELECT TO authenticated
  USING (public.is_crew_recipient(id));

CREATE TRIGGER bid_requests_updated_at BEFORE UPDATE ON public.bid_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ bid_request_recipients ============
CREATE TABLE public.bid_request_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  crew_member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bid_request_id, crew_member_id)
);
CREATE INDEX bid_request_recipients_crew_idx ON public.bid_request_recipients(crew_member_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bid_request_recipients TO authenticated;
GRANT ALL ON public.bid_request_recipients TO service_role;
ALTER TABLE public.bid_request_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages recipients" ON public.bid_request_recipients FOR ALL TO authenticated
  USING (public.is_bid_request_owner(bid_request_id))
  WITH CHECK (public.is_bid_request_owner(bid_request_id));
CREATE POLICY "Crew reads own recipient row" ON public.bid_request_recipients FOR SELECT TO authenticated
  USING (public.owns_crew_member(crew_member_id));

-- ============ bids ============
CREATE TABLE public.bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  crew_member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  min_pay numeric NOT NULL,
  ideal_pay numeric NOT NULL,
  crew_size integer,
  equipment text,
  est_hours numeric,
  available_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  status text NOT NULL DEFAULT 'submitted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bid_request_id, crew_member_id)
);
CREATE INDEX bids_request_idx ON public.bids(bid_request_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bids TO authenticated;
GRANT ALL ON public.bids TO service_role;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads bids on own requests" ON public.bids FOR SELECT TO authenticated
  USING (public.is_bid_request_owner(bid_request_id));
CREATE POLICY "Owner updates bids on own requests" ON public.bids FOR UPDATE TO authenticated
  USING (public.is_bid_request_owner(bid_request_id))
  WITH CHECK (public.is_bid_request_owner(bid_request_id));
CREATE POLICY "Crew reads own bid" ON public.bids FOR SELECT TO authenticated
  USING (public.owns_crew_member(crew_member_id));
CREATE POLICY "Crew submits own bid" ON public.bids FOR INSERT TO authenticated
  WITH CHECK (public.owns_crew_member(crew_member_id) AND public.is_crew_recipient(bid_request_id));
CREATE POLICY "Crew updates own bid" ON public.bids FOR UPDATE TO authenticated
  USING (public.owns_crew_member(crew_member_id))
  WITH CHECK (public.owns_crew_member(crew_member_id));

CREATE TRIGGER bids_updated_at BEFORE UPDATE ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ crew_ratings ============
CREATE TABLE public.crew_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_contractor_id uuid NOT NULL,
  crew_member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  bid_request_id uuid REFERENCES public.bid_requests(id) ON DELETE SET NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crew_ratings_crew_idx ON public.crew_ratings(crew_member_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_ratings TO authenticated;
GRANT ALL ON public.crew_ratings TO service_role;
ALTER TABLE public.crew_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own crew ratings" ON public.crew_ratings FOR ALL TO authenticated
  USING (owner_contractor_id = public.get_parent_contractor_id(auth.uid()))
  WITH CHECK (owner_contractor_id = public.get_parent_contractor_id(auth.uid()));

CREATE TRIGGER crew_ratings_updated_at BEFORE UPDATE ON public.crew_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- keep rating_avg / jobs_completed fresh
CREATE OR REPLACE FUNCTION public.refresh_crew_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.crew_members c
  SET rating_avg = sub.avg_rating,
      jobs_completed = sub.cnt
  FROM (
    SELECT AVG(rating)::numeric(3,2) AS avg_rating, COUNT(*)::int AS cnt
    FROM public.crew_ratings
    WHERE crew_member_id = COALESCE(NEW.crew_member_id, OLD.crew_member_id)
  ) sub
  WHERE c.id = COALESCE(NEW.crew_member_id, OLD.crew_member_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER crew_ratings_refresh AFTER INSERT OR UPDATE OR DELETE ON public.crew_ratings
  FOR EACH ROW EXECUTE FUNCTION public.refresh_crew_rating();
