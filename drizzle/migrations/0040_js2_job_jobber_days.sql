-- JS2: Jobber visit days on the Jobs calendar (TreeCheck App Improvements, free extra for Mark), 2026-10-15.
-- Reference SQL. Applied through Lovable (TreeCheck project) as the next drizzle migration (expected 0040),
-- exactly as written. Run checks/readback_JS2.sql after (every column true). Safe to apply twice. Touches no
-- Financial Pulse table or function. Rollback: down/JS2_job_jobber_days.down.sql.
--
-- * job_jobber_days: the local days of each linked job's Jobber visits (job id and date only, never visit
--   details). Written only by the jobber-visit-days function through replace_job_jobber_days, read only through
--   calendar_jobs(). Sealed: RLS on with no policy, service_role only.
-- * company_jobber_state.visit_days_started_at / visit_days_synced_at: when the sync last started and finished.
-- * claim_jobber_visit_days(owner): true at most once every 9 minutes per company, in one atomic upsert, so the
--   Jobber read runs at most every 10 minutes per company however often crew-release-holds is called.
-- * replace_job_jobber_days(owner, from, to, rows): in one transaction, clears the company's days in the window
--   (and any days of jobs no longer linked to a Jobber quote), saves the new ones, and stamps the sync time.
-- * calendar_jobs(): Mark's Lovable calendar function (0039) with one change: in the office view, a job with
--   Jobber days shows those days instead of its award and ground days. Call-out, completed and crew days are
--   unchanged, and a job without Jobber days shows exactly what it did before.

-- ---------------------------------------------------------------------------
-- 1. The days table (service_role only)
-- ---------------------------------------------------------------------------
create table if not exists public.job_jobber_days (
  bid_request_id uuid not null references public.bid_requests(id) on delete cascade,
  day date not null,
  synced_at timestamptz not null default now(),
  primary key (bid_request_id, day));
alter table public.job_jobber_days enable row level security;
revoke all on table public.job_jobber_days from public, anon, authenticated;
grant all on table public.job_jobber_days to service_role;

-- ---------------------------------------------------------------------------
-- 2. Sync times on the company's Jobber state
-- ---------------------------------------------------------------------------
alter table public.company_jobber_state
  add column if not exists visit_days_started_at timestamptz,
  add column if not exists visit_days_synced_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. The claim: at most one sync per company every 9 minutes
-- ---------------------------------------------------------------------------
create or replace function public.claim_jobber_visit_days(p_owner uuid)
returns boolean language plpgsql set search_path = public as $$
begin
  if p_owner is null then return false; end if;
  insert into public.company_jobber_state as s (contractor_id, visit_days_started_at, updated_at)
  values (p_owner, now(), now())
  on conflict (contractor_id) do update set visit_days_started_at = now(), updated_at = now()
   where s.visit_days_started_at is null or s.visit_days_started_at < now() - interval '9 minutes';
  return found;
end; $$;
revoke all on function public.claim_jobber_visit_days(uuid) from public, anon, authenticated;
grant execute on function public.claim_jobber_visit_days(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Replace a company's days in the window, in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.replace_job_jobber_days(p_owner uuid, p_from date, p_to date, p_rows jsonb)
returns integer language plpgsql set search_path = public as $$
declare v_saved integer;
begin
  if p_owner is null or p_from is null or p_to is null or p_from > p_to
     or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'replace_job_jobber_days: an owner, a window and an array of rows are required';
  end if;
  delete from public.job_jobber_days d using public.bid_requests br
   where br.id = d.bid_request_id and br.owner_contractor_id = p_owner
     and (d.day between p_from and p_to or br.jobber_quote_id is null);
  insert into public.job_jobber_days (bid_request_id, day)
  select distinct r.bid_request_id, r.day
    from jsonb_to_recordset(p_rows) as r(bid_request_id uuid, day date)
    join public.bid_requests br on br.id = r.bid_request_id
     and br.owner_contractor_id = p_owner and br.jobber_quote_id is not null
   where r.day between p_from and p_to
  on conflict (bid_request_id, day) do nothing;
  get diagnostics v_saved = row_count;
  update public.company_jobber_state set visit_days_synced_at = now(), updated_at = now()
   where contractor_id = p_owner;
  return v_saved;
end; $$;
revoke all on function public.replace_job_jobber_days(uuid, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_job_jobber_days(uuid, date, date, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The Jobs calendar, with Jobber's days in the office view
-- ---------------------------------------------------------------------------
create or replace function public.calendar_jobs()
returns table(bid_request_id uuid, title text, customer_name text, customer_address text, city text, workflow_status text, day date, kind text)
language sql stable security definer set search_path to 'public' as $$
  with me as (select auth.uid() as uid, get_parent_contractor_id(auth.uid()) as owner_id),
  mine as (select cm.id from crew_members cm, me where cm.user_id = me.uid and cm.status = 'active'),
  owned as (select br.* from bid_requests br, me where br.owner_contractor_id = me.owner_id),
  jobber_days as (select d.bid_request_id as id, d.day from job_jobber_days d join owned o on o.id = d.bid_request_id),
  owner_days as (
    select id, awarded_date as day, 'scheduled' as kind from owned
      where awarded_date is not null and id not in (select id from jobber_days)
    union select id, awarded_ground_date, 'scheduled' from owned
      where awarded_ground_date is not null and id not in (select id from jobber_days)
    union select d.bid_request_id, coalesce(d.scheduled_date, d.awarded_date), 'scheduled'
      from job_dispatches d join owned o on o.id = d.bid_request_id where coalesce(d.scheduled_date, d.awarded_date) is not null
    union select id, day, 'scheduled' from jobber_days
    union select id, (completed_at at time zone 'America/Chicago')::date, 'completed' from owned where completed_at is not null
  ),
  crew_hired as (
    select br.id, br.awarded_date as day from bid_requests br join bids b on b.id in (br.awarded_bid_id, br.awarded_stump_bid_id)
      where b.crew_member_id in (select id from mine)
    union select br.id, coalesce(br.awarded_ground_date, br.awarded_date) from bid_requests br join bids b on b.id = br.awarded_ground_bid_id
      where b.crew_member_id in (select id from mine)
    union select d.bid_request_id, coalesce(d.scheduled_date, d.awarded_date) from job_dispatches d
      where d.hired_crew_member_ids && array(select id from mine)
  ),
  crew_days as (
    select id, day, 'scheduled' as kind from crew_hired where day is not null
    union select br.id, (br.completed_at at time zone 'America/Chicago')::date, 'completed'
      from bid_requests br where br.completed_at is not null and br.id in (select id from crew_hired)
  ),
  all_days as (select * from owner_days union select * from crew_days)
  select br.id, br.title, br.customer_name, br.customer_address, br.city, br.workflow_status, a.day, a.kind
  from all_days a join bid_requests br on br.id = a.id
$$;
revoke all on function public.calendar_jobs() from public, anon;
grant execute on function public.calendar_jobs() to authenticated;