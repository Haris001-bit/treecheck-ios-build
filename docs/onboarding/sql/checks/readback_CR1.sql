-- Read-only check after applying CR1. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Every value in "checks" must be true. Nothing is changed and no rows are read (only the database catalog).
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'table_exists',
      to_regclass('public.crm_interest_alerts') is not null,
    'rls_on',
      coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.crm_interest_alerts')), false),
    'no_policies',
      coalesce(to_regclass('public.crm_interest_alerts') is not null
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'crm_interest_alerts'), false),
    'browser_has_no_access',
      coalesce(to_regclass('public.crm_interest_alerts') is not null
        and not has_table_privilege('authenticated', 'public.crm_interest_alerts', 'select')
        and not has_table_privilege('authenticated', 'public.crm_interest_alerts', 'insert')
        and not has_table_privilege('authenticated', 'public.crm_interest_alerts', 'delete')
        and not has_table_privilege('anon', 'public.crm_interest_alerts', 'select')
        and not has_table_privilege('anon', 'public.crm_interest_alerts', 'insert'), false),
    'server_can_claim',
      coalesce(to_regclass('public.crm_interest_alerts') is not null
        and has_table_privilege('service_role', 'public.crm_interest_alerts', 'insert')
        and has_table_privilege('service_role', 'public.crm_interest_alerts', 'select')
        and has_table_privilege('service_role', 'public.crm_interest_alerts', 'delete'), false),
    'one_row_per_company_and_crm',
      exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.tablename = 'crm_interest_alerts'
                and i.indexdef ilike '%unique%(contractor_id, crm_key)%')
  )
)) as cr1_readback;
