-- SL1: Scout learning, the weekly feedback loop (TreeCheck App Improvements, milestone 4), 2026-10-22.
-- Reference SQL. Applied through Lovable (TreeCheck project) as the next drizzle migration (expected 0053),
-- exactly as written. Run checks/readback_SL1.sql after (every column true). Safe to apply twice. Touches no
-- Financial Pulse table or function and adds no column to bid_requests. Rollback: down/SL1_scout_learning.down.sql.
--
-- * company_settings.scout_learning_enabled: the owner's on/off switch (off by default), saved through the
--   table's existing owner policy. company_settings.scout_learning_website: whether the website estimator learns
--   too; set only by Haris in the SQL editor (website learning starts a week after Scout).
-- * estimate_snapshots: what each estimator was given and what it first answered (Scout per capture, the
--   website per lead), so a later "Request edit" can never change the estimate the loop compares. Written only
--   by scout-submit, scout-retry-estimate, scout-estimate-callback and create-personal-lead. Sealed.
-- * scout_learning_runs: one row per learning run. A run is the week's report and, when it rewrites, the
--   company's new guidance (at most one active per company and surface). Written only through
--   scout_learning_claim and scout_learning_finish (service role) and scout_learning_undo (the owner). Sealed.
--   A preview (kind 'preview', asked for with scout_learning_request_preview in the SQL editor) is worked out by the
--   next scheduled run exactly like a real one, but its guidance never goes live: it is only there to be read.
-- * scout_learning_report(): the Scout screen's card, for the caller's own company only.
-- * scout_learning_undo(surface): the owner puts back the guidance from before the latest rewrite.

-- ---------------------------------------------------------------------------
-- 1. The switches
-- ---------------------------------------------------------------------------
alter table public.company_settings
  add column if not exists scout_learning_enabled boolean not null default false,
  add column if not exists scout_learning_website boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. What each estimator was given and first answered (service_role only)
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_snapshots (
  surface text not null check (surface in ('scout', 'website')),
  ref_id uuid not null,
  company_id uuid not null references public.profiles(id) on delete cascade,
  version_id uuid,
  inputs jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  price_min numeric,
  price_max numeric,
  difficulty text,
  risk text,
  service text,
  notes text,
  result_at timestamptz,
  primary key (surface, ref_id));
create index if not exists estimate_snapshots_company_idx
  on public.estimate_snapshots (company_id, surface, sent_at desc);
alter table public.estimate_snapshots enable row level security;
revoke all on table public.estimate_snapshots from public, anon, authenticated;
grant all on table public.estimate_snapshots to service_role;

-- ---------------------------------------------------------------------------
-- 3. Learning runs: the week's report and, for a rewrite, the guidance (service_role only)
-- ---------------------------------------------------------------------------
create table if not exists public.scout_learning_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.profiles(id) on delete cascade,
  surface text not null check (surface in ('scout', 'website')),
  kind text not null check (kind in ('initial', 'weekly', 'manual', 'preview')),
  week_start date,
  status text not null default 'running'
    check (status in ('running', 'rewritten', 'unchanged', 'no_jobs', 'failed')),
  attempts integer not null default 1,
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  jobs jsonb not null default '[]'::jsonb,
  avg_gap_pct numeric,
  summary text,
  changes jsonb not null default '[]'::jsonb,
  guidance jsonb,
  block text check (block is null or char_length(block) <= 1500),
  previous_run_id uuid references public.scout_learning_runs(id) on delete set null,
  active boolean not null default false,
  activated_at timestamptz,
  undone_at timestamptz,
  model text,
  error text,
  created_at timestamptz not null default now(),
  constraint scout_learning_runs_active_has_block check (not active or block is not null),
  constraint scout_learning_runs_weekly_has_week check (kind <> 'weekly' or week_start is not null));
create unique index if not exists scout_learning_runs_one_active
  on public.scout_learning_runs (company_id, surface) where active;
create unique index if not exists scout_learning_runs_one_weekly
  on public.scout_learning_runs (company_id, surface, week_start) where kind = 'weekly';
create unique index if not exists scout_learning_runs_one_initial
  on public.scout_learning_runs (company_id, surface) where kind = 'initial';
create index if not exists scout_learning_runs_company_idx
  on public.scout_learning_runs (company_id, surface, created_at desc);
alter table public.scout_learning_runs enable row level security;
revoke all on table public.scout_learning_runs from public, anon, authenticated;
grant all on table public.scout_learning_runs to service_role;

-- ---------------------------------------------------------------------------
-- 4. Claim a run (service_role only). Returns the run id, or null when that week's (or the initial) run is
--    already done or another call is running it. A failed run, or one stuck running for 15 minutes, is taken
--    over, at most 3 attempts in all.
-- ---------------------------------------------------------------------------
create or replace function public.scout_learning_claim(p_company uuid, p_surface text, p_kind text, p_week date)
returns uuid language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  if p_company is null or p_surface is null or p_surface not in ('scout', 'website')
     or p_kind is null or p_kind not in ('initial', 'weekly', 'manual') then
    raise exception 'scout_learning_claim: a company, a surface and a kind are required';
  end if;
  if p_kind = 'weekly' and p_week is null then
    raise exception 'scout_learning_claim: a weekly run needs its week';
  end if;
  if p_kind in ('initial', 'weekly') then
    update public.scout_learning_runs r
       set status = 'running', attempts = r.attempts + 1, claimed_at = now(), finished_at = null, error = null
     where r.company_id = p_company and r.surface = p_surface and r.kind = p_kind
       and (p_kind = 'initial' or r.week_start = p_week)
       and r.attempts < 3
       and (r.status = 'failed' or (r.status = 'running' and r.claimed_at < now() - interval '15 minutes'))
    returning r.id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.scout_learning_runs (company_id, surface, kind, week_start)
  values (p_company, p_surface, p_kind, case when p_kind = 'weekly' then p_week else null end)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.scout_learning_claim(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.scout_learning_claim(uuid, text, text, date) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Finish a run (service_role only), in one transaction: save the report and, for a rewrite, make its block
--    the company's active guidance (the previous one is kept for undo). A preview keeps its proposed block but
--    never goes live. False when the run isn't running.
-- ---------------------------------------------------------------------------
create or replace function public.scout_learning_finish(p_run uuid, p_status text, p_fields jsonb, p_block text)
returns boolean language plpgsql set search_path = public as $$
declare v_run public.scout_learning_runs; v_prev uuid;
begin
  if p_status is null or p_status not in ('rewritten', 'unchanged', 'no_jobs', 'failed') then
    raise exception 'scout_learning_finish: unknown status %', p_status;
  end if;
  if p_status = 'rewritten' and (p_block is null or btrim(p_block) = '') then
    raise exception 'scout_learning_finish: a rewrite needs its guidance block';
  end if;
  select * into v_run from public.scout_learning_runs where id = p_run for update;
  if not found or v_run.status <> 'running' then return false; end if;
  if p_status = 'rewritten' and v_run.kind <> 'preview' then
    select id into v_prev from public.scout_learning_runs
     where company_id = v_run.company_id and surface = v_run.surface and active
     for update;
    update public.scout_learning_runs set active = false where id = v_prev;
  end if;
  update public.scout_learning_runs set
    status = p_status,
    finished_at = now(),
    jobs = coalesce(p_fields -> 'jobs', '[]'::jsonb),
    avg_gap_pct = nullif(p_fields ->> 'avg_gap_pct', '')::numeric,
    summary = p_fields ->> 'summary',
    changes = coalesce(p_fields -> 'changes', '[]'::jsonb),
    guidance = p_fields -> 'guidance',
    model = p_fields ->> 'model',
    error = left(p_fields ->> 'error', 500),
    block = case when p_status = 'rewritten' or v_run.kind = 'preview' then nullif(btrim(p_block), '') end,
    previous_run_id = case when p_status = 'rewritten' and v_run.kind <> 'preview' then v_prev end,
    active = (p_status = 'rewritten' and v_run.kind <> 'preview'),
    activated_at = case when p_status = 'rewritten' and v_run.kind <> 'preview' then now() end
  where id = p_run;
  return true;
end; $$;
revoke all on function public.scout_learning_finish(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.scout_learning_finish(uuid, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. One surface's part of the report (internal: only the two functions below call it)
-- ---------------------------------------------------------------------------
create or replace function public.scout_learning_surface_report(p_company uuid, p_surface text)
returns jsonb language sql stable security definer set search_path = public as $$
  with latest_rewrite as (
    select id from public.scout_learning_runs
     where company_id = p_company and surface = p_surface and status = 'rewritten'
     order by activated_at desc nulls last, finished_at desc nulls last
     limit 1
  ), active_run as (
    select * from public.scout_learning_runs where company_id = p_company and surface = p_surface and active
  ), recent as (
    select * from public.scout_learning_runs
     where company_id = p_company and surface = p_surface and kind in ('initial', 'weekly')
     order by coalesce(finished_at, claimed_at) desc
     limit 9
  )
  select jsonb_build_object(
    'active', (select jsonb_build_object('run_id', a.id, 'guidance', a.guidance, 'since', a.activated_at)
                 from active_run a),
    'can_undo', exists (select 1 from active_run a join latest_rewrite l on l.id = a.id),
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
               'id', r.id, 'kind', r.kind, 'week_start', r.week_start, 'status', r.status,
               'finished_at', r.finished_at, 'jobs', r.jobs, 'avg_gap_pct', r.avg_gap_pct,
               'summary', r.summary, 'changes', r.changes, 'active', r.active, 'undone_at', r.undone_at)
               order by coalesce(r.finished_at, r.claimed_at) desc) from recent r), '[]'::jsonb));
$$;
revoke all on function public.scout_learning_surface_report(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The Scout screen's card (signed-in users): always the caller's own company, never one passed in.
--    Visible to the owner and to teammates who manage jobs, on a paid or trial plan, for company accounts.
-- ---------------------------------------------------------------------------
create or replace function public.scout_learning_report()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_is_owner boolean;
  v_enabled boolean := false;
  v_website boolean := false;
begin
  if v_uid is null then return jsonb_build_object('visible', false); end if;
  if not exists (select 1 from public.profiles p
                  where p.id = v_uid and coalesce(p.account_type, 'company') = 'company') then
    return jsonb_build_object('visible', false);
  end if;
  v_company := public.get_parent_contractor_id(v_uid);
  v_is_owner := (v_company = v_uid);
  if coalesce(public.company_plan(v_company), 'none') not in ('paid', 'trialing') then
    return jsonb_build_object('visible', false);
  end if;
  if not v_is_owner and not coalesce(public.company_has_permission(v_company, 'manageJobsSubs'), false) then
    return jsonb_build_object('visible', false);
  end if;
  select coalesce(cs.scout_learning_enabled, false), coalesce(cs.scout_learning_website, false)
    into v_enabled, v_website
    from public.company_settings cs where cs.contractor_id = v_company;
  v_enabled := coalesce(v_enabled, false);
  v_website := coalesce(v_website, false);
  return jsonb_build_object(
    'visible', true,
    'is_owner', v_is_owner,
    'enabled', v_enabled,
    'pending_first_run', v_enabled and not exists (
      select 1 from public.scout_learning_runs r
       where r.company_id = v_company and r.surface = 'scout' and r.kind = 'initial' and r.status <> 'running'),
    'scout', public.scout_learning_surface_report(v_company, 'scout'),
    'website', case
      when v_website or exists (select 1 from public.scout_learning_runs r
                                 where r.company_id = v_company and r.surface = 'website')
      then public.scout_learning_surface_report(v_company, 'website') end);
end; $$;
revoke all on function public.scout_learning_report() from public, anon;
grant execute on function public.scout_learning_report() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Undo the latest rewrite (the owner only). Puts back the guidance from before it, or none (standard Scout).
--    Expected refusals come back as {ok: false, reason}, never as errors.
-- ---------------------------------------------------------------------------
create or replace function public.scout_learning_undo(p_surface text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
  v_run public.scout_learning_runs;
  v_latest uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  v_company := public.get_parent_contractor_id(v_uid);
  if v_company is distinct from v_uid then return jsonb_build_object('ok', false, 'reason', 'owner_only'); end if;
  if p_surface is null or p_surface not in ('scout', 'website') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_surface');
  end if;
  select * into v_run from public.scout_learning_runs
   where company_id = v_company and surface = p_surface and active
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'nothing_to_undo'); end if;
  select id into v_latest from public.scout_learning_runs
   where company_id = v_company and surface = p_surface and status = 'rewritten'
   order by activated_at desc nulls last, finished_at desc nulls last
   limit 1;
  if v_latest is distinct from v_run.id then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_undo');
  end if;
  update public.scout_learning_runs set active = false, undone_at = now() where id = v_run.id;
  if v_run.previous_run_id is not null then
    update public.scout_learning_runs set active = true
     where id = v_run.previous_run_id and block is not null;
  end if;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.scout_learning_undo(text) from public, anon;
grant execute on function public.scout_learning_undo(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Ask for a preview (service_role only, so from the SQL editor): the next scheduled run works out what a run
--    for this company and estimator would do right now and saves it as a 'preview' run (jobs, summary, changes,
--    guidance and the block), which never goes live. Works whether or not the company has turned learning on.
-- ---------------------------------------------------------------------------
create or replace function public.scout_learning_request_preview(p_company uuid, p_surface text)
returns uuid language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  if p_company is null or p_surface is null or p_surface not in ('scout', 'website') then
    raise exception 'scout_learning_request_preview: a company and a surface are required';
  end if;
  insert into public.scout_learning_runs (company_id, surface, kind, status, attempts)
  values (p_company, p_surface, 'preview', 'running', 0)
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.scout_learning_request_preview(uuid, text) from public, anon, authenticated;
grant execute on function public.scout_learning_request_preview(uuid, text) to service_role;
