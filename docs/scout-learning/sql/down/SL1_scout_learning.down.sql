-- Rollback of SL1 (Scout learning). Removes the learning functions, the two sealed tables and the two switches.
-- Scout and the website estimator then run on their shared prompts only, as before SL1. Deploy the functions
-- from before PR A (or keep them: their learning steps fail quietly without these tables) before running this.
drop function if exists public.scout_learning_request_preview(uuid, text);
drop function if exists public.scout_learning_undo(text);
drop function if exists public.scout_learning_report();
drop function if exists public.scout_learning_surface_report(uuid, text);
drop function if exists public.scout_learning_finish(uuid, text, jsonb, text);
drop function if exists public.scout_learning_claim(uuid, text, text, date);
drop table if exists public.scout_learning_runs;
drop table if exists public.estimate_snapshots;
alter table public.company_settings
  drop column if exists scout_learning_enabled,
  drop column if exists scout_learning_website;
