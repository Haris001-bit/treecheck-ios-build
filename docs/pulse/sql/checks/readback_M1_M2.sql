-- Read-only check after applying M1 and M2. Run in Lovable > Cloud > SQL editor.
-- Every value in "checks" must be true. Nothing is changed and no finance rows are read.
with
owner_tables(t) as (values ('pulse_access'), ('pulse_settings'), ('pulse_categories'), ('pulse_rules'),
  ('plaid_link_consents'), ('plaid_items'), ('plaid_accounts'), ('plaid_transactions'), ('jobber_jobs'),
  ('jobber_visit_revenue'), ('pulse_snapshots')),
sealed_tables(t) as (values ('plaid_item_secrets'), ('plaid_slot_ledger'), ('jobber_sync_state'), ('pulse_events')),
all_tables(t) as (select t from owner_tables union all select t from sealed_tables),
server_fns(f) as (values ('public.plaid_claim_sync(uuid,integer)'), ('public.plaid_release_sync(uuid)'),
  ('public.plaid_commit_cursor(uuid,text,text)'), ('public.plaid_slots_used(text)'),
  ('public.pulse_seed_categories(uuid)'), ('public.pulse_window_totals(uuid,text,jsonb)'))
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'all_15_tables_present',
      (select count(*) = 15 from all_tables a join information_schema.tables i
         on i.table_schema = 'public' and i.table_name = a.t),
    'rls_enabled_on_all',
      (select bool_and(coalesce(c.relrowsecurity, false)) from all_tables a
         left join pg_class c on c.relname = a.t and c.relnamespace = 'public'::regnamespace),
    'sealed_tables_closed_to_browsers',
      (select bool_and(case when to_regclass('public.' || t) is null then false else
                   not has_table_privilege('authenticated', to_regclass('public.' || t), 'select')
                   and not has_table_privilege('anon', to_regclass('public.' || t), 'select') end) from sealed_tables),
    'owner_tables_select_only_for_logged_in',
      (select bool_and(case when to_regclass('public.' || t) is null then false else
                   has_table_privilege('authenticated', to_regclass('public.' || t), 'select')
                   and not has_table_privilege('authenticated', to_regclass('public.' || t), 'insert')
                   and not has_table_privilege('authenticated', to_regclass('public.' || t), 'update')
                   and not has_table_privilege('authenticated', to_regclass('public.' || t), 'delete')
                   and not has_table_privilege('anon', to_regclass('public.' || t), 'select') end) from owner_tables),
    'server_functions_locked',
      (select bool_and(case when to_regprocedure(f) is null then false else
                   not has_function_privilege('authenticated', to_regprocedure(f), 'execute')
                   and not has_function_privilege('anon', to_regprocedure(f), 'execute')
                   and has_function_privilege('service_role', to_regprocedure(f), 'execute') end) from server_fns),
    'pulse_owner_id_callable_when_logged_in',
      case when to_regprocedure('public.pulse_owner_id()') is null then false else
        has_function_privilege('authenticated', to_regprocedure('public.pulse_owner_id()'), 'execute')
        and not has_function_privilege('anon', to_regprocedure('public.pulse_owner_id()'), 'execute') end,
    'no_is_admin_in_finance_policies',
      (select count(*) = 0 from pg_policies p join all_tables a on a.t = p.tablename
        where p.schemaname = 'public'
          and (coalesce(p.qual, '') ilike '%is_admin%' or coalesce(p.with_check, '') ilike '%is_admin%')),
    'no_policies_on_sealed_tables',
      (select count(*) = 0 from pg_policies p join sealed_tables s on s.t = p.tablename where p.schemaname = 'public'),
    'owner_policies_exact',
      (select count(*) = 11 and count(distinct p.tablename) = 11
              and coalesce(bool_and(p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
                  and p.roles = array['authenticated']::name[]
                  and case when p.tablename = 'pulse_access'
                           then p.policyname = 'Pulse owner reads own access row' and p.qual ilike '(owner_id = %uid())'
                           else p.policyname = 'Pulse owner reads own rows'
                                and p.qual ilike '(owner_id = ( SELECT %pulse_owner_id() AS pulse_owner_id))' end), false)
         from pg_policies p join owner_tables o on o.t = p.tablename where p.schemaname = 'public'),
    'profiles_insert_policy_tightened',
      (select coalesce(bool_or(p.with_check ilike '%(id = %uid())%'
                   and p.with_check ilike '%role = ''contractor''%'
                   and p.with_check ilike '%(parent_contractor_id IS NULL)%'
                   and p.with_check ilike '%COALESCE(is_founder, false) = false%'
                   and p.with_check ilike '%COALESCE(credit_balance,%'
                   and p.with_check ilike '%COALESCE(dma_beta_enabled, false) = false%'
                   and p.with_check ilike '%COALESCE(is_sandbox, false) = false%'
                   and p.with_check ilike '%(subscription_tier IS NULL)%'
                   and p.with_check ilike '%(stripe_customer_id IS NULL)%'
                   and p.with_check ilike '%(stripe_subscription_id IS NULL)%'), false)
         from pg_policies p where p.schemaname = 'public' and p.tablename = 'profiles'
          and p.policyname = 'Users can insert their own profile' and p.cmd = 'INSERT'),
    'no_other_profiles_insert_policy',
      not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'profiles'
                    and p.cmd in ('INSERT', 'ALL') and p.permissive = 'PERMISSIVE'
                    and p.policyname <> 'Users can insert their own profile')
  ),
  'finance_policies', (select jsonb_agg(jsonb_build_object('table', p.tablename, 'policy', p.policyname, 'cmd', p.cmd) order by p.tablename)
                         from pg_policies p join all_tables a on a.t = p.tablename where p.schemaname = 'public')
)) as pulse_readback;
