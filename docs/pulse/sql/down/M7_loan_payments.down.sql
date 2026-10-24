-- Rollback for M7. Deploy the edge function versions from before sorter-6 first. Safe to run twice.
-- If the screen with "Loan payments aren't counted as costs." was published, revert that change too and Publish it
-- (Mark's OK): until then the screen says the opposite of what is counted.
-- Rows left out as loan payments go back to unsorted (not counted, not shown as costs) until the next bank
-- update sorts them again with the older sorter, which counts them as costs.

update public.plaid_transactions
   set treatment = 'unsorted', exclude_reason = null, classified_by = null, sorter_version = null
 where exclude_reason = 'loan_payment';
alter table public.plaid_transactions drop constraint if exists plaid_transactions_exclude_reason_check;
alter table public.plaid_transactions add constraint plaid_transactions_exclude_reason_check
  check (exclude_reason in
    ('card_payment', 'own_transfer', 'personal', 'before_count_from', 'inflow', 'non_business_account', 'pending'));
