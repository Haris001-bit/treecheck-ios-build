-- Sub network profile (one per sub user)
CREATE TABLE public.crew_profiles (
  user_id uuid PRIMARY KEY,
  network_visible boolean NOT NULL DEFAULT true,
  home_city text,
  travel_radius_miles integer NOT NULL DEFAULT 25,
  hidden_owner_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.crew_profiles TO authenticated;
GRANT ALL ON public.crew_profiles TO service_role;
ALTER TABLE public.crew_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Subs manage own network profile" ON public.crew_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read network profiles" ON public.crew_profiles FOR SELECT TO authenticated USING (public.is_admin());

ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'invite';
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

-- Job request options
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'own_then_network';
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS pay_mode text NOT NULL DEFAULT 'bid';
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS fixed_pay numeric;
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS fixed_pay_type text;
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS equipment_needed text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.bid_requests ADD COLUMN IF NOT EXISTS crew_counts jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Company ratings
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_rating_avg numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_rating_count integer NOT NULL DEFAULT 0;

-- Two-way reviews
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_request_id uuid NOT NULL REFERENCES public.bid_requests(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL,
  reviewer_type text NOT NULL CHECK (reviewer_type IN ('company','crew')),
  reviewee_type text NOT NULL CHECK (reviewee_type IN ('company','crew')),
  reviewee_user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}',
  comment text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','pending_review','hidden','removed')),
  comment_hidden boolean NOT NULL DEFAULT false,
  revealed_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  response text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bid_request_id, reviewer_user_id, reviewee_user_id)
);
GRANT SELECT ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read revealed published reviews or own" ON public.reviews FOR SELECT TO authenticated
  USING (reviewer_user_id = auth.uid() OR public.is_admin()
    OR (status = 'published' AND revealed_at <= now()));

CREATE TABLE public.review_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  reporter_user_id uuid,
  reason text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
GRANT SELECT, INSERT ON public.review_reports TO authenticated;
GRANT ALL ON public.review_reports TO service_role;
ALTER TABLE public.review_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users report reviews" ON public.review_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_user_id = auth.uid()
    AND reason IN ('offensive','false','personal_info','harassment','other'));
CREATE POLICY "Admins read reports" ON public.review_reports FOR SELECT TO authenticated USING (public.is_admin());

-- Recalculate rating averages
CREATE OR REPLACE FUNCTION public.refresh_review_averages() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_avg numeric; v_cnt int;
BEGIN
  r := COALESCE(NEW, OLD);
  SELECT avg(stars), count(*) INTO v_avg, v_cnt FROM reviews
    WHERE reviewee_user_id = r.reviewee_user_id AND reviewee_type = r.reviewee_type
      AND status IN ('published','hidden') ;
  IF r.reviewee_type = 'crew' THEN
    UPDATE crew_members SET rating_avg = CASE WHEN v_cnt >= 3 THEN round(v_avg, 2) ELSE NULL END,
      rating_count = v_cnt WHERE user_id = r.reviewee_user_id;
  ELSE
    UPDATE profiles SET company_rating_avg = CASE WHEN v_cnt >= 3 THEN round(v_avg, 2) ELSE NULL END,
      company_rating_count = v_cnt WHERE id = r.reviewee_user_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER reviews_refresh_avg AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.refresh_review_averages();

-- Network search for owners: masked profile data
CREATE OR REPLACE FUNCTION public.network_subs(p_trade text DEFAULT NULL)
RETURNS TABLE(user_id uuid, full_name text, trade text, home_city text, rating_avg numeric, rating_count int,
  jobs_completed int, taking_work boolean, can_skid_steer boolean, can_chipper boolean, crane_certified boolean,
  owns_saws boolean, insured text, tree_experience_level text, years_climbing int, connection_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT COALESCE(public.get_parent_contractor_id(auth.uid()), auth.uid()) AS owner_id),
  cities AS (SELECT lower(city) c FROM service_areas, me WHERE contractor_id = me.owner_id),
  latest AS (
    SELECT DISTINCT ON (cm.user_id) cm.* FROM crew_members cm
    WHERE cm.user_id IS NOT NULL AND cm.trade <> 'pending'
    ORDER BY cm.user_id, cm.updated_at DESC
  )
  SELECT l.user_id, l.full_name, l.trade, cp.home_city,
    (SELECT max(rating_avg) FROM crew_members x WHERE x.user_id = l.user_id),
    (SELECT max(rating_count) FROM crew_members x WHERE x.user_id = l.user_id),
    (SELECT COALESCE(sum(jobs_completed),0)::int FROM crew_members x WHERE x.user_id = l.user_id),
    COALESCE((SELECT bool_or(a.taking_work) FROM crew_availability a JOIN crew_members x ON x.id = a.crew_member_id WHERE x.user_id = l.user_id), true),
    l.can_skid_steer, l.can_chipper, l.crane_certified, l.owns_saws, l.insured, l.tree_experience_level, l.years_climbing,
    (SELECT x.status FROM crew_members x, me WHERE x.user_id = l.user_id AND x.owner_contractor_id = me.owner_id LIMIT 1)
  FROM latest l
  JOIN crew_profiles cp ON cp.user_id = l.user_id AND cp.network_visible
  CROSS JOIN me
  WHERE l.user_id <> me.owner_id
    AND NOT (me.owner_id = ANY(cp.hidden_owner_ids))
    AND (p_trade IS NULL OR l.trade = p_trade OR l.trade = 'both' AND p_trade IN ('climber','ground'))
    AND (NOT EXISTS (SELECT 1 FROM cities) OR cp.home_city IS NULL OR lower(cp.home_city) IN (SELECT c FROM cities)
         OR EXISTS (SELECT 1 FROM cities WHERE c LIKE '%' || lower(cp.home_city) || '%' OR lower(cp.home_city) LIKE '%' || c || '%'))
$$;
GRANT EXECUTE ON FUNCTION public.network_subs(text) TO authenticated;

-- Seed network profiles for existing subs (opted in)
INSERT INTO public.crew_profiles (user_id)
SELECT DISTINCT user_id FROM public.crew_members WHERE user_id IS NOT NULL
ON CONFLICT DO NOTHING;