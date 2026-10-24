-- JS1: Jobber sync tables for TreeCheck (Jobber milestone, plan section 5), 2026-10-08.
-- Reference SQL. Applied through Lovable (TreeCheck project) as the next drizzle migration (expected 0036),
-- exactly as written. Run checks/precheck_JS1.sql first (no Jobber quote id may be shared by two jobs) and
-- checks/readback_JS1.sql after (every column true). Safe to apply twice. Touches no Financial Pulse table or
-- function. Rollback: down/JS1_jobber_sync.down.sql.
--
-- * bid_requests.jobber_quote_id becomes unique when set: one Jobber quote is never linked to two jobs.
-- * company_jobber_settings: the seven Jobber switches per company, all off by default and changed only by Haris
--   in the SQL editor, plus the company's calendar and quote settings. A company with no row has every switch off.
-- * company_jobber_state: runtime state per company (calendar cache, throttle, reconcile, digest and alert dates).
--   It keeps day counts only, never visit details.
-- * bid_request_quotes: one row per job with the price, the Jobber quote and job links and the office alert stamps.
--   Kept off bid_requests because invited subs can read every bid_requests column. A Jobber job links to at most
--   one TreeCheck job.
-- * tc_alert_once(job, key): stamps an office alert as sent, once per job and key, in one atomic update. A job with
--   no bid_request_quotes row gets null and nothing is stamped, so the caller can log the alert it could not send.
-- The office (owner and team) reads its own company's rows; only service-role functions and the SQL editor write.

-- ---------------------------------------------------------------------------
-- 1. One Jobber quote per job
-- ---------------------------------------------------------------------------
create unique index if not exists bid_requests_jobber_quote_key
  on public.bid_requests (jobber_quote_id) where jobber_quote_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.company_jobber_settings (
  contractor_id uuid primary key,
  quotes_on_award boolean not null default false, auto_hire boolean not null default false,
  book_jobs boolean not null default false, completion_sync boolean not null default false,
  free_days boolean not null default false, jobber_import boolean not null default false,
  closeout_invoices boolean not null default false,
  busy_visits_per_day smallint not null default 1 check (busy_visits_per_day between 1 and 20),
  timezone text not null default 'America/Chicago',
  default_province text check (default_province is null or default_province ~ '^[A-Z]{2}$'),
  quote_template jsonb not null default '{}'::jsonb, change_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table if not exists public.company_jobber_state (      -- runtime only; day counts, never visit details
  contractor_id uuid primary key,
  busy_counts jsonb, busy_window_start date, busy_window_end date, busy_coverage_end date,
  busy_fetched_at timestamptz, busy_fetch_started_at timestamptz,
  throttle_available integer, throttle_checked_at timestamptz,
  reconciled_at timestamptz, reconcile_started_at timestamptz,
  digest_sent_on date, disconnected_alerted_on date, updated_at timestamptz not null default now());

create table if not exists public.bid_request_quotes (
  bid_request_id uuid primary key references public.bid_requests(id) on delete cascade,
  owner_contractor_id uuid not null,
  sale_price numeric(12,2), price_source text check (price_source in ('pick','formula')),
  pick_option text, formula_sale numeric(12,2), line_items jsonb,
  quote_state text not null default 'none' check (quote_state in
    ('none','creating','created','linked','skipped','failed','manual','waiting_other_role','deleted')),
  quote_uncertain boolean not null default false,
  quote_trigger text check (quote_trigger in ('pick','award','retry','link')),
  quote_claimed_at timestamptz, quote_attempts smallint not null default 0, quote_error text,
  quote_created_at timestamptz, previous_quote_ids text[] not null default '{}',
  jobber_client_id text, client_match text check (client_match in
    ('stored','email','phone_name','email_phone','name_address','new','office')),
  client_match_ambiguous boolean not null default false, jobber_property_id text,
  jobber_quote_status text, jobber_quote_subtotal numeric(12,2), jobber_quote_discount numeric(12,2),
  jobber_quote_tax numeric(12,2), jobber_quote_deposit numeric(12,2), jobber_quote_total numeric(12,2),
  quote_approved_at timestamptz, quote_checked_at timestamptz,
  hire_requested_at timestamptz, hire_requested_by text check (hire_requested_by in ('office','jobber')),
  jobber_job_id text, jobber_job_number text,
  job_link_source text check (job_link_source in ('treecheck','jobber')),
  job_state text not null default 'none' check (job_state in
    ('none','booking','booked','linked','failed','office_books','deleted')),
  job_claimed_at timestamptz, job_error text, booked_date date, job_checked_at timestamptz,
  duplicate_job_ids text[] not null default '{}',
  office_alerts jsonb not null default '{}'::jsonb,
  jobber_completed_at timestamptz, completion_synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index if not exists bid_request_quotes_job_key
  on public.bid_request_quotes (jobber_job_id) where jobber_job_id is not null;
create index if not exists bid_request_quotes_owner_idx on public.bid_request_quotes (owner_contractor_id);

-- ---------------------------------------------------------------------------
-- 3. Access: the office reads its own rows, browsers never write, the server writes
-- ---------------------------------------------------------------------------
alter table public.company_jobber_settings enable row level security;
alter table public.company_jobber_state enable row level security;
alter table public.bid_request_quotes enable row level security;

revoke all on table public.company_jobber_settings from public, anon, authenticated;
revoke all on table public.company_jobber_state from public, anon, authenticated;
revoke all on table public.bid_request_quotes from public, anon, authenticated;
grant select on table public.company_jobber_settings to authenticated;
grant select on table public.company_jobber_state to authenticated;
grant select on table public.bid_request_quotes to authenticated;
grant all on table public.company_jobber_settings to service_role;
grant all on table public.company_jobber_state to service_role;
grant all on table public.bid_request_quotes to service_role;

-- Exactly one rule per table, and it is SELECT.
drop policy if exists "Office reads own Jobber settings" on public.company_jobber_settings;
create policy "Office reads own Jobber settings" on public.company_jobber_settings
  for select to authenticated using (contractor_id = public.get_parent_contractor_id(auth.uid()));
drop policy if exists "Office reads own Jobber state" on public.company_jobber_state;
create policy "Office reads own Jobber state" on public.company_jobber_state
  for select to authenticated using (contractor_id = public.get_parent_contractor_id(auth.uid()));
drop policy if exists "Office reads own job quotes" on public.bid_request_quotes;
create policy "Office reads own job quotes" on public.bid_request_quotes
  for select to authenticated using (public.is_bid_request_owner(bid_request_id));

drop trigger if exists company_jobber_settings_updated_at on public.company_jobber_settings;
create trigger company_jobber_settings_updated_at before update on public.company_jobber_settings
  for each row execute function public.update_updated_at_column();
drop trigger if exists bid_request_quotes_updated_at on public.bid_request_quotes;
create trigger bid_request_quotes_updated_at before update on public.bid_request_quotes
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 4. Office alerts, once per job and key (server only)
-- ---------------------------------------------------------------------------
-- Stamps alert p_key as sent for the job. True only for the call that stamped it; false when it was stamped
-- before (or p_key is null); null when the job has no bid_request_quotes row, so nothing was stamped and the
-- caller must create the row first. A single conditional update, so two callers racing on the same key never
-- both get true.
create or replace function public.tc_alert_once(p_bid_request_id uuid, p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bid_request_quotes
     set office_alerts = office_alerts || jsonb_build_object(p_key, now())
   where bid_request_id = p_bid_request_id
     and not (office_alerts ? p_key);
  if found then
    return true;
  end if;
  if not exists (select 1 from public.bid_request_quotes where bid_request_id = p_bid_request_id) then
    return null;
  end if;
  return false;
end;
$$;

revoke execute on function public.tc_alert_once(uuid, text) from public, anon, authenticated;
grant execute on function public.tc_alert_once(uuid, text) to service_role;