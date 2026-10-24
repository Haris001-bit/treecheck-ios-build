-- Rollback for CR1. Remove (or stop deploying) the crm-interest-alert function first: without the table it answers 500
-- and alerts nothing. Safe to run twice. Which companies were already flagged is lost, so re-applying CR1 lets each one
-- alert Mark once more the next time it saves its setup.

drop table if exists public.crm_interest_alerts;
