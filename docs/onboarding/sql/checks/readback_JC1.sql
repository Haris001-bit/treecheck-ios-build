-- Read-only check after applying JC1. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Every value in "checks" must be true. Nothing is changed and no rows are read (only the database catalog).
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'tables_exist',
      to_regclass('public.jobber_connect_limit') is not null
        and to_regclass('public.jobber_connect_attempts') is not null
        and to_regclass('public.jobber_waitlist') is not null,
    'rls_on',
      coalesce((select bool_and(c.relrowsecurity) = true and count(*) = 3 from pg_class c
                 where c.oid in (to_regclass('public.jobber_connect_limit'), to_regclass('public.jobber_connect_attempts'),
                                 to_regclass('public.jobber_waitlist'))), false),
    'no_policies',
      coalesce(to_regclass('public.jobber_waitlist') is not null
        and not exists (select 1 from pg_policies p where p.schemaname = 'public'
                          and p.tablename in ('jobber_connect_limit', 'jobber_connect_attempts', 'jobber_waitlist')), false),
    'browser_has_no_access',
      coalesce(to_regclass('public.jobber_connect_limit') is not null
        and to_regclass('public.jobber_connect_attempts') is not null
        and to_regclass('public.jobber_waitlist') is not null
        and not exists (
          select 1
            from unnest(array['anon', 'authenticated']) r(role),
                 unnest(array['public.jobber_connect_limit', 'public.jobber_connect_attempts', 'public.jobber_waitlist']) t(name),
                 unnest(array['select', 'insert', 'update', 'delete']) p(priv)
           where has_table_privilege(r.role, t.name, p.priv)), false),
    'browser_cannot_claim',
      coalesce(to_regprocedure('public.jobber_claim_connect(uuid, text, text)') is not null
        and not has_function_privilege('anon', 'public.jobber_claim_connect(uuid, text, text)', 'execute')
        and not has_function_privilege('authenticated', 'public.jobber_claim_connect(uuid, text, text)', 'execute'), false),
    'server_can_claim',
      coalesce(to_regprocedure('public.jobber_claim_connect(uuid, text, text)') is not null
        and has_function_privilege('service_role', 'public.jobber_claim_connect(uuid, text, text)', 'execute')
        and has_table_privilege('service_role', 'public.jobber_waitlist', 'update'), false),
    'claims_one_at_a_time',
      coalesce(pg_get_functiondef(to_regprocedure('public.jobber_claim_connect(uuid, text, text)')) ilike '%pg_advisory_xact_lock%', false),
    'one_settings_row_at_most',
      exists (select 1 from pg_constraint c where c.conrelid = to_regclass('public.jobber_connect_limit') and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ilike '%CHECK (id)%')
  )
)) as jc1_readback;
