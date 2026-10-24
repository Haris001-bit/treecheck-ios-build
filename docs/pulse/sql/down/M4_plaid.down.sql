-- Rollback for M4. Deploy the previous edge function versions first (the Plaid functions call these).
-- Refuses while any connection is mid-exchange or has a parked token (resolve those first).

do $$
begin
  if to_regclass('public.plaid_slot_ledger') is not null
     and exists (select 1 from public.plaid_slot_ledger where status = 'exchanging' or recovery_ct is not null) then
    raise exception 'A Plaid connection is mid-exchange or has a parked token. Resolve it before rolling back M4.';
  end if;
end $$;

-- No code can finish a reservation once M4 is gone, and M2's count keeps every 'reserved' row
-- forever: close them (a reservation never used a Plaid connection).
update public.plaid_slot_ledger set status = 'failed' where status = 'reserved';

drop function if exists public.plaid_take_resync(uuid);
drop function if exists public.pulse_take_classify_request(uuid, timestamptz, integer);
drop function if exists public.pulse_release_classify(uuid, timestamptz, boolean);
drop function if exists public.pulse_claim_classify(uuid, integer);
drop function if exists public.pulse_apply_classifications(uuid, jsonb);
drop function if exists public.plaid_store_item(bigint, uuid, text, text, text, text, uuid, text, text, integer);
drop function if exists public.plaid_reserve_slot(uuid, text, integer, integer, text);
drop function if exists public.plaid_reserve_slot(uuid, text, integer, integer);

create or replace function public.plaid_slots_used(p_env text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.plaid_slot_ledger
   where plaid_env = p_env and status in ('reserved', 'exchanged');
$$;
revoke all on function public.plaid_slots_used(text) from public, anon, authenticated;
grant execute on function public.plaid_slots_used(text) to service_role;

alter table public.plaid_slot_ledger drop constraint if exists plaid_slot_ledger_status_check;
alter table public.plaid_slot_ledger add constraint plaid_slot_ledger_status_check
  check (status in ('reserved', 'exchanged', 'failed'));

alter table public.pulse_settings drop column if exists classify_requested;
alter table public.pulse_settings drop column if exists classify_lock_until;
alter table public.plaid_items drop column if exists resync_requested;
alter table public.plaid_accounts drop column if exists count_from_confirmed_at;
alter table public.plaid_slot_ledger drop column if exists recovery_iv;
alter table public.plaid_slot_ledger drop column if exists recovery_ct;
alter table public.plaid_slot_ledger drop column if exists link_session_id;
alter table public.plaid_slot_ledger drop column if exists expires_at;
