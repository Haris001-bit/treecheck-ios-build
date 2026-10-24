CREATE OR REPLACE FUNCTION public.refresh_review_averages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; v_avg numeric; v_cnt int;
BEGIN
  r := COALESCE(NEW, OLD);
  SELECT avg(stars), count(*) INTO v_avg, v_cnt FROM reviews
    WHERE reviewee_user_id = r.reviewee_user_id AND reviewee_type = r.reviewee_type
      AND status IN ('published','hidden') ;
  IF r.reviewee_type = 'crew' THEN
    -- Show a sub's stars as soon as there is at least one review.
    UPDATE crew_members SET rating_avg = CASE WHEN v_cnt >= 1 THEN round(v_avg, 2) ELSE NULL END,
      rating_count = v_cnt WHERE user_id = r.reviewee_user_id;
  ELSE
    UPDATE profiles SET company_rating_avg = CASE WHEN v_cnt >= 3 THEN round(v_avg, 2) ELSE NULL END,
      company_rating_count = v_cnt WHERE id = r.reviewee_user_id;
  END IF;
  RETURN NULL;
END $$;