-- Rollback for M3 (Jobber connection upgrade). Deploy the previous edge function versions first,
-- because the upgraded functions read these columns.
drop function if exists public.jobber_release_refresh(uuid);
drop function if exists public.jobber_claim_refresh(uuid, integer);
drop index if exists public.jobber_tokens_account_unique;
alter table public.jobber_jobs drop column if exists per_visit_amount;
alter table public.jobber_oauth_states drop column if exists return_to;
alter table public.jobber_tokens drop column if exists disconnected_at;
alter table public.jobber_tokens drop column if exists refresh_lock_until;
alter table public.jobber_tokens drop column if exists jobber_account_id;
