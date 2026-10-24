-- Rollback for M6. Deploy the edge function versions from before M6 first (they read jobber_payments
-- and pulse_revenue_basis). Safe to run twice.
-- The payments imported from Jobber are lost with the table: re-applying M6 imports them again.

-- pulse_window_totals exactly as written in M5_pulse_numbers.sql.
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
      'revenue', v_rev, 'revenue_count', v_rev_count,
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

revoke all on function public.pulse_window_totals(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.pulse_window_totals(uuid, text, jsonb) to service_role;

drop function if exists public.pulse_revenue_basis(uuid);
drop function if exists public.jobber_claim_payments(uuid, integer);
drop function if exists public.jobber_release_payments(uuid, timestamptz, boolean);
drop function if exists public.jobber_take_payments_request(uuid, timestamptz, integer);
drop table if exists public.jobber_payments;

alter table public.jobber_sync_state drop column if exists payments_backfill_next;
alter table public.jobber_sync_state drop column if exists payments_backfill_completed_at;
alter table public.jobber_sync_state drop column if exists payments_refreshed_at;
alter table public.jobber_sync_state drop column if exists payments_lock_until;
alter table public.jobber_sync_state drop column if exists payments_requested;
alter table public.jobber_sync_state drop column if exists payments_error;

-- The old revenue settings: completed-job revenue as Jobber shows it. Rows on the new values go back to
-- the old default first, so the old rule can be put back.
-- Defaults first, so nothing can be saved with 'auto' once the old rule is back. Rows moved to pre_tax
-- by M6 stay there: which ones were on the old default isn't recorded, and Joe chose pre_tax.
alter table public.pulse_settings alter column revenue_basis set default 'job_total';
alter table public.pulse_settings alter column revenue_tax set default 'as_jobber';
alter table public.pulse_settings drop constraint if exists pulse_settings_revenue_basis_check;
update public.pulse_settings set revenue_basis = 'job_total' where revenue_basis in ('auto', 'payments');
alter table public.pulse_settings add constraint pulse_settings_revenue_basis_check
  check (revenue_basis in ('job_total', 'invoiced_total'));
