-- M2: Financial Pulse core schema, 2026-09-29.
-- Reference SQL. Applied through Lovable (TreeCheck project) exactly as written.
-- Safe to apply twice (if not exists / create or replace / drop ... if exists).
--
-- Access model (see Project Architecture A2 to A4):
-- * The company is the owner's profiles.id. Every finance row carries owner_id.
-- * Browsers may only SELECT, and only their own company's rows, through pulse_owner_id():
--   the caller must be a company owner (no parent_contractor_id, account_type 'company')
--   whose Pulse switch is on. Team members, subcontractors, admins of other companies and
--   anon get nothing. There is deliberately no "OR is_admin()" on any finance table.
-- * Sealed tables (bank access keys, Plaid slot ledger, Jobber sync state, webhook inbox)
--   have RLS on, zero policies and no grants to anon/authenticated. Only server functions
--   (service role) touch them. The linter warning "RLS enabled, no policy" is intended.
-- * Every write goes through an edge function using the service role.
-- * Every SECURITY DEFINER function is executable by service_role only, except
--   pulse_owner_id().

-- ---------------------------------------------------------------------------
-- 1. Per-company switch (written only by the pulse-admin function)
-- ---------------------------------------------------------------------------
create table if not exists public.pulse_access (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  plaid_env text not null default 'sandbox' check (plaid_env in ('sandbox', 'production')),
  max_items integer not null default 2 check (max_items between 0 and 10),
  enabled_by uuid,
  enabled_at timestamptz,
  disabled_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. The one owner predicate used by every finance policy and function
-- ---------------------------------------------------------------------------
create or replace function public.pulse_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  join public.pulse_access a on a.owner_id = p.id and a.enabled
  where p.id = auth.uid()
    and p.parent_contractor_id is null
    and coalesce(p.account_type, 'company') = 'company'
$$;

-- ---------------------------------------------------------------------------
-- 3. Company settings, categories, rules, consent
-- ---------------------------------------------------------------------------
create table if not exists public.pulse_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  timezone text not null default 'America/Chicago',
  profit_target_monthly numeric(14,2),
  cash_reserve numeric(14,2) not null default 0 check (cash_reserve >= 0),
  pay_frequency text check (pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  pay_anchor_date date,
  payroll_amount_override numeric(14,2) check (payroll_amount_override is null or payroll_amount_override >= 0),
  revenue_basis text not null default 'job_total' check (revenue_basis in ('job_total', 'invoiced_total')),
  revenue_tax text not null default 'as_jobber' check (revenue_tax in ('as_jobber', 'pre_tax')),
  card_payment_window_days integer not null default 5 check (card_payment_window_days between 1 and 14),
  transfer_window_days integer not null default 5 check (transfer_window_days between 1 and 14),
  setup_step text,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pulse_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  key text not null,
  label text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, key)
);

create table if not exists public.plaid_link_consents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  link_session_id text,
  institution_id text
);
create index if not exists plaid_link_consents_owner_idx on public.plaid_link_consents (owner_id);

-- ---------------------------------------------------------------------------
-- 4. Plaid
-- ---------------------------------------------------------------------------
create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  plaid_env text not null check (plaid_env in ('sandbox', 'production')),
  item_id text not null unique,
  institution_id text,
  institution_name text,
  status text not null default 'active'
    check (status in ('active', 'login_required', 'pending_expiration', 'pending_disconnect', 'revoked', 'removed', 'error')),
  error_code text,
  error_at timestamptz,
  new_accounts_available boolean not null default false,
  initial_update_complete boolean not null default false,
  historical_update_complete boolean not null default false,
  last_successful_update timestamptz,
  last_synced_at timestamptz,
  last_webhook_at timestamptz,
  consent_expiration_time timestamptz,
  linked_by uuid,
  linked_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plaid_items_owner_idx on public.plaid_items (owner_id);

-- Sealed: encrypted access token and sync cursor. Never readable by browsers.
create table if not exists public.plaid_item_secrets (
  item_row_id uuid primary key references public.plaid_items(id) on delete cascade,
  access_token_ct text not null,
  access_token_iv text not null,
  key_version integer not null default 1,
  sync_cursor text,
  sync_lock_until timestamptz,
  balance_checked_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Sealed: one row per production (or sandbox) token exchange attempt. No FK to profiles so
-- it survives account deletion; Plaid's free Trial allows 10 production Items ever.
create table if not exists public.plaid_slot_ledger (
  id bigserial primary key,
  owner_id uuid not null,
  plaid_env text not null check (plaid_env in ('sandbox', 'production')),
  status text not null default 'reserved' check (status in ('reserved', 'exchanged', 'failed')),
  item_id text,
  institution_id text,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plaid_slot_ledger_env_idx on public.plaid_slot_ledger (plaid_env, status);

create table if not exists public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  item_row_id uuid not null references public.plaid_items(id) on delete cascade,
  account_id text not null unique,
  persistent_account_id text,
  name text,
  official_name text,
  mask text,
  type text,
  subtype text,
  holder_category text,
  is_business boolean not null default false,
  include_from date,
  use_for_payroll boolean not null default false,
  balance_available numeric(14,2),
  balance_current numeric(14,2),
  balance_limit numeric(14,2),
  iso_currency_code text,
  balance_as_of timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plaid_accounts_owner_idx on public.plaid_accounts (owner_id);
create index if not exists plaid_accounts_item_idx on public.plaid_accounts (item_row_id);

create table if not exists public.pulse_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  rule_type text not null check (rule_type in ('exclude_personal', 'set_category')),
  match_kind text not null check (match_kind in ('transaction_id', 'merchant_entity_id', 'description_key', 'merchant_name')),
  match_value text not null,
  account_row_id uuid references public.plaid_accounts(id) on delete cascade,
  category_key text,
  source text not null check (source in ('owner_tap', 'support')),
  created_by uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((rule_type = 'set_category') = (category_key is not null))
);
create unique index if not exists pulse_rules_active_unique
  on public.pulse_rules (owner_id, rule_type, match_kind, match_value,
                         coalesce(account_row_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where active;
create index if not exists pulse_rules_owner_idx on public.pulse_rules (owner_id) where active;

create table if not exists public.plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  account_row_id uuid not null references public.plaid_accounts(id) on delete cascade,
  transaction_id text not null unique,
  pending boolean not null,
  pending_transaction_id text,
  txn_date date not null,
  authorized_date date,
  amount numeric(14,2) not null,
  iso_currency_code text,
  name text,
  merchant_name text,
  merchant_entity_id text,
  counterparty_name text,
  counterparty_type text,
  payee text,
  payment_channel text,
  pfc_primary text,
  pfc_detailed text,
  pfc_confidence text,
  plaid_seen_at timestamptz,
  treatment text not null default 'unsorted' check (treatment in ('cost', 'refund', 'excluded', 'unsorted')),
  category_key text,
  exclude_reason text check (exclude_reason in
    ('card_payment', 'own_transfer', 'personal', 'before_count_from', 'inflow', 'non_business_account', 'pending')),
  matched_transaction_id text,
  classified_by text check (classified_by in
    ('user_rule', 'own_transfer', 'card_payment', 'merchant_rule', 'pfc', 'fallback', 'guard')),
  rule_id uuid references public.pulse_rules(id) on delete set null,
  sorter_version text,
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plaid_transactions_owner_date_idx
  on public.plaid_transactions (owner_id, txn_date desc);
create index if not exists plaid_transactions_owner_cat_idx
  on public.plaid_transactions (owner_id, category_key, txn_date)
  where treatment in ('cost', 'refund') and not pending;
create index if not exists plaid_transactions_account_idx
  on public.plaid_transactions (account_row_id, txn_date);
create index if not exists plaid_transactions_pending_ref_idx
  on public.plaid_transactions (pending_transaction_id) where pending_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Jobber revenue (no client names or addresses stored)
-- ---------------------------------------------------------------------------
create table if not exists public.jobber_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  jobber_account_id text not null,
  jobber_job_id text not null,
  job_number integer,
  title text,
  job_status text,
  job_type text,
  billing_type text,
  total numeric(14,2),
  invoiced_total numeric(14,2),
  invoices_nonvoid_total numeric(14,2),
  invoices_nonvoid_subtotal numeric(14,2),
  invoice_count integer not null default 0,
  completed_at timestamptz,
  completed_source text check (completed_source in ('job', 'last_visit')),
  deleted_at timestamptz,
  jobber_created_at timestamptz,
  jobber_updated_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, jobber_job_id)
);
create index if not exists jobber_jobs_owner_completed_idx on public.jobber_jobs (owner_id, completed_at);

create table if not exists public.jobber_visit_revenue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  jobber_account_id text not null,
  jobber_visit_id text not null,
  jobber_job_id text not null,
  amount numeric(14,2) not null,
  completed_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, jobber_visit_id)
);
create index if not exists jobber_visit_revenue_owner_completed_idx
  on public.jobber_visit_revenue (owner_id, completed_at);

-- Sealed: backfill cursors, watermark, scheduled work, granted scopes.
create table if not exists public.jobber_sync_state (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  backfill_cursor text,
  backfill_started_at timestamptz,
  backfill_completed_at timestamptz,
  jobs_seen integer not null default 0,
  incremental_watermark timestamptz,
  scheduled_by_day jsonb,
  scheduled_status text check (scheduled_status in ('ok', 'no_scope', 'error')),
  scheduled_fetched_at timestamptz,
  granted_scopes text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Computed snapshot and sealed webhook inbox
-- ---------------------------------------------------------------------------
create table if not exists public.pulse_snapshots (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  engine_version text,
  sorter_version text,
  computed_at timestamptz,
  as_of_date date,
  timezone text,
  metrics jsonb,
  warnings jsonb,
  inputs jsonb,
  dirty boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pulse_events (
  id bigserial primary key,
  source text not null check (source in ('plaid', 'jobber')),
  external_id text,
  event_type text,
  dedupe_key text not null unique,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  error text
);
create index if not exists pulse_events_unprocessed_idx on public.pulse_events (received_at) where processed_at is null;

-- ---------------------------------------------------------------------------
-- 7. updated_at triggers (existing helper function)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'pulse_access', 'pulse_settings', 'pulse_categories', 'pulse_rules', 'plaid_items',
    'plaid_item_secrets', 'plaid_slot_ledger', 'plaid_accounts', 'plaid_transactions',
    'jobber_jobs', 'jobber_visit_revenue', 'jobber_sync_state', 'pulse_snapshots'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Row level security, policies and grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  -- Owner-readable tables
  foreach t in array array[
    'pulse_access', 'pulse_settings', 'pulse_categories', 'pulse_rules', 'plaid_link_consents',
    'plaid_items', 'plaid_accounts', 'plaid_transactions', 'jobber_jobs', 'jobber_visit_revenue',
    'pulse_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;

  -- Sealed tables: RLS on, zero policies, no browser grants
  foreach t in array array['plaid_item_secrets', 'plaid_slot_ledger', 'jobber_sync_state', 'pulse_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

revoke all on sequence public.plaid_slot_ledger_id_seq from public, anon, authenticated;
revoke all on sequence public.pulse_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.plaid_slot_ledger_id_seq to service_role;
grant usage, select on sequence public.pulse_events_id_seq to service_role;

-- The owner can see their own switch row (to show "not enabled"), without the predicate.
drop policy if exists "Pulse owner reads own access row" on public.pulse_access;
create policy "Pulse owner reads own access row" on public.pulse_access
  for select to authenticated using (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'pulse_settings', 'pulse_categories', 'pulse_rules', 'plaid_link_consents', 'plaid_items',
    'plaid_accounts', 'plaid_transactions', 'jobber_jobs', 'jobber_visit_revenue', 'pulse_snapshots'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'Pulse owner reads own rows', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select public.pulse_owner_id()))',
      'Pulse owner reads own rows', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Server-only helper functions
-- ---------------------------------------------------------------------------

-- Claim the sync lock for one Plaid item. Returns false if another sync holds it.
create or replace function public.plaid_claim_sync(p_item_row_id uuid, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed boolean;
begin
  update public.plaid_item_secrets
     set sync_lock_until = now() + make_interval(secs => greatest(p_seconds, 1))
   where item_row_id = p_item_row_id
     and (sync_lock_until is null or sync_lock_until < now())
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function public.plaid_release_sync(p_item_row_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.plaid_item_secrets set sync_lock_until = null where item_row_id = p_item_row_id;
$$;

-- Move the sync cursor only if nobody else moved it since p_old_cursor (compare and swap).
create or replace function public.plaid_commit_cursor(p_item_row_id uuid, p_old_cursor text, p_new_cursor text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare moved boolean;
begin
  update public.plaid_item_secrets
     set sync_cursor = p_new_cursor
   where item_row_id = p_item_row_id
     and sync_cursor is not distinct from p_old_cursor
  returning true into moved;
  return coalesce(moved, false);
end;
$$;

-- Production Plaid slots used so far (reserved or exchanged, removed ones included).
create or replace function public.plaid_slots_used(p_env text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.plaid_slot_ledger
   where plaid_env = p_env and status in ('reserved', 'exchanged');
$$;

-- Seed the five default categories for a company (idempotent).
create or replace function public.pulse_seed_categories(p_owner uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pulse_categories (owner_id, key, label, sort_order) values
    (p_owner, 'payroll_contractors', 'Payroll and contractors', 10),
    (p_owner, 'fuel_equipment', 'Fuel and equipment', 20),
    (p_owner, 'job_fees', 'Job fees', 30),
    (p_owner, 'operating', 'Operating costs', 40),
    (p_owner, 'other', 'Other', 50)
  on conflict (owner_id, key) do nothing;
$$;

-- Window totals for the engine, computed in SQL so no row cap can truncate them.
-- p_windows: [{"key": "mtd", "from": "2026-10-01", "to": "2026-10-13"}, ...] (local dates, inclusive)
-- Revenue uses the company's revenue_basis and revenue_tax settings; completion times are
-- converted to local dates in p_tz. Costs use posted rows only; refunds are negative costs.
create or replace function public.pulse_window_totals(p_owner uuid, p_tz text, p_windows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w jsonb;
  w_key text;
  w_from date;
  w_to date;
  v_basis text;
  v_tax text;
  result jsonb := '{}'::jsonb;
  v_rev numeric;
  v_rev_count integer;
  v_cost numeric;
  v_cost_count integer;
  v_by_cat jsonb;
  v_excluded jsonb;
  v_pending numeric;
begin
  select coalesce(s.revenue_basis, 'job_total'), coalesce(s.revenue_tax, 'as_jobber')
    into v_basis, v_tax
    from public.pulse_settings s where s.owner_id = p_owner;
  v_basis := coalesce(v_basis, 'job_total');
  v_tax := coalesce(v_tax, 'as_jobber');

  for w in select * from jsonb_array_elements(p_windows) loop
    w_key := w->>'key';
    w_from := (w->>'from')::date;
    w_to := (w->>'to')::date;

    -- Revenue: one-off jobs by job completion, visit-based/recurring jobs by completed visit.
    select coalesce(sum(r.amount), 0), count(*)
      into v_rev, v_rev_count
      from (
        select case
                 when v_tax = 'pre_tax' and j.invoices_nonvoid_subtotal is not null then j.invoices_nonvoid_subtotal
                 when v_basis = 'invoiced_total' then coalesce(j.invoices_nonvoid_total, j.total)
                 else coalesce(nullif(j.total, 0), j.invoices_nonvoid_total)
               end as amount
          from public.jobber_jobs j
         where j.owner_id = p_owner
           and j.deleted_at is null
           and j.completed_at is not null
           and coalesce(j.job_type, 'ONE_OFF') <> 'RECURRING'
           and coalesce(j.billing_type, 'FIXED_PRICE') <> 'VISIT_BASED'
           and (j.completed_at at time zone p_tz)::date between w_from and w_to
        union all
        select v.amount
          from public.jobber_visit_revenue v
         where v.owner_id = p_owner
           and v.deleted_at is null
           and (v.completed_at at time zone p_tz)::date between w_from and w_to
      ) r;

    select coalesce(sum(t.amount), 0), count(*)
      into v_cost, v_cost_count
      from public.plaid_transactions t
     where t.owner_id = p_owner
       and not t.pending
       and t.treatment in ('cost', 'refund')
       and t.txn_date between w_from and w_to;

    select coalesce(jsonb_object_agg(c.category_key, c.total), '{}'::jsonb)
      into v_by_cat
      from (
        select coalesce(t.category_key, 'other') as category_key, sum(t.amount) as total
          from public.plaid_transactions t
         where t.owner_id = p_owner
           and not t.pending
           and t.treatment in ('cost', 'refund')
           and t.txn_date between w_from and w_to
         group by 1
      ) c;

    select coalesce(jsonb_object_agg(x.exclude_reason, jsonb_build_object('total', x.total, 'count', x.n)), '{}'::jsonb)
      into v_excluded
      from (
        select coalesce(t.exclude_reason, 'unspecified') as exclude_reason, sum(t.amount) as total, count(*) as n
          from public.plaid_transactions t
         where t.owner_id = p_owner
           and t.treatment = 'excluded'
           and t.txn_date between w_from and w_to
         group by 1
      ) x;

    select coalesce(sum(t.amount), 0)
      into v_pending
      from public.plaid_transactions t
     where t.owner_id = p_owner
       and t.pending
       and t.amount > 0
       and t.txn_date between w_from and w_to;

    result := result || jsonb_build_object(w_key, jsonb_build_object(
      'from', w_from, 'to', w_to,
      'revenue', v_rev, 'revenue_count', v_rev_count,
      'cost', v_cost, 'cost_count', v_cost_count,
      'cost_by_category', v_by_cat,
      'excluded_by_reason', v_excluded,
      'pending_outflow', v_pending
    ));
  end loop;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Function privileges: service role only, except pulse_owner_id()
-- ---------------------------------------------------------------------------
revoke all on function public.pulse_owner_id() from public, anon;
grant execute on function public.pulse_owner_id() to authenticated, service_role;

revoke all on function public.plaid_claim_sync(uuid, integer) from public, anon, authenticated;
revoke all on function public.plaid_release_sync(uuid) from public, anon, authenticated;
revoke all on function public.plaid_commit_cursor(uuid, text, text) from public, anon, authenticated;
revoke all on function public.plaid_slots_used(text) from public, anon, authenticated;
revoke all on function public.pulse_seed_categories(uuid) from public, anon, authenticated;
revoke all on function public.pulse_window_totals(uuid, text, jsonb) from public, anon, authenticated;

grant execute on function public.plaid_claim_sync(uuid, integer) to service_role;
grant execute on function public.plaid_release_sync(uuid) to service_role;
grant execute on function public.plaid_commit_cursor(uuid, text, text) to service_role;
grant execute on function public.plaid_slots_used(text) to service_role;
grant execute on function public.pulse_seed_categories(uuid) to service_role;
grant execute on function public.pulse_window_totals(uuid, text, jsonb) to service_role;