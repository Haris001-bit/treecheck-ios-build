-- Read-only check after applying PS1. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Every value in "checks" must be true. Nothing is changed and no rows are read (only the database catalog).
with t(name) as (values ('production_rollout'), ('production_settings'), ('production_rate_cards'),
                        ('production_estimates'), ('production_estimate_costs'), ('production_packets')),
browser_only_reads(name) as (values ('production_estimates'), ('production_estimate_costs'), ('production_packets')),
fns(sig) as (values ('public.production_has_key(uuid,text)'), ('public.production_can(uuid,text)'),
                    ('public.production_costs_open(uuid,boolean)'), ('public.production_status()')),
overlay(tbl, n) as (values ('production_labor_roles', 4), ('production_equipment', 4), ('production_pricing', 4),
                           ('production_plans', 3), ('production_pricing_history', 4))
select jsonb_pretty(jsonb_build_object(
  'checks', jsonb_build_object(
    'tables_exist',
      (select bool_and(to_regclass('public.' || name) is not null) from t),
    'rls_on',
      (select bool_and(coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || name)), false)) from t),
    'rollout_sealed',
      case when to_regclass('public.production_rollout') is null then false
           else not has_table_privilege('authenticated', 'public.production_rollout', 'select')
                and not has_table_privilege('authenticated', 'public.production_rollout', 'update')
                and not has_table_privilege('anon', 'public.production_rollout', 'select')
                and has_table_privilege('service_role', 'public.production_rollout', 'update')
                and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'production_rollout') end,
    'browser_only_reads_estimates_costs_packets',
      (select bool_and(case when to_regclass('public.' || name) is null then false
                            else has_table_privilege('authenticated', 'public.' || name, 'select')
                                 and not has_table_privilege('authenticated', 'public.' || name, 'insert')
                                 and not has_table_privilege('authenticated', 'public.' || name, 'update')
                                 and not has_table_privilege('authenticated', 'public.' || name, 'delete') end)
       from browser_only_reads),
    'browser_edits_settings_and_drafts',
      case when to_regclass('public.production_settings') is null or to_regclass('public.production_rate_cards') is null then false
           else has_table_privilege('authenticated', 'public.production_settings', 'insert')
                and has_table_privilege('authenticated', 'public.production_settings', 'update')
                and not has_table_privilege('authenticated', 'public.production_settings', 'delete')
                and has_table_privilege('authenticated', 'public.production_rate_cards', 'insert')
                and has_table_privilege('authenticated', 'public.production_rate_cards', 'delete') end,
    'signed_out_gets_nothing',
      (select bool_and(case when to_regclass('public.' || name) is null then false
                            else not has_table_privilege('anon', 'public.' || name, 'select') end) from t),
    'server_can_write',
      (select bool_and(case when to_regclass('public.' || name) is null then false
                            else has_table_privilege('service_role', 'public.' || name, 'insert')
                                 and has_table_privilege('service_role', 'public.' || name, 'update') end) from t),
    'access_functions_exist',
      (select bool_and(case when to_regprocedure(sig) is null then false
                            else (select p.prosecdef from pg_proc p where p.oid = to_regprocedure(sig))
                                 and has_function_privilege('authenticated', sig, 'execute')
                                 and not has_function_privilege('anon', sig, 'execute') end) from fns),
    'triggers_exist',
      (select count(*) = 5 from pg_trigger g join pg_class c on c.oid = g.tgrelid
       where not g.tgisinternal and g.tgname in ('production_settings_guard', 'production_rate_card_freeze',
         'production_estimate_freeze', 'production_estimate_costs_touch', 'production_packets_touch')),
    'one_version_and_one_draft_per_company',
      exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = 'production_rate_cards_version')
      and exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = 'production_rate_cards_one_draft'),
    'one_estimate_per_jobber_quote_and_number',
      exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = 'production_estimates_jobber_quote')
      and exists (select 1 from pg_constraint k where k.conname = 'production_estimates_number'),
    'one_packet_per_package',
      exists (select 1 from pg_constraint k where k.conname = 'production_packets_one_per_package'),
    'packets_have_no_price_column',
      to_regclass('public.production_packets') is not null
      and not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = 'production_packets'
                        and (c.column_name ilike '%price%' or c.column_name ilike '%cost%' or c.column_name ilike '%total%'
                             or c.column_name ilike '%margin%' or c.column_name ilike '%amount%')),
    'equipment_has_unit',
      exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                and c.table_name = 'production_equipment' and c.column_name = 'unit' and c.column_default like '''hour''%'),
    'cost_overlays_on_marks_tables',
      (select bool_and((select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = o.tbl
                          and p.policyname like 'Production costs layer%' and p.permissive = 'RESTRICTIVE') = o.n)
       from overlay o),
    'new_table_policies',
      (select count(*) = 10 from pg_policies p where p.schemaname = 'public' and p.policyname in (
         'Production settings read', 'Production settings add', 'Production settings change',
         'Production rate cards read', 'Production rate card drafts add', 'Production rate card drafts change',
         'Production rate card drafts remove', 'Production estimates read', 'Production costs read',
         'Production packets read'))
  )
)) as ps1_readback;
