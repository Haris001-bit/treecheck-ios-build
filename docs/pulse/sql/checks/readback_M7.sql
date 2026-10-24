-- Read-only check after applying M7. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Every value in "checks" must be true. Nothing is changed and no finance rows are read (only the database
-- catalog: the rules on plaid_transactions).
with rules as (
  select pg_get_constraintdef(c.oid) as def
    from pg_constraint c
   where c.conrelid = 'public.plaid_transactions'::regclass and c.contype = 'c'
)
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'one_exclude_reason_rule',
      (select count(*) = 1 from rules where def ilike '%exclude_reason%'),
    'exclude_reason_allows_loan_payment',
      coalesce((select bool_and(def ilike '%''loan_payment''%') from rules where def ilike '%exclude_reason%'), false),
    'exclude_reason_keeps_every_older_reason',
      coalesce((select bool_and(def ilike all (array['%''card_payment''%', '%''own_transfer''%', '%''personal''%',
                  '%''before_count_from''%', '%''inflow''%', '%''non_business_account''%', '%''pending''%']))
                  from rules where def ilike '%exclude_reason%'), false),
    'treatment_rule_unchanged',
      coalesce((select bool_and(def ilike all (array['%''cost''%', '%''refund''%', '%''excluded''%', '%''unsorted''%']))
                  from rules where def ilike '%treatment%'), false)
  )
)) as m7_readback;
