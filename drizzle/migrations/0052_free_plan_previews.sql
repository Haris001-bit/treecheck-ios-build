-- Free plan previews: the full Scout estimate / DMA post waits here, out of reach of every app user,
-- until the company is on a trial or paid plan. Server functions only (no policies on purpose).
ALTER TABLE public.scout_captures ADD COLUMN IF NOT EXISTS free_preview_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.dma_email_posts ADD COLUMN IF NOT EXISTS free_preview_locked boolean NOT NULL DEFAULT false;

CREATE TABLE public.free_preview_vault (
  kind text NOT NULL,
  ref_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref_id),
  CONSTRAINT free_preview_vault_kind CHECK (kind IN ('scout','dma'))
);
GRANT ALL ON public.free_preview_vault TO service_role;
ALTER TABLE public.free_preview_vault ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.free_preview_vault IS 'Server-only: full Free-plan preview results. RLS enabled with no policies on purpose.';

-- A locked row stays locked from the app while the company is on Free (only the unlock below or a server clears it).
CREATE OR REPLACE FUNCTION public.keep_free_preview_locked() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid;
BEGIN
  IF OLD.free_preview_locked AND NOT NEW.free_preview_locked AND auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('app.free_preview_unlock', true) IS DISTINCT FROM 'on' THEN
    v_owner := CASE TG_TABLE_NAME WHEN 'scout_captures' THEN NEW.owner_id ELSE NEW.contractor_id END;
    IF public.company_plan(public.get_parent_contractor_id(v_owner)) NOT IN ('trialing','paid') THEN
      NEW.free_preview_locked := true;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER keep_free_preview_locked BEFORE UPDATE ON public.scout_captures FOR EACH ROW EXECUTE FUNCTION public.keep_free_preview_locked();
CREATE TRIGGER keep_free_preview_locked BEFORE UPDATE ON public.dma_email_posts FOR EACH ROW EXECUTE FUNCTION public.keep_free_preview_locked();

-- Once the company is trialing or paid, restore every preview it made on Free.
CREATE OR REPLACE FUNCTION public.free_preview_unlock() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid := public.get_parent_contractor_id(auth.uid()); v record; n integer := 0;
BEGIN
  IF auth.uid() IS NULL OR v_owner IS NULL THEN RETURN 0; END IF;
  IF public.company_plan(v_owner) NOT IN ('trialing','paid') THEN RETURN 0; END IF;
  PERFORM set_config('app.free_preview_unlock', 'on', true);
  FOR v IN SELECT * FROM public.free_preview_vault WHERE owner_id = v_owner FOR UPDATE LOOP
    IF v.kind = 'scout' THEN
      UPDATE public.scout_captures SET
        ai_price_min = (v.content->>'ai_price_min')::numeric,
        ai_price_max = (v.content->>'ai_price_max')::numeric,
        ai_difficulty = v.content->>'ai_difficulty',
        ai_risk = v.content->>'ai_risk',
        ai_notes = v.content->>'ai_notes',
        notes_summary = coalesce(v.content->>'notes_summary', notes_summary),
        free_preview_locked = false
      WHERE id = v.ref_id;
    ELSE
      UPDATE public.dma_email_posts SET
        title = coalesce(v.content->>'title', title),
        article = coalesce(v.content->>'article', article),
        google_caption = coalesce(v.content->>'google_caption', ''),
        facebook_caption = coalesce(v.content->>'facebook_caption', ''),
        instagram_caption = coalesce(v.content->>'instagram_caption', ''),
        free_preview_locked = false,
        updated_at = now()
      WHERE id = v.ref_id;
    END IF;
    DELETE FROM public.free_preview_vault WHERE kind = v.kind AND ref_id = v.ref_id;
    n := n + 1;
  END LOOP;
  PERFORM set_config('app.free_preview_unlock', 'off', true);
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.free_preview_unlock() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.free_preview_unlock() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.keep_free_preview_locked() FROM PUBLIC, anon, authenticated;

-- free_plan_status now also reports how many previews wait to unlock.
CREATE OR REPLACE FUNCTION public.free_plan_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid := public.get_parent_contractor_id(auth.uid()); v_month date := public.free_plan_month(); l record;
BEGIN
  IF auth.uid() IS NULL OR v_owner IS NULL THEN RETURN jsonb_build_object('plan', 'none'); END IF;
  SELECT city, state, label INTO l FROM public.company_locations WHERE owner_id = v_owner;
  RETURN jsonb_build_object(
    'plan', public.company_plan(v_owner),
    'is_owner', auth.uid() = v_owner,
    'trial_used', public.company_trial_used(v_owner),
    'location_set', l.city IS NOT NULL,
    'location_label', l.label,
    'eligible', public.company_free_eligible(v_owner),
    'jobs_used', (SELECT count(*) FROM public.free_plan_usage WHERE owner_id = v_owner AND kind = 'job' AND month = v_month),
    'jobs_limit', public.free_plan_limit('job'),
    'scout_used', (SELECT count(*) FROM public.free_plan_usage WHERE owner_id = v_owner AND kind = 'scout_preview' AND month = v_month),
    'scout_limit', public.free_plan_limit('scout_preview'),
    'dma_used', (SELECT count(*) FROM public.free_plan_usage WHERE owner_id = v_owner AND kind = 'dma_preview' AND month = v_month),
    'dma_limit', public.free_plan_limit('dma_preview'),
    'locked_previews', (SELECT count(*) FROM public.free_preview_vault WHERE owner_id = v_owner)
  );
END $$;