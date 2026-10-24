-- M7: loan payments are not costs (Joe Evans, 2026-10-06), 2026-10-06.
-- Reference SQL. Applied through Lovable (TreeCheck project) exactly as written, BEFORE the sorter-6 edge
-- functions are deployed: they store the new reason, and without M7 every bank update would fail.
-- Safe to apply twice. Needs M2.
--
-- * plaid_transactions.exclude_reason gains 'loan_payment': money out with one of Plaid's loan-payment codes
--   (other than the credit card payment code) is left out of costs (sorter-6). Nothing else changes; the
--   stored rows are sorted again at the next bank update or the next "Personal, not business" tap.

alter table public.plaid_transactions drop constraint if exists plaid_transactions_exclude_reason_check;
alter table public.plaid_transactions add constraint plaid_transactions_exclude_reason_check
  check (exclude_reason in
    ('card_payment', 'loan_payment', 'own_transfer', 'personal', 'before_count_from', 'inflow',
     'non_business_account', 'pending'));
