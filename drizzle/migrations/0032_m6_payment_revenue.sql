-- M6: revenue on the day payment is received (plan task W3-10a, Joe's rule 2026-10-05), 2026-10-05.
-- Reference SQL. Applied through Lovable (TreeCheck project) exactly as written.
-- Safe to apply twice. Needs M2 to M5.
--
-- * jobber_payments: money in recorded in Jobber, one row per Jobber payment record: payments and deposits
--   (positive), refunds and failed bank payments (negative), with the same amount without sales tax, worked
--   out from the invoice (or, for a deposit not yet on an invoice, the quote). Jobber's other ledger entries
--   (invoices, corrections, bad debt, voids, opening balances) are not money in and are not stored.
--   Owner-readable (the revenue drill-down), like jobber_jobs; written by the server only.
-- * pulse_settings.revenue_basis gains 'payments' and 'auto' (the new default). 'auto' is Joe's rule: count
--   revenue when payment is received if the company records payments in Jobber, otherwise when the job is
--   completed (pulse_revenue_basis). revenue_tax defaults to 'pre_tax' (Joe: no sales tax). Companies on the
--   old defaults move to the new ones.
-- * jobber_sync_state: progress of the payments import, its lock and its last error (sealed, like the rest
--   of the table); jobber_claim_payments / jobber_release_payments / jobber_take_payments_request keep
--   one payments read at a time per company.
-- * pulse_revenue_basis(owner): the basis actually used: the setting, or for 'auto', once the first Jobber
--   imports are in, 'payments' when payments recorded in Jobber over the last 120 days are at least half of
--   what was invoiced on the jobs completed in those 120 days, else 'job_total'.
-- * pulse_window_totals: revenue from jobber_payments when the basis is 'payments', and each window says
--   the basis it used ('revenue_basis', so the screen's wording always matches its numbers); every other
--   key and rule unchanged.

-- ---------------------------------------------------------------------------
-- 1. Payments recorded in Jobber
-- ---------------------------------------------------------------------------
create table if not exists public.jobber_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  jobber_account_id text not null,
  jobber_payment_id text not null,
  kind text not null check (kind in ('payment', 'deposit', 'refund', 'failed_payment')),
  received_at timestamptz not null,
  amount numeric(14,2) not null,
  amount_pre_tax numeric(14,2) not null,
  jobber_invoice_id text,
  invoice_number text,
  jobber_quote_id text,
  jobber_job_id text,
  job_number integer,
  deleted_at timestamptz,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, jobber_payment_id)
);
create index if not exists jobber_payments_owner_received_idx on public.jobber_payments (owner_id, received_at);

drop trigger if exists jobber_payments_set_updated_at on public.jobber_payments;
create trigger jobber_payments_set_updated_at before update on public.jobber_payments
  for each row execute function public.update_updated_at_column();

alter table public.jobber_payments enable row level security;
revoke all on table public.jobber_payments from public, anon, authenticated;
grant select on table public.jobber_payments to authenticated;
grant all on table public.jobber_payments to service_role;
drop policy if exists "Pulse owner reads own rows" on public.jobber_payments;
create policy "Pulse owner reads own rows" on public.jobber_payments
  for select to authenticated using (owner_id = (select public.pulse_owner_id()));

-- ---------------------------------------------------------------------------
-- 2. Revenue settings: 'auto' (Joe's rule) and no sales tax by default
-- ---------------------------------------------------------------------------
alter table public.pulse_settings drop constraint if exists pulse_settings_revenue_basis_check;
alter table public.pulse_settings add constraint pulse_settings_revenue_basis_check
  check (revenue_basis in ('auto', 'payments', 'job_total', 'invoiced_total'));
alter table public.pulse_settings alter column revenue_basis set default 'auto';
alter table public.pulse_settings alter column revenue_tax set default 'pre_tax';
update public.pulse_settings set revenue_basis = 'auto' where revenue_basis = 'job_total';
update public.pulse_settings set revenue_tax = 'pre_tax' where revenue_tax = 'as_jobber';

-- ---------------------------------------------------------------------------
-- 3. Payments import progress (jobber_sync_state stays sealed)
-- ---------------------------------------------------------------------------
alter table public.jobber_sync_state add column if not exists payments_backfill_next integer;
alter table public.jobber_sync_state add column if not exists payments_backfill_completed_at timestamptz;
alter table public.jobber_sync_state add column if not exists payments_refreshed_at timestamptz;

-- One payments read at a time per company (the same pattern as the sorting lock in M4): a webhook burst
-- becomes one read plus one follow-up, and a request that arrives during a read is never lost.
alter table public.jobber_sync_state add column if not exists payments_lock_until timestamptz;
alter table public.jobber_sync_state add column if not exists payments_requested boolean not null default false;
alter table public.jobber_sync_state add column if not exists payments_error text;

-- Takes the lock (returns its token) or, when another read holds it, asks that read to run once more
-- (returns null).
create or replace function public.jobber_claim_payments(p_owner uuid, p_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare claimed timestamptz;
begin
  insert into public.jobber_sync_state (owner_id) values (p_owner) on conflict (owner_id) do nothing;
  update public.jobber_sync_state
     set payments_lock_until = clock_timestamp() + make_interval(secs => greatest(p_seconds, 1)), payments_requested = false
   where owner_id = p_owner and (payments_lock_until is null or payments_lock_until < now())
  returning payments_lock_until into claimed;
  if claimed is not null then
    return claimed;
  end if;
  update public.jobber_sync_state set payments_requested = true where owner_id = p_owner;
  return null;
end;
$$;

-- Lets go of this read's own lock, unless another read was asked for meanwhile (then false: take the
-- request and read again). p_drop_request lets go regardless and drops the request (errors).
create or replace function public.jobber_release_payments(p_owner uuid, p_token timestamptz, p_drop_request boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare released boolean;
begin
  update public.jobber_sync_state
     set payments_lock_until = null,
         payments_requested = payments_requested and not coalesce(p_drop_request, false)
   where owner_id = p_owner and payments_lock_until = p_token
     and (coalesce(p_drop_request, false) or not payments_requested)
  returning true into released;
  return coalesce(released, false);
end;
$$;

-- Takes a pending request while still holding the lock: clears it and renews the lock (new token).
create or replace function public.jobber_take_payments_request(p_owner uuid, p_token timestamptz, p_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare renewed timestamptz;
begin
  update public.jobber_sync_state
     set payments_requested = false, payments_lock_until = clock_timestamp() + make_interval(secs => greatest(p_seconds, 1))
   where owner_id = p_owner and payments_lock_until = p_token
  returning payments_lock_until into renewed;
  return renewed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The revenue basis actually used
-- ---------------------------------------------------------------------------
create or replace function public.pulse_revenue_basis(p_owner uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_setting text;
  v_invoiced numeric;
  v_paid numeric;
begin
  select s.revenue_basis into v_setting from public.pulse_settings s where s.owner_id = p_owner;
  v_setting := coalesce(v_setting, 'auto');
  if v_setting <> 'auto' then
    return v_setting;
  end if;
  -- Only once the first imports are in (the jobs and the payments history), so a company that is still
  -- loading doesn't flip between the two while its data arrives.
  if not exists (select 1 from public.jobber_sync_state st
                  where st.owner_id = p_owner
                    and st.backfill_completed_at is not null
                    and st.payments_backfill_completed_at is not null) then
    return 'job_total';
  end if;
  -- Joe's rule: payment date when the company records payments in Jobber, else completion.
  select coalesce(sum(j.invoices_nonvoid_total), 0) into v_invoiced
    from public.jobber_jobs j
   where j.owner_id = p_owner
     and j.deleted_at is null
     and j.invoice_count > 0
     and j.completed_at >= now() - interval '120 days';
  select coalesce(sum(p.amount), 0) into v_paid
    from public.jobber_payments p
   where p.owner_id = p_owner
     and p.deleted_at is null
     and p.received_at >= now() - interval '120 days';
  if v_invoiced > 0 and v_paid >= 0.5 * v_invoiced then
    return 'payments';
  end if;
  return 'job_total';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Window totals: revenue from payments when that is the basis (other rules and keys unchanged)
-- ---------------------------------------------------------------------------
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
  v_count_by_cat jsonb;
  v_excluded jsonb;
  v_flow jsonb;
  v_pending numeric;
  v_review_count integer;
  v_review_total numeric;
begin
  -- M6: the basis actually used ('payments', 'job_total' or 'invoiced_total'), see pulse_revenue_basis.
  v_basis := public.pulse_revenue_basis(p_owner);
  select coalesce(s.revenue_tax, 'pre_tax') into v_tax
    from public.pulse_settings s where s.owner_id = p_owner;
  v_tax := coalesce(v_tax, 'pre_tax');

  for w in select * from jsonb_array_elements(p_windows) loop
    w_key := w->>'key';
    w_from := (w->>'from')::date;
    w_to := (w->>'to')::date;

    if v_basis = 'payments' then
      -- M6: money in recorded in Jobber, by the day it was received (refunds and failed bank payments
      -- are negative), without sales tax when revenue_tax is 'pre_tax'.
      select coalesce(sum(case when v_tax = 'pre_tax' then p.amount_pre_tax else p.amount end), 0), count(*)
        into v_rev, v_rev_count
        from public.jobber_payments p
       where p.owner_id = p_owner
         and p.deleted_at is null
         and (p.received_at at time zone p_tz)::date between w_from and w_to;
    else
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
    end if;

    select coalesce(sum(t.amount), 0), count(*)
      into v_cost, v_cost_count
      from public.plaid_transactions t
     where t.owner_id = p_owner
       and not t.pending
       and t.treatment in ('cost', 'refund')
       and t.txn_date between w_from and w_to;

    select coalesce(jsonb_object_agg(c.category_key, c.total), '{}'::jsonb),
           coalesce(jsonb_object_agg(c.category_key, c.n), '{}'::jsonb)
      into v_by_cat, v_count_by_cat
      from (
        select coalesce(t.category_key, 'other') as category_key, sum(t.amount) as total, count(*) as n
          from public.plaid_transactions t
         where t.owner_id = p_owner
           and not t.pending
           and t.treatment in ('cost', 'refund')
           and t.txn_date between w_from and w_to
         group by 1
      ) c;

    select coalesce(jsonb_object_agg(x.exclude_reason, jsonb_build_object('total', x.total, 'count', x.n)), '{}'::jsonb),
           coalesce(jsonb_object_agg(x.exclude_reason, jsonb_build_object(
             'out', x.out_total, 'out_count', x.out_n, 'in', x.in_total, 'in_count', x.in_n)), '{}'::jsonb)
      into v_excluded, v_flow
      from (
        select coalesce(t.exclude_reason, 'unspecified') as exclude_reason,
               sum(t.amount) as total,
               count(*) as n,
               coalesce(sum(t.amount) filter (where t.amount > 0), 0) as out_total,
               count(*) filter (where t.amount > 0) as out_n,
               coalesce(-sum(t.amount) filter (where t.amount < 0), 0) as in_total,
               count(*) filter (where t.amount < 0) as in_n
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

    select count(*), coalesce(sum(t.amount), 0)
      into v_review_count, v_review_total
      from public.plaid_transactions t
     where t.owner_id = p_owner
       and not t.pending
       and t.treatment = 'cost'
       and t.review
       and t.txn_date between w_from and w_to;

    result := result || jsonb_build_object(w_key, jsonb_build_object(
      'from', w_from, 'to', w_to,
      'revenue', v_rev, 'revenue_count', v_rev_count, 'revenue_basis', v_basis,
      'cost', v_cost, 'cost_count', v_cost_count,
      'cost_by_category', v_by_cat,
      'cost_count_by_category', v_count_by_cat,
      'excluded_by_reason', v_excluded,
      'excluded_flow_by_reason', v_flow,
      'pending_outflow', v_pending,
      'review_count', v_review_count,
      'review_total', v_review_total
    ));
  end loop;

  return result;
end;
$$;

revoke all on function public.jobber_claim_payments(uuid, integer) from public, anon, authenticated;
revoke all on function public.jobber_release_payments(uuid, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.jobber_take_payments_request(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.pulse_revenue_basis(uuid) from public, anon, authenticated;
revoke all on function public.pulse_window_totals(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.jobber_claim_payments(uuid, integer) to service_role;
grant execute on function public.jobber_release_payments(uuid, timestamptz, boolean) to service_role;
grant execute on function public.jobber_take_payments_request(uuid, timestamptz, integer) to service_role;
grant execute on function public.pulse_revenue_basis(uuid) to service_role;
grant execute on function public.pulse_window_totals(uuid, text, jsonb) to service_role;