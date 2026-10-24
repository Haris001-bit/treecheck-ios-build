-- Read-only check after applying M6. Run in Lovable > Cloud > SQL editor.
-- Every value in "checks" must be true. Nothing is changed and no finance rows are read
-- (only the database catalog: the payments table, its access rules, the settings rules and the functions).
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'payments_table_rls_on',
      coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.jobber_payments')), false),
    'payments_owner_read_only',
      coalesce(to_regclass('public.jobber_payments') is not null
      and has_table_privilege('authenticated', 'public.jobber_payments', 'select')
      and not has_table_privilege('authenticated', 'public.jobber_payments', 'insert')
      and not has_table_privilege('authenticated', 'public.jobber_payments', 'update')
      and not has_table_privilege('authenticated', 'public.jobber_payments', 'delete')
      and not has_table_privilege('anon', 'public.jobber_payments', 'select'), false),
    'payments_policy_is_owner_predicate_only',
      coalesce((select count(*) = 1 and bool_and(p.cmd = 'SELECT' and p.qual ilike '%pulse_owner_id()%' and p.qual not ilike '%is_admin%')
         from pg_policies p where p.schemaname = 'public' and p.tablename = 'jobber_payments'), false),
    'payments_unique_per_company',
      exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.tablename = 'jobber_payments'
                and i.indexdef ilike '%unique%(owner_id, jobber_payment_id)%'),
    'revenue_basis_allows_auto_and_payments',
      coalesce((select pg_get_constraintdef(c.oid) ilike all (array['%auto%', '%payments%', '%job_total%', '%invoiced_total%'])
                  from pg_constraint c where c.conname = 'pulse_settings_revenue_basis_check'
                   and c.conrelid = 'public.pulse_settings'::regclass), false),
    'revenue_defaults_auto_and_pre_tax',
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pulse_settings'
                and column_name = 'revenue_basis' and column_default ilike '%auto%')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pulse_settings'
                and column_name = 'revenue_tax' and column_default ilike '%pre_tax%'),
    'sync_state_has_payments_progress',
      (select count(*) = 6 from information_schema.columns where table_schema = 'public' and table_name = 'jobber_sync_state'
         and column_name in ('payments_backfill_next', 'payments_backfill_completed_at', 'payments_refreshed_at',
                             'payments_lock_until', 'payments_requested', 'payments_error')),
    'server_functions_locked',
      (select bool_and(case when to_regprocedure(f) is null then false else
                   not has_function_privilege('authenticated', to_regprocedure(f), 'execute')
                   and not has_function_privilege('anon', to_regprocedure(f), 'execute')
                   and has_function_privilege('service_role', to_regprocedure(f), 'execute') end)
         from (values ('public.pulse_revenue_basis(uuid)'), ('public.pulse_window_totals(uuid,text,jsonb)'),
                      ('public.jobber_claim_payments(uuid,integer)'), ('public.jobber_release_payments(uuid,timestamptz,boolean)'),
                      ('public.jobber_take_payments_request(uuid,timestamptz,integer)')) v(f)),
    'server_functions_definer_with_search_path',
      (select bool_and(coalesce((select p.prosecdef and 'search_path=public' = any(p.proconfig)
                                   from pg_proc p where p.oid = to_regprocedure(f)), false))
         from (values ('public.pulse_revenue_basis(uuid)'), ('public.pulse_window_totals(uuid,text,jsonb)'),
                      ('public.jobber_claim_payments(uuid,integer)'), ('public.jobber_release_payments(uuid,timestamptz,boolean)'),
                      ('public.jobber_take_payments_request(uuid,timestamptz,integer)')) v(f)),
    'window_totals_reads_payments',
      coalesce((select pg_get_functiondef(to_regprocedure('public.pulse_window_totals(uuid,text,jsonb)'))
                       ilike all (array['%pulse_revenue_basis(p_owner)%', '%jobber_payments%', '%amount_pre_tax%', '%excluded_flow_by_reason%', '%revenue_basis%'])), false)
  )
)) as pulse_readback_m6;
