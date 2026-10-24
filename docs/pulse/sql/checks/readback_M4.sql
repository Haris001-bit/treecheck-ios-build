-- Read-only check after applying M4. Run in Lovable > Cloud > SQL editor.
-- Every value in "checks" must be true. Nothing is changed and no finance rows are read
-- (only the number of production bank connections used so far).
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'ledger_new_columns',
      (select count(*) = 4 from information_schema.columns
        where table_schema = 'public' and table_name = 'plaid_slot_ledger'
          and column_name in ('expires_at', 'link_session_id', 'recovery_ct', 'recovery_iv')),
    'ledger_allows_exchanging',
      coalesce((select pg_get_constraintdef(c.oid) ilike '%exchanging%' from pg_constraint c
                 where c.conname = 'plaid_slot_ledger_status_check'), false),
    'other_new_columns',
      (select count(*) = 4 from information_schema.columns
        where table_schema = 'public' and (table_name, column_name) in
          (('plaid_accounts', 'count_from_confirmed_at'), ('plaid_items', 'resync_requested'),
           ('pulse_settings', 'classify_lock_until'), ('pulse_settings', 'classify_requested'))),
    'server_functions_locked',
      (select bool_and(case when to_regprocedure(f) is null then false else
                   not has_function_privilege('authenticated', to_regprocedure(f), 'execute')
                   and not has_function_privilege('anon', to_regprocedure(f), 'execute')
                   and has_function_privilege('service_role', to_regprocedure(f), 'execute') end)
         from (values ('public.plaid_reserve_slot(uuid,text,integer,integer,text)'),
                      ('public.plaid_slots_used(text)'),
                      ('public.plaid_store_item(bigint,uuid,text,text,text,text,uuid,text,text,integer)'),
                      ('public.pulse_apply_classifications(uuid,jsonb)'),
                      ('public.pulse_claim_classify(uuid,integer)'),
                      ('public.pulse_release_classify(uuid,timestamptz,boolean)'),
                      ('public.pulse_take_classify_request(uuid,timestamptz,integer)'),
                      ('public.plaid_take_resync(uuid)')) v(f)),
    'old_reserve_signature_gone',
      to_regprocedure('public.plaid_reserve_slot(uuid,text,integer,integer)') is null,
    'slots_used_counts_in_flight_and_live_only',
      coalesce((select pg_get_functiondef(to_regprocedure('public.plaid_slots_used(text)')) ilike '%exchanging%expires_at%'), false),
    'reserve_uses_a_lock',
      coalesce((select pg_get_functiondef(to_regprocedure('public.plaid_reserve_slot(uuid,text,integer,integer,text)')) ilike '%pg_advisory_xact_lock%'), false)
  ),
  'production_connections_used', public.plaid_slots_used('production'),
  'connections_mid_exchange_or_parked',
    (select count(*) from public.plaid_slot_ledger where status = 'exchanging' or recovery_ct is not null)
)) as pulse_readback_m4;
