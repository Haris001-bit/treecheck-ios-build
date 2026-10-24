-- Financial Pulse: real-data check pack (W3-07 tuning, W3-08 milestone 2, W3-12 Joe's numbers).
-- Read-only. Every query is one SELECT. Paste ONE query at a time into Lovable > Cloud > SQL editor
-- (TreeCheck project) and run it. Each covers every company on real banks
-- (pulse_access.plaid_env = 'production'), one company per row group.
--
-- Two kinds of query:
-- * R1 to R10: counts, totals, dates and states only. No payment rows, merchant or payee names,
--   account names or numbers, or balances. OK to paste the results to Claude.
-- * H1 to H6: HARIS ONLY. They list real payments and merchant names so Haris can judge the sorting.
--   Never paste these results to Claude, Lovable or any other AI tool.
--
-- Bank amounts use Plaid's sign: positive = money out, negative = money in. Payments recorded in Jobber
-- (R6, R10) are positive, with refunds and failed bank payments negative.
-- Times are UTC unless a column says local. "Last 90 days" counts in the company's own time zone.
-- Tested against the schema (M1 to M6) in tools/pgtest/test-checks.mjs. R1, R6 and R10 need M6.


-- =====================================================================================
-- R1 (OK to paste to Claude). Companies on real banks: switch, setup, connections used.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       a.enabled,
       a.max_items as bank_limit,
       a.enabled_at,
       s.setup_step,
       s.setup_completed_at,
       s.timezone,
       s.revenue_basis,
       public.pulse_revenue_basis(co.owner_id) as revenue_basis_used,
       s.revenue_tax,
       (select count(*) from public.plaid_items i
         where i.owner_id = co.owner_id and i.status <> 'removed') as banks_linked,
       (select count(*) from public.plaid_slot_ledger l
         where l.owner_id = co.owner_id and l.plaid_env = 'production'
           and (l.status in ('exchanging', 'exchanged') or (l.status = 'reserved' and l.expires_at > now())))
         as trial_connections_used_by_company,
       public.plaid_slots_used('production') as trial_connections_used_all_companies,
       (select count(*) from public.pulse_rules r where r.owner_id = co.owner_id and r.active) as active_rules,
       exists (select 1 from public.jobber_tokens t
                where t.contractor_id = co.owner_id and t.disconnected_at is null) as jobber_connected
  from co
  join public.pulse_access a on a.owner_id = co.owner_id
  left join public.pulse_settings s on s.owner_id = co.owner_id
 order by a.enabled_at nulls last;


-- =====================================================================================
-- R2 (OK to paste to Claude). Each linked bank: state and freshness.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       i.institution_name as bank,
       i.status,
       i.error_code,
       i.linked_at,
       i.initial_update_complete as first_update_done,
       i.historical_update_complete as history_done,
       i.last_successful_update as plaid_last_update,
       i.last_synced_at as pulse_last_sync,
       i.last_webhook_at,
       i.new_accounts_available,
       i.consent_expiration_time,
       (select count(*) from public.plaid_accounts a where a.item_row_id = i.id) as accounts,
       (select count(*) from public.plaid_accounts a where a.item_row_id = i.id and a.is_business) as business_accounts
  from co
  join public.plaid_items i on i.owner_id = co.owner_id
 where i.status <> 'removed'
 order by co.company, i.linked_at;


-- =====================================================================================
-- R3 (OK to paste to Claude). Each account: kind, business or not, count-from date, payroll,
-- and how much history came in. No account names, numbers or balances.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       i.institution_name as bank,
       a.type,
       a.subtype,
       a.holder_category,
       a.is_business,
       a.use_for_payroll,
       a.include_from as count_from,
       a.count_from_confirmed_at is not null as count_from_confirmed,
       a.status,
       (a.balance_available is not null or a.balance_current is not null) as has_balance,
       a.balance_as_of,
       count(t.id) as payments,
       count(t.id) filter (where t.pending) as pending,
       min(t.txn_date) as first_date,
       max(t.txn_date) as last_date
  from co
  join public.plaid_accounts a on a.owner_id = co.owner_id
  join public.plaid_items i on i.id = a.item_row_id and i.status <> 'removed'
  left join public.plaid_transactions t on t.account_row_id = a.id
 group by co.company, i.id, a.id
 order by co.company, i.linked_at, a.type, a.subtype;


-- =====================================================================================
-- R4 (OK to paste to Claude). Milestone 2 checks, one row each: PASS, FAIL, LOOK (Haris checks
-- the H query named in the detail), WAIT (not possible yet) or INFO.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz,
         s.setup_completed_at
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
),
items as (
  select i.* from public.plaid_items i join co on co.owner_id = i.owner_id where i.status <> 'removed'
),
tx as (
  select t.owner_id, t.transaction_id, t.pending, t.txn_date, t.amount, t.treatment, t.exclude_reason,
         t.category_key, t.matched_transaction_id, t.review, a.is_business, a.include_from,
         t.txn_date >= (now() at time zone co.tz)::date - 89 as last_90
    from public.plaid_transactions t
    join public.plaid_accounts a on a.id = t.account_row_id
    join co on co.owner_id = t.owner_id
),
n as (
  select co.owner_id, co.company, co.setup_completed_at,
    (select count(*) from items i where i.owner_id = co.owner_id) as banks,
    (select count(*) from items i where i.owner_id = co.owner_id and i.status <> 'active') as banks_not_active,
    (select count(*) from items i where i.owner_id = co.owner_id and not exists (
       select 1 from public.pulse_events e
        where e.source = 'plaid' and e.event_type = 'TRANSACTIONS.SYNC_UPDATES_AVAILABLE'
          and e.external_id = i.item_id and e.received_at > i.linked_at and e.processed_at is not null))
      as banks_without_update,
    (select count(*) from tx where tx.owner_id = co.owner_id and tx.treatment = 'unsorted') as unsorted,
    -- A pair is both sides pointing at each other, or one side pointing at a partner dated before its
    -- account's count-from date (that partner keeps its own result, before_count_from, by design).
    (select count(*) from tx where tx.owner_id = co.owner_id and tx.exclude_reason = 'card_payment'
        and exists (select 1 from tx p where p.owner_id = tx.owner_id and p.transaction_id = tx.matched_transaction_id
                      and p.exclude_reason = 'card_payment' and p.matched_transaction_id = tx.transaction_id)) as card_mutual_rows,
    (select count(*) from tx where tx.owner_id = co.owner_id and tx.exclude_reason = 'card_payment'
        and exists (select 1 from tx p where p.owner_id = tx.owner_id and p.transaction_id = tx.matched_transaction_id
                      and p.exclude_reason = 'before_count_from')) as card_precount_pairs,
    (select count(*) from tx where tx.owner_id = co.owner_id and tx.exclude_reason = 'card_payment'
        and tx.matched_transaction_id is null) as card_unpaired,
    (select count(*) from tx where tx.owner_id = co.owner_id and tx.exclude_reason = 'card_payment'
        and tx.matched_transaction_id is not null
        and not exists (select 1 from tx p where p.owner_id = tx.owner_id and p.transaction_id = tx.matched_transaction_id
                          and ((p.exclude_reason = 'card_payment' and p.matched_transaction_id = tx.transaction_id)
                               or p.exclude_reason = 'before_count_from'))) as card_broken,
    (select count(*) from tx where tx.owner_id = co.owner_id and tx.pending
        and tx.treatment in ('cost', 'refund')) as pending_counted,
    (select count(*) from tx where tx.owner_id = co.owner_id and tx.include_from is not null
        and tx.txn_date < tx.include_from and tx.treatment in ('cost', 'refund')) as before_count_from_counted,
    (select count(*) from tx where tx.owner_id = co.owner_id and not tx.is_business) as personal_account_rows,
    (select coalesce(sum(tx.amount), 0) from tx where tx.owner_id = co.owner_id and not tx.pending
        and tx.treatment in ('cost', 'refund') and tx.last_90) as cost_90,
    (select coalesce(sum(tx.amount), 0) from tx where tx.owner_id = co.owner_id and not tx.pending
        and tx.treatment in ('cost', 'refund') and coalesce(tx.category_key, 'other') = 'other'
        and tx.last_90) as other_90,
    (select count(*) from tx where tx.owner_id = co.owner_id and not tx.pending and tx.treatment = 'cost'
        and tx.review and tx.last_90) as review_rows_90,
    (select coalesce(sum(tx.amount), 0) from tx where tx.owner_id = co.owner_id and not tx.pending
        and tx.treatment = 'cost' and tx.review and tx.last_90) as review_total_90,
    (select count(*) from tx where tx.owner_id = co.owner_id and not tx.pending and tx.treatment = 'cost'
        and tx.category_key = 'payroll_contractors' and tx.last_90) as payroll_rows_90,
    (select coalesce(sum(tx.amount), 0) from tx where tx.owner_id = co.owner_id and not tx.pending
        and tx.treatment = 'cost' and tx.category_key = 'payroll_contractors' and tx.last_90) as payroll_total_90,
    (select count(*) from tx where tx.owner_id = co.owner_id and not tx.pending
        and tx.exclude_reason = 'inflow' and tx.last_90) as inflow_rows_90,
    (select s.computed_at from public.pulse_snapshots s where s.owner_id = co.owner_id) as computed_at,
    (select s.metrics->'status'->>'level' from public.pulse_snapshots s where s.owner_id = co.owner_id) as status_level
  from co
)
select n.company, c.nr, c.check_name, c.result, c.detail
  from n
  cross join lateral (values
    (1, 'Every linked bank is active',
        case when n.banks = 0 then 'WAIT' when n.banks_not_active = 0 then 'PASS' else 'FAIL' end,
        n.banks || ' bank(s) linked, ' || n.banks_not_active || ' not active (R2 shows which)'),
    (2, 'Plaid''s own update arrived after linking, for every bank',
        case when n.banks = 0 then 'WAIT' when n.banks_without_update = 0 then 'PASS' else 'FAIL' end,
        n.banks_without_update || ' bank(s) with no processed SYNC_UPDATES_AVAILABLE since linking'),
    (3, 'Nothing left unsorted',
        case when n.unsorted = 0 then 'PASS' else 'FAIL' end,
        n.unsorted || ' unsorted payment(s)'),
    (4, 'Card payments paired on both sides',
        case when n.card_broken > 0 then 'FAIL' when n.card_unpaired > 0 then 'LOOK' else 'PASS' end,
        (n.card_mutual_rows / 2 + n.card_precount_pairs) || ' pair(s) (' || n.card_precount_pairs
          || ' with the card side before its count-from date); ' || n.card_unpaired
          || ' without a partner (not counted, see R8 and H2); ' || n.card_broken || ' broken pair(s)'),
    (5, 'No pending payment counted',
        case when n.pending_counted = 0 then 'PASS' else 'FAIL' end,
        n.pending_counted || ' pending payment(s) counted'),
    (6, 'Nothing before an account''s count-from date counted',
        case when n.before_count_from_counted = 0 then 'PASS' else 'FAIL' end,
        n.before_count_from_counted || ' payment(s) before the count-from date counted'),
    (7, 'No payments kept from personal accounts after setup',
        case when n.setup_completed_at is null then 'WAIT' when n.personal_account_rows = 0 then 'PASS' else 'FAIL' end,
        case when n.setup_completed_at is null then 'setup not finished yet; '
             else '' end || n.personal_account_rows || ' payment(s) stored from accounts marked personal'),
    (8, '"Other" under 30% of costs, last 90 days',
        case when n.cost_90 <= 0 then 'WAIT' when n.other_90 / n.cost_90 < 0.30 then 'PASS' else 'LOOK' end,
        case when n.cost_90 <= 0 then 'no costs yet'
             else round(100 * n.other_90 / n.cost_90, 1) || '% of $' || round(n.cost_90) || ' (see H1)' end),
    (9, 'Transfers out to accounts not linked (counted, flagged to review)',
        case when n.review_rows_90 = 0 then 'PASS' else 'LOOK' end,
        n.review_rows_90 || ' payment(s), $' || round(n.review_total_90) || ', last 90 days (see H3)'),
    (10, 'Crew and contractor payouts counted',
        case when n.cost_90 <= 0 then 'WAIT' when n.payroll_rows_90 > 0 then 'PASS' else 'LOOK' end,
        n.payroll_rows_90 || ' payment(s), $' || round(n.payroll_total_90) || ', last 90 days (see H5)'),
    (11, 'Money in left out (revenue comes from Jobber only)',
        'INFO',
        n.inflow_rows_90 || ' deposit(s) not counted, last 90 days (see H4 for any refund among them)'),
    (12, 'Numbers worked out',
        case when n.computed_at is null then 'WAIT' else 'INFO' end,
        coalesce('last ' || to_char(n.computed_at, 'YYYY-MM-DD HH24:MI') || ' UTC, status ' || n.status_level,
                 'not yet: Mark has not opened Pulse since linking'))
  ) as c(nr, check_name, result, detail)
 order by n.company, c.nr;


-- =====================================================================================
-- R5 (OK to paste to Claude). How the money was sorted: every posted payment by how it is
-- treated, why it is left out, its category and the review flag. Last 90 days and all time.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       t.treatment,
       coalesce(t.exclude_reason, '') as left_out_because,
       coalesce(t.category_key, '') as category,
       t.review as to_review,
       count(*) filter (where t.txn_date >= (now() at time zone co.tz)::date - 89) as payments_90d,
       coalesce(sum(t.amount) filter (where t.amount > 0 and t.txn_date >= (now() at time zone co.tz)::date - 89), 0) as money_out_90d,
       coalesce(-sum(t.amount) filter (where t.amount < 0 and t.txn_date >= (now() at time zone co.tz)::date - 89), 0) as money_in_90d,
       count(*) as payments_all,
       coalesce(sum(t.amount) filter (where t.amount > 0), 0) as money_out_all,
       coalesce(-sum(t.amount) filter (where t.amount < 0), 0) as money_in_all
  from co
  join public.plaid_transactions t on t.owner_id = co.owner_id
 where not t.pending
 group by co.company, t.treatment, t.exclude_reason, t.category_key, t.review
 order by co.company, t.treatment, 3, 4, 5;


-- =====================================================================================
-- R6 (OK to paste to Claude). Jobber: import state and what is stored (jobs, and since M6 the payments
-- recorded in Jobber). Compare jobs_completed_by_month with Jobber's own report for the same months.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       exists (select 1 from public.jobber_tokens t
                where t.contractor_id = co.owner_id and t.disconnected_at is null) as connected,
       st.backfill_started_at,
       st.backfill_completed_at,
       st.incremental_watermark as last_check_for_changes,
       st.jobs_seen,
       st.scheduled_status,
       st.scheduled_fetched_at,
       st.granted_scopes,
       left(st.last_error, 120) as last_error,
       (select count(*) from public.jobber_jobs j where j.owner_id = co.owner_id) as jobs_stored,
       (select count(*) from public.jobber_jobs j where j.owner_id = co.owner_id and j.deleted_at is not null) as jobs_deleted,
       (select count(*) from public.jobber_jobs j where j.owner_id = co.owner_id
          and j.deleted_at is null and j.completed_at is not null) as jobs_completed,
       (select count(*) from public.jobber_jobs j where j.owner_id = co.owner_id
          and j.completed_source = 'last_visit') as completed_date_from_last_visit,
       (select count(*) from public.jobber_jobs j where j.owner_id = co.owner_id
          and (j.job_type = 'RECURRING' or j.billing_type = 'VISIT_BASED')) as per_visit_jobs,
       (select count(*) from public.jobber_visit_revenue v where v.owner_id = co.owner_id
          and v.deleted_at is null) as visit_revenue_rows,
       (select count(*) from public.jobber_jobs j where j.owner_id = co.owner_id and j.invoice_count > 0) as jobs_with_invoices,
       (select max(j.synced_at) from public.jobber_jobs j where j.owner_id = co.owner_id) as newest_job_saved,
       st.payments_backfill_completed_at as payments_history_read_at,
       st.payments_refreshed_at,
       (select count(*) from public.jobber_payments p where p.owner_id = co.owner_id and p.deleted_at is null) as payments_stored,
       (select string_agg(m.month || ': ' || m.n || ' / $' || round(m.total), ', ' order by m.month)
          from (select to_char(p.received_at at time zone co.tz, 'YYYY-MM') as month, count(*) as n, sum(p.amount_pre_tax) as total
                  from public.jobber_payments p
                 where p.owner_id = co.owner_id and p.deleted_at is null and p.received_at >= now() - interval '120 days'
                 group by 1) m) as payments_by_month_pre_tax,
       (select string_agg(m.month || ': ' || m.n, ', ' order by m.month)
          from (select to_char(j.completed_at at time zone co.tz, 'YYYY-MM') as month, count(*) as n
                  from public.jobber_jobs j
                 where j.owner_id = co.owner_id and j.deleted_at is null and j.completed_at is not null
                   and j.completed_at >= now() - interval '120 days'
                 group by 1) m) as jobs_completed_by_month
  from co
  left join public.jobber_sync_state st on st.owner_id = co.owner_id
 order by co.company;


-- =====================================================================================
-- R7 (OK to paste to Claude). Monthly totals for Joe, from the same function the Pulse screen uses
-- (pulse_window_totals): the last three complete months and this month so far, in the company's
-- time zone. Revenue follows the company's revenue settings (R1).
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
),
w as (
  select co.owner_id, co.company, co.tz,
         jsonb_agg(jsonb_build_object(
           'key', to_char(m, 'YYYY-MM'),
           'from', m::date,
           'to', least((m + interval '1 month' - interval '1 day')::date, (now() at time zone co.tz)::date))
           order by m) as windows
    from co
    cross join lateral generate_series(date_trunc('month', now() at time zone co.tz) - interval '3 months',
                                       date_trunc('month', now() at time zone co.tz),
                                       interval '1 month') as m
   group by co.owner_id, co.company, co.tz
),
t as (
  select w.company, public.pulse_window_totals(w.owner_id, w.tz, w.windows) as totals from w
)
select t.company, k.key as month, k.v->>'to' as up_to, line.label, line.amount, line.payments
  from t
  cross join lateral jsonb_each(t.totals) as k(key, v)
  cross join lateral (
    select 1 as ord, 'Revenue (Jobber)' as label, (k.v->>'revenue')::numeric as amount,
           (k.v->>'revenue_count')::integer as payments
    union all
    select 2, 'Costs counted', (k.v->>'cost')::numeric, (k.v->>'cost_count')::integer
    union all
    select 3, 'Profit (revenue minus costs)', (k.v->>'revenue')::numeric - (k.v->>'cost')::numeric, null
    union all
    select 10, 'Costs: ' || c.key, c.value::numeric, (k.v->'cost_count_by_category'->>c.key)::integer
      from jsonb_each_text(k.v->'cost_by_category') as c
    union all
    select 20, 'Left out, money out: ' || f.key, (f.value->>'out')::numeric, (f.value->>'out_count')::integer
      from jsonb_each(k.v->'excluded_flow_by_reason') as f
    union all
    select 21, 'Left out, money in: ' || f.key, (f.value->>'in')::numeric, (f.value->>'in_count')::integer
      from jsonb_each(k.v->'excluded_flow_by_reason') as f
    union all
    select 30, 'Pending payments (not counted yet)', (k.v->>'pending_outflow')::numeric, null
    union all
    select 31, 'Transfers to accounts not linked (counted, to review)', (k.v->>'review_total')::numeric,
           (k.v->>'review_count')::integer
  ) as line
 order by t.company, k.key, line.ord, line.label;


-- =====================================================================================
-- R8 (OK to paste to Claude). Card payments with no partner, explained by counts only: older than
-- the linked cards' history, an equal amount on a linked card but further apart than the pairing
-- window, or no equal amount on any linked card (most likely a card that is not linked).
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.card_payment_window_days, 5) as window_days
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
),
card_rows as (
  select t.owner_id, t.txn_date, t.amount
    from public.plaid_transactions t
    join public.plaid_accounts a on a.id = t.account_row_id
   where a.type = 'credit' and not t.pending
),
lone as (
  select t.owner_id, t.txn_date, t.amount, a.type as account_type
    from public.plaid_transactions t
    join public.plaid_accounts a on a.id = t.account_row_id
   where t.exclude_reason = 'card_payment' and t.matched_transaction_id is null
)
select co.company,
       l.account_type as side,
       count(l.*) as without_partner,
       count(*) filter (where l.account_type <> 'credit'
                          and l.txn_date < (select min(c.txn_date) from card_rows c where c.owner_id = co.owner_id))
         as older_than_card_history,
       count(*) filter (where l.account_type <> 'credit'
                          and l.txn_date >= (select min(c.txn_date) from card_rows c where c.owner_id = co.owner_id)
                          and exists (select 1 from card_rows c where c.owner_id = co.owner_id and c.amount = -l.amount
                                        and abs(c.txn_date - l.txn_date) > co.window_days
                                        and abs(c.txn_date - l.txn_date) <= 31))
         as same_amount_on_card_further_apart,
       count(*) filter (where l.account_type <> 'credit'
                          and l.txn_date >= (select min(c.txn_date) from card_rows c where c.owner_id = co.owner_id)
                          and not exists (select 1 from card_rows c where c.owner_id = co.owner_id and c.amount = -l.amount
                                            and abs(c.txn_date - l.txn_date) <= 31))
         as no_equal_amount_on_linked_cards,
       min(l.txn_date) as first_date,
       max(l.txn_date) as last_date,
       round(sum(abs(l.amount))) as total
  from co
  join lone l on l.owner_id = co.owner_id
 group by co.company, co.owner_id, l.account_type
 order by co.company, side;

-- =====================================================================================
-- R9 (OK to paste to Claude). What "other" is made of over the last 90 days: Plaid's category codes,
-- whether the payment is flagged to review (money out that may go to an account that is not linked),
-- and how many different payees are involved. Counts and totals only, no names.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       coalesce(t.pfc_detailed, '(no code)') as plaid_code,
       t.review as to_review,
       a.type as account_type,
       count(*) as payments,
       count(distinct coalesce(nullif(t.merchant_name, ''), nullif(t.counterparty_name, ''), t.name)) as different_payees,
       round(sum(t.amount)) as total,
       min(t.txn_date) as first_date,
       max(t.txn_date) as last_date
  from co
  join public.plaid_transactions t on t.owner_id = co.owner_id
  join public.plaid_accounts a on a.id = t.account_row_id
 where not t.pending
   and t.treatment = 'cost'
   and coalesce(t.category_key, 'other') = 'other'
   and t.txn_date >= (now() at time zone co.tz)::date - 89
 group by co.company, 2, t.review, a.type
 order by co.company, total desc;


-- =====================================================================================
-- R10 (OK to paste to Claude). Payments recorded in Jobber, by month and type, to compare with Jobber's own
-- payments report. The same four months as R7 (the last three complete months and this month so far, up to
-- the up_to date), in the company's time zone. One row for each type that has payments that month (payment,
-- deposit, refund, failed_payment), then a net row with the month's total, shown even when the month has no
-- payments. total_as_jobber is the amount as Jobber shows it, with any sales tax (tips are separate in Jobber
-- and not included). total_without_tax is what Pulse counts as revenue when it counts payments without sales
-- tax (R1). Refunds and failed bank payments are negative. Deleted payments are left out. at_utc_midnight and
-- at_local_midnight count the payments whose time is exactly 00:00:00 in UTC and in the company's time zone,
-- which helps explain a payment dated by day only that lands a day early. R6's payments by month cover a
-- rolling 120 days in whole dollars and are not capped at today, so they won't match R10 exactly. The months
-- move with today's date, like R7's. For Joe's review, once his months have left the window, pin them by
-- replacing the three-line generate_series call (here and in R7) with one line, for July to September 2026:
-- generate_series(timestamp '2026-07-01', timestamp '2026-09-01', interval '1 month')
-- Needs M6. No client names, invoice numbers or payment ids (the company label is the same as in R1).
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
),
months as (
  select co.owner_id, co.company, co.tz,
         m::date as month_start,
         least((m + interval '1 month' - interval '1 day')::date, (now() at time zone co.tz)::date) as up_to
    from co
    cross join lateral generate_series(date_trunc('month', now() at time zone co.tz) - interval '3 months',
                                       date_trunc('month', now() at time zone co.tz),
                                       interval '1 month') as m
),
pay as (
  -- Each month with its payments. A month with none keeps one empty row, for its net row.
  select months.owner_id, months.company, months.tz, months.month_start, months.up_to,
         p.kind, p.amount, p.amount_pre_tax, p.received_at
    from months
    left join public.jobber_payments p
      on p.owner_id = months.owner_id
     and p.deleted_at is null
     and (p.received_at at time zone months.tz)::date between months.month_start and months.up_to
)
select pay.company,
       to_char(pay.month_start, 'YYYY-MM') as month,
       pay.up_to,
       case when grouping(pay.kind) = 1 then 'net (all kinds)' else pay.kind end as kind,
       count(pay.kind) as count,
       round(coalesce(sum(pay.amount), 0), 2) as total_as_jobber,
       round(coalesce(sum(pay.amount_pre_tax), 0), 2) as total_without_tax,
       count(pay.kind) filter (where (pay.received_at at time zone 'UTC')::time = time '00:00:00') as at_utc_midnight,
       count(pay.kind) filter (where (pay.received_at at time zone pay.tz)::time = time '00:00:00') as at_local_midnight
  from pay
 group by grouping sets ((pay.company, pay.owner_id, pay.month_start, pay.up_to, pay.kind),
                         (pay.company, pay.owner_id, pay.month_start, pay.up_to))
having grouping(pay.kind) = 1 or pay.kind is not null
 order by pay.company, pay.owner_id, pay.month_start, grouping(pay.kind),
          array_position(array['payment', 'deposit', 'refund', 'failed_payment'], pay.kind);

-- #####################################################################################
-- HARIS ONLY BELOW THIS LINE. These list real payments and payee names.
-- Read them yourself. Never paste the results to Claude, Lovable or any other AI tool.
-- #####################################################################################


-- =====================================================================================
-- H1 (HARIS ONLY). The biggest payees in "other", last 90 days: candidates for a category rule.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       coalesce(nullif(t.merchant_name, ''), t.name) as payee,
       count(*) as payments,
       sum(t.amount) as total,
       min(t.txn_date) as first_date,
       max(t.txn_date) as last_date,
       string_agg(distinct coalesce(t.pfc_detailed, '-'), ', ') as plaid_codes
  from co
  join public.plaid_transactions t on t.owner_id = co.owner_id
 where not t.pending
   and t.treatment = 'cost'
   and coalesce(t.category_key, 'other') = 'other'
   and t.txn_date >= (now() at time zone co.tz)::date - 89
 group by co.company, 2
 order by total desc
 limit 30;


-- =====================================================================================
-- H2 (HARIS ONLY). Card payments with no partner (left out, flagged). Each should be a payment to
-- a card that is not linked, or a payment whose other half is outside the date window.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company, t.txn_date, a.type as account_type, a.subtype, t.amount, t.name, t.pfc_detailed
  from co
  join public.plaid_transactions t on t.owner_id = co.owner_id
  join public.plaid_accounts a on a.id = t.account_row_id
 where t.exclude_reason = 'card_payment'
   and t.matched_transaction_id is null
 order by co.company, t.txn_date desc
 limit 50;


-- =====================================================================================
-- H3 (HARIS ONLY). Money out that may be going to an account that is not linked: counted as a cost,
-- flagged to review. If one is really a move to the owner's own unlinked account, it needs a rule.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company, t.txn_date, a.type as account_type, a.subtype, t.amount, t.name, t.counterparty_name,
       t.pfc_detailed, t.category_key
  from co
  join public.plaid_transactions t on t.owner_id = co.owner_id
  join public.plaid_accounts a on a.id = t.account_row_id
 where not t.pending
   and t.treatment = 'cost'
   and t.review
 order by co.company, lower(coalesce(t.counterparty_name, t.name)), t.txn_date desc
 limit 500;


-- =====================================================================================
-- H4 (HARIS ONLY). Money in that is left out (revenue comes from Jobber only), biggest payers over
-- the last 90 days. Look for a supplier refund that should have counted.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       coalesce(nullif(t.merchant_name, ''), nullif(t.counterparty_name, ''), t.name) as payer,
       count(*) as deposits,
       -sum(t.amount) as total_in,
       string_agg(distinct coalesce(t.pfc_detailed, '-'), ', ') as plaid_codes
  from co
  join public.plaid_transactions t on t.owner_id = co.owner_id
 where not t.pending
   and t.exclude_reason = 'inflow'
   and t.txn_date >= (now() at time zone co.tz)::date - 89
 group by co.company, 2
 order by total_in desc
 limit 30;


-- =====================================================================================
-- H5 (HARIS ONLY). Crew and contractor payouts, biggest payees over the last 90 days.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company,
       coalesce(nullif(t.counterparty_name, ''), nullif(t.merchant_name, ''), t.name) as payee,
       count(*) as payments,
       sum(t.amount) as total,
       string_agg(distinct t.classified_by, ', ') as sorted_by
  from co
  join public.plaid_transactions t on t.owner_id = co.owner_id
 where not t.pending
   and t.treatment = 'cost'
   and t.category_key = 'payroll_contractors'
   and t.txn_date >= (now() at time zone co.tz)::date - 89
 group by co.company, 2
 order by total desc
 limit 30;


-- =====================================================================================
-- H6 (HARIS ONLY). The 25 biggest costs in the last 30 days, with their category and how they were
-- sorted: a quick look that nothing large is in the wrong place.
-- =====================================================================================
with co as (
  select a.owner_id,
         coalesce(nullif(trim(p.company_name), ''), 'owner ' || left(a.owner_id::text, 8)) as company,
         coalesce(s.timezone, 'America/Chicago') as tz
    from public.pulse_access a
    left join public.profiles p on p.id = a.owner_id
    left join public.pulse_settings s on s.owner_id = a.owner_id
   where a.plaid_env = 'production'
)
select co.company, t.txn_date, a.type as account_type, t.amount, coalesce(nullif(t.merchant_name, ''), t.name) as payee,
       t.category_key, t.classified_by, t.pfc_detailed
  from co
  join public.plaid_transactions t on t.owner_id = co.owner_id
  join public.plaid_accounts a on a.id = t.account_row_id
 where not t.pending
   and t.treatment = 'cost'
   and t.txn_date >= (now() at time zone co.tz)::date - 29
 order by t.amount desc
 limit 25;
