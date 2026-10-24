-- Read-only check after applying M5. Run in Lovable > Cloud > SQL editor.
-- Every value in "checks" must be true. Nothing is changed and no finance rows are read
-- (only the database catalog: the review column, the three functions, their rights and code).
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'review_column_boolean_not_null_default_false',
      exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'plaid_transactions' and column_name = 'review'
                 and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'),
    'server_functions_locked',
      (select bool_and(case when to_regprocedure(f) is null then false else
                   not has_function_privilege('authenticated', to_regprocedure(f), 'execute')
                   and not has_function_privilege('anon', to_regprocedure(f), 'execute')
                   and has_function_privilege('service_role', to_regprocedure(f), 'execute') end)
         from (values ('public.pulse_apply_classifications(uuid,jsonb)'),
                      ('public.pulse_window_totals(uuid,text,jsonb)'),
                      ('public.pulse_account_starts(uuid)')) v(f)),
    'server_functions_definer_with_search_path',
      (select bool_and(coalesce((select p.prosecdef and 'search_path=public' = any(p.proconfig)
                                   from pg_proc p where p.oid = to_regprocedure(f)), false))
         from (values ('public.pulse_apply_classifications(uuid,jsonb)'),
                      ('public.pulse_window_totals(uuid,text,jsonb)'),
                      ('public.pulse_account_starts(uuid)')) v(f)),
    'window_totals_has_m5_keys',
      coalesce((select pg_get_functiondef(to_regprocedure('public.pulse_window_totals(uuid,text,jsonb)'))
                       ilike all (array['%excluded_flow_by_reason%', '%cost_count_by_category%', '%review_count%'])), false),
    'apply_classifications_writes_review',
      coalesce((select pg_get_functiondef(to_regprocedure('public.pulse_apply_classifications(uuid,jsonb)'))
                       ilike '%review = coalesce(r.review, false)%'), false),
    'account_starts_returns_jsonb',
      coalesce((select p.prorettype = 'jsonb'::regtype from pg_proc p
                 where p.oid = to_regprocedure('public.pulse_account_starts(uuid)')), false)
  )
)) as pulse_readback_m5;
