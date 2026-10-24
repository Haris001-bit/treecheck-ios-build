-- Read-only check after applying M3. Run in Lovable > Cloud > SQL editor.
-- Every value in "checks" must be true. Nothing is changed and no tokens or finance rows are read
-- (only counts: how many Jobber connections exist and how many still lack an account id).
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'jobber_tokens_new_columns',
      (select count(*) = 3 from information_schema.columns
        where table_schema = 'public' and table_name = 'jobber_tokens'
          and column_name in ('jobber_account_id', 'refresh_lock_until', 'disconnected_at')),
    'one_live_connection_per_jobber_account',
      exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.jobber_tokens_account_unique')
                and i.indisunique and i.indrelid = to_regclass('public.jobber_tokens')
                and pg_get_expr(i.indpred, i.indrelid) ilike '%disconnected_at IS NULL%'),
    'oauth_state_return_to',
      exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name = 'jobber_oauth_states' and column_name = 'return_to'),
    'jobber_jobs_per_visit_amount',
      exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name = 'jobber_jobs' and column_name = 'per_visit_amount'),
    'refresh_lock_functions_server_only',
      (select bool_and(case when to_regprocedure(f) is null then false else
                   not has_function_privilege('authenticated', to_regprocedure(f), 'execute')
                   and not has_function_privilege('anon', to_regprocedure(f), 'execute')
                   and has_function_privilege('service_role', to_regprocedure(f), 'execute') end)
         from (values ('public.jobber_claim_refresh(uuid,integer)'), ('public.jobber_release_refresh(uuid)')) v(f)),
    'browsers_cannot_write_jobber_tokens',
      coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.jobber_tokens')), false)
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jobber_tokens'
                        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
  ),
  'jobber_connections', (select count(*) from public.jobber_tokens),
  'jobber_connections_missing_account_id',
    (select count(*) from public.jobber_tokens where disconnected_at is null and jobber_account_id is null)
)) as pulse_readback_m3;
