-- M3: Jobber connection upgrade for Financial Pulse, 2026-09-29.
-- Reference SQL. Applied through Lovable (TreeCheck project) exactly as written.
-- Safe to apply twice.
--
-- * Each Jobber connection records which Jobber account it belongs to, so Jobber's
--   notifications are routed to the right company (never "whoever connected last").
-- * One Jobber account can be connected to only one TreeCheck company at a time.
-- * A lock makes sure only one process refreshes a company's Jobber sign-in at a time
--   (Jobber rotates refresh tokens, so two parallel refreshes would disconnect the company).
-- * The OAuth state remembers where to send the owner back after connecting.
-- * Recurring fixed-price jobs remember what each visit is worth.
-- Needs M2 (jobber_jobs).

alter table public.jobber_tokens add column if not exists jobber_account_id text;
alter table public.jobber_tokens add column if not exists refresh_lock_until timestamptz;
alter table public.jobber_tokens add column if not exists disconnected_at timestamptz;

create unique index if not exists jobber_tokens_account_unique
  on public.jobber_tokens (jobber_account_id)
  where jobber_account_id is not null and disconnected_at is null;

alter table public.jobber_oauth_states add column if not exists return_to text;

-- Recurring fixed-price jobs: the job total spread evenly over all of the job's visits.
-- Used for completed-visit revenue and for valuing this month's scheduled visits.
alter table public.jobber_jobs add column if not exists per_visit_amount numeric(14,2);

-- Claim the refresh lock for one company's Jobber sign-in. Returns false if another
-- process holds it. A missing token row also returns false.
create or replace function public.jobber_claim_refresh(p_contractor uuid, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare claimed boolean;
begin
  update public.jobber_tokens
     set refresh_lock_until = now() + make_interval(secs => greatest(p_seconds, 1))
   where contractor_id = p_contractor
     and (refresh_lock_until is null or refresh_lock_until < now())
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function public.jobber_release_refresh(p_contractor uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.jobber_tokens set refresh_lock_until = null where contractor_id = p_contractor;
$$;

revoke all on function public.jobber_claim_refresh(uuid, integer) from public, anon, authenticated;
revoke all on function public.jobber_release_refresh(uuid) from public, anon, authenticated;
grant execute on function public.jobber_claim_refresh(uuid, integer) to service_role;
grant execute on function public.jobber_release_refresh(uuid) to service_role;