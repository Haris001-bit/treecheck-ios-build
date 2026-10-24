-- M4: Plaid connection guards, atomic storage and sorter write-back for Financial Pulse, 2026-09-30.
-- Reference SQL. Applied through Lovable (TreeCheck project) exactly as written.
-- Safe to apply twice. Needs M2.
--
-- Plaid's free Trial allows 10 production connections for the whole TreeCheck team, forever (a
-- removed one is not given back), and a connection is used the moment a public token is exchanged.
-- So:
-- * plaid_reserve_slot: one race-proof check before an exchange, under a lock: the company's own
--   limit, the team cap, and "this bank is already linked" (counting connections being made right
--   now). A reservation that never reaches the exchange expires (the owner closed the bank window).
-- * The ledger row becomes 'exchanging' before Plaid is called and never expires in that state, so a
--   connection whose outcome is unclear (network error mid-exchange) is always counted.
-- * plaid_store_item: saves the item, its encrypted access token and the ledger's 'exchanged' state
--   in one transaction. If saving fails, the encrypted token can be parked on the (sealed) ledger row
--   instead of being lost.
-- * plaid_slots_used: made, in-flight and live-reserved connections.
-- * pulse_apply_classifications: writes the sorter's decisions for many transactions in one call.
-- * A per-company sorting lock (pulse_claim_classify / pulse_release_classify) so two syncs of one
--   company never write stale sorting over each other, and a per-item "sync again" flag.
-- * plaid_accounts.count_from_confirmed_at: the owner's explicit count-from choice for each card.

alter table public.plaid_slot_ledger add column if not exists expires_at timestamptz;
alter table public.plaid_slot_ledger add column if not exists link_session_id text;
alter table public.plaid_slot_ledger add column if not exists recovery_ct text;
alter table public.plaid_slot_ledger add column if not exists recovery_iv text;
alter table public.plaid_slot_ledger drop constraint if exists plaid_slot_ledger_status_check;
alter table public.plaid_slot_ledger add constraint plaid_slot_ledger_status_check
  check (status in ('reserved', 'exchanging', 'exchanged', 'failed'));

alter table public.plaid_accounts add column if not exists count_from_confirmed_at timestamptz;
alter table public.plaid_items add column if not exists resync_requested boolean not null default false;
alter table public.pulse_settings add column if not exists classify_lock_until timestamptz;
alter table public.pulse_settings add column if not exists classify_requested boolean not null default false;

drop function if exists public.plaid_reserve_slot(uuid, text, integer, integer);

-- Returns {"ok": true, "ledger_id": n} or {"ok": false, "reason": "..."}; reason is one of
-- 'no_access', 'same_institution', 'company_limit', 'team_limit'.
create or replace function public.plaid_reserve_slot(
  p_owner uuid, p_env text, p_team_cap integer, p_minutes integer, p_institution_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access record;
  v_company integer;
  v_team integer;
  v_id bigint;
begin
  if p_env not in ('sandbox', 'production') then
    raise exception 'plaid_reserve_slot: bad environment %', p_env;
  end if;
  -- One reservation at a time per environment, across every company and browser tab.
  perform pg_advisory_xact_lock(hashtext('pulse_plaid_slot_' || p_env));

  select enabled, plaid_env, max_items into v_access from public.pulse_access where owner_id = p_owner;
  if not found or not v_access.enabled or v_access.plaid_env <> p_env then
    return jsonb_build_object('ok', false, 'reason', 'no_access');
  end if;

  if p_institution_id is not null and (
       exists (select 1 from public.plaid_items i
                where i.owner_id = p_owner and i.plaid_env = p_env and i.institution_id = p_institution_id
                  and i.status <> 'removed' and i.removed_at is null)
    or exists (select 1 from public.plaid_slot_ledger l
                where l.owner_id = p_owner and l.plaid_env = p_env and l.institution_id = p_institution_id
                  and l.removed_at is null
                  and (l.status in ('exchanging', 'exchanged') or (l.status = 'reserved' and l.expires_at > now())))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'same_institution');
  end if;

  -- Live connections plus connections being made right now.
  select (select count(*) from public.plaid_items i
           where i.owner_id = p_owner and i.plaid_env = p_env and i.status <> 'removed' and i.removed_at is null)
       + (select count(*) from public.plaid_slot_ledger l
           where l.owner_id = p_owner and l.plaid_env = p_env and l.removed_at is null
             and (l.status = 'exchanging' or (l.status = 'reserved' and l.expires_at > now())))
    into v_company;
  if v_company >= v_access.max_items then
    return jsonb_build_object('ok', false, 'reason', 'company_limit');
  end if;

  if p_env = 'production' then
    select count(*) into v_team from public.plaid_slot_ledger l
     where l.plaid_env = 'production'
       and (l.status in ('exchanging', 'exchanged') or (l.status = 'reserved' and l.expires_at > now()));
    if v_team >= p_team_cap then
      return jsonb_build_object('ok', false, 'reason', 'team_limit');
    end if;
  end if;

  insert into public.plaid_slot_ledger (owner_id, plaid_env, status, expires_at, institution_id)
  values (p_owner, p_env, 'reserved', now() + make_interval(mins => greatest(p_minutes, 1)), p_institution_id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'ledger_id', v_id);
end;
$$;

-- Made connections, in-flight exchanges and reservations that have not expired, removed
-- connections included (Plaid never gives a Trial connection back).
create or replace function public.plaid_slots_used(p_env text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.plaid_slot_ledger
   where plaid_env = p_env
     and (status in ('exchanging', 'exchanged') or (status = 'reserved' and expires_at > now()));
$$;

-- Saves an exchanged connection in one transaction: the item, its encrypted token, and the ledger
-- row's 'exchanged' state. Returns the item row id. Calling it again for the same item returns the
-- existing row (safe to retry).
create or replace function public.plaid_store_item(
  p_ledger_id bigint, p_owner uuid, p_env text, p_item_id text, p_institution_id text,
  p_institution_name text, p_linked_by uuid, p_ct text, p_iv text, p_key_version integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_item uuid;
begin
  select id into v_item from public.plaid_items where item_id = p_item_id and owner_id = p_owner;
  if v_item is null then
    insert into public.plaid_items (owner_id, plaid_env, item_id, institution_id, institution_name, linked_by, status)
    values (p_owner, p_env, p_item_id, p_institution_id, p_institution_name, p_linked_by, 'active')
    returning id into v_item;
    insert into public.plaid_item_secrets (item_row_id, access_token_ct, access_token_iv, key_version)
    values (v_item, p_ct, p_iv, p_key_version);
  end if;
  update public.plaid_slot_ledger
     set status = 'exchanged', item_id = p_item_id, expires_at = null, recovery_ct = null, recovery_iv = null
   where id = p_ledger_id and owner_id = p_owner;
  if not found then
    raise exception 'plaid_store_item: ledger row % not found for this owner', p_ledger_id;
  end if;
  return v_item;
end;
$$;

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

-- Per-company sorting lock. The lock's expiry time is the holder's token: claim returns it, or null
-- when another sort holds the lock (and records that one more sort is wanted). Release and take act
-- only on the caller's own lock, so a sort that outlived its lock never frees another sort's lock.
-- Release succeeds only when no further sort was requested meanwhile (unless p_drop_request); when it
-- returns false the caller takes the request (pulse_take_classify_request) and sorts again.
create or replace function public.pulse_claim_classify(p_owner uuid, p_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare claimed timestamptz;
begin
  insert into public.pulse_settings (owner_id) values (p_owner) on conflict (owner_id) do nothing;
  update public.pulse_settings
     set classify_lock_until = clock_timestamp() + make_interval(secs => greatest(p_seconds, 1)), classify_requested = false
   where owner_id = p_owner and (classify_lock_until is null or classify_lock_until < now())
  returning classify_lock_until into claimed;
  if claimed is not null then
    return claimed;
  end if;
  update public.pulse_settings set classify_requested = true where owner_id = p_owner;
  return null;
end;
$$;

create or replace function public.pulse_release_classify(p_owner uuid, p_token timestamptz, p_drop_request boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare released boolean;
begin
  update public.pulse_settings
     set classify_lock_until = null,
         classify_requested = classify_requested and not coalesce(p_drop_request, false)
   where owner_id = p_owner and classify_lock_until = p_token
     and (coalesce(p_drop_request, false) or not classify_requested)
  returning true into released;
  return coalesce(released, false);
end;
$$;

create or replace function public.pulse_take_classify_request(p_owner uuid, p_token timestamptz, p_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare renewed timestamptz;
begin
  update public.pulse_settings
     set classify_requested = false, classify_lock_until = clock_timestamp() + make_interval(secs => greatest(p_seconds, 1))
   where owner_id = p_owner and classify_lock_until = p_token
  returning classify_lock_until into renewed;
  return renewed;
end;
$$;

-- Per-item "sync again": set when a webhook arrives while a sync is running; taken (cleared) by the
-- running sync, which then runs once more.
create or replace function public.plaid_take_resync(p_item_row_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare taken boolean;
begin
  update public.plaid_items set resync_requested = false
   where id = p_item_row_id and resync_requested
  returning true into taken;
  return coalesce(taken, false);
end;
$$;

revoke all on function public.plaid_reserve_slot(uuid, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.plaid_slots_used(text) from public, anon, authenticated;
revoke all on function public.plaid_store_item(bigint, uuid, text, text, text, text, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.pulse_apply_classifications(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pulse_claim_classify(uuid, integer) from public, anon, authenticated;
revoke all on function public.pulse_release_classify(uuid, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.pulse_take_classify_request(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.plaid_take_resync(uuid) from public, anon, authenticated;
grant execute on function public.plaid_reserve_slot(uuid, text, integer, integer, text) to service_role;
grant execute on function public.plaid_slots_used(text) to service_role;
grant execute on function public.plaid_store_item(bigint, uuid, text, text, text, text, uuid, text, text, integer) to service_role;
grant execute on function public.pulse_apply_classifications(uuid, jsonb) to service_role;
grant execute on function public.pulse_claim_classify(uuid, integer) to service_role;
grant execute on function public.pulse_release_classify(uuid, timestamptz, boolean) to service_role;
grant execute on function public.pulse_take_classify_request(uuid, timestamptz, integer) to service_role;
grant execute on function public.plaid_take_resync(uuid) to service_role;
