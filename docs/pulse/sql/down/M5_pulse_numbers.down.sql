-- Rollback for M5. Deploy the edge function versions from before M5 first (anything that calls
-- pulse_account_starts fails once it is gone). Safe to run twice.
-- The review flags are lost with the column: re-applying M5 starts every row at false.

drop function if exists public.pulse_account_starts(uuid);

-- pulse_apply_classifications exactly as written in M4_plaid.sql (no review).
-- p_rows: [{"transaction_id", "treatment", "category_key", "exclude_reason", "matched_transaction_id",
-- "classified_by", "rule_id", "sorter_version"}]. Only this owner's rows change, and only rows
-- whose result is different. Returns how many rows changed.
create or replace function public.pulse_apply_classifications(p_owner uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare changed integer;
begin
  update public.plaid_transactions t
     set treatment = r.treatment,
         category_key = r.category_key,
         exclude_reason = r.exclude_reason,
         matched_transaction_id = r.matched_transaction_id,
         classified_by = r.classified_by,
         rule_id = r.rule_id,
         sorter_version = r.sorter_version,
         classified_at = now()
    from jsonb_to_recordset(p_rows) as r(
           transaction_id text, treatment text, category_key text, exclude_reason text,
           matched_transaction_id text, classified_by text, rule_id uuid, sorter_version text)
   where t.owner_id = p_owner
     and t.transaction_id = r.transaction_id
     and (t.treatment, t.category_key, t.exclude_reason, t.matched_transaction_id, t.classified_by,
          t.rule_id, t.sorter_version)
         is distinct from
         (r.treatment, r.category_key, r.exclude_reason, r.matched_transaction_id, r.classified_by,
          r.rule_id, r.sorter_version);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.pulse_apply_classifications(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pulse_apply_classifications(uuid, jsonb) to service_role;

-- pulse_window_totals exactly as written in M2_pulse_core.sql (no M5 keys).
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

revoke all on function public.pulse_window_totals(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.pulse_window_totals(uuid, text, jsonb) to service_role;

alter table public.plaid_transactions drop column if exists review;
