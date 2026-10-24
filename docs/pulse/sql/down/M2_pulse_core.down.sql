-- Rollback for M2 (Financial Pulse core schema).
-- ONLY valid while no production Plaid connection has ever been made: dropping
-- plaid_item_secrets would lose the bank access tokens, and Plaid's free Trial never gives
-- a slot back. After the first production link, roll back by switching Pulse off
-- (pulse_access.enabled = false) and reverting code instead.

do $$
begin
  if to_regclass('public.plaid_slot_ledger') is not null
     and exists (select 1 from public.plaid_slot_ledger
                  where plaid_env = 'production' and status in ('reserved', 'exchanged')) then
    raise exception 'Production Plaid connections exist. Do not drop the Pulse schema; switch Pulse off instead.';
  end if;
end $$;

drop function if exists public.pulse_window_totals(uuid, text, jsonb);
drop function if exists public.pulse_seed_categories(uuid);
drop function if exists public.plaid_slots_used(text);
drop function if exists public.plaid_commit_cursor(uuid, text, text);
drop function if exists public.plaid_release_sync(uuid);
drop function if exists public.plaid_claim_sync(uuid, integer);

drop table if exists public.pulse_events;
drop table if exists public.pulse_snapshots;
drop table if exists public.jobber_sync_state;
drop table if exists public.jobber_visit_revenue;
drop table if exists public.jobber_jobs;
drop table if exists public.plaid_transactions;
drop table if exists public.pulse_rules;
drop table if exists public.plaid_accounts;
drop table if exists public.plaid_slot_ledger;
drop table if exists public.plaid_item_secrets;
drop table if exists public.plaid_items;
drop table if exists public.plaid_link_consents;
drop table if exists public.pulse_categories;
drop table if exists public.pulse_settings;

drop function if exists public.pulse_owner_id();
drop table if exists public.pulse_access;
