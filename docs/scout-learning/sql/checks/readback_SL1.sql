-- Read-only check after applying SL1. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Returns one row of true/false values; every column must be true (all_checks_true is true only when all the
-- others are). Nothing is changed and no customer rows are read: only the database catalog and one count.
with t as (
  select to_regclass('public.estimate_snapshots') as snap, to_regclass('public.scout_learning_runs') as runs
), f as (
  select to_regprocedure('public.scout_learning_claim(uuid,text,text,date)') as claim,
         to_regprocedure('public.scout_learning_finish(uuid,text,jsonb,text)') as finish,
         to_regprocedure('public.scout_learning_surface_report(uuid,text)') as surface,
         to_regprocedure('public.scout_learning_report()') as report,
         to_regprocedure('public.scout_learning_undo(text)') as undo,
         to_regprocedure('public.scout_learning_request_preview(uuid,text)') as preview
), sealed as (
  select c.oid,
         c.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
         and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('anon', c.oid, 'insert')
         and not has_table_privilege('anon', c.oid, 'update') and not has_table_privilege('anon', c.oid, 'delete')
         and not has_table_privilege('authenticated', c.oid, 'select')
         and not has_table_privilege('authenticated', c.oid, 'insert')
         and not has_table_privilege('authenticated', c.oid, 'update')
         and not has_table_privilege('authenticated', c.oid, 'delete')
         and has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert')
         and has_table_privilege('service_role', c.oid, 'update') as ok
    from pg_class c, t where c.oid in (t.snap, t.runs)
), checks as (
  select
    (select snap is not null and runs is not null from t) as tables_exist,
    coalesce((select bool_and(ok) and count(*) = 2 from sealed), false) as tables_sealed_service_role_only,
    (select count(*) = 2 from information_schema.columns
      where table_schema = 'public' and table_name = 'company_settings'
        and column_name in ('scout_learning_enabled', 'scout_learning_website')
        and is_nullable = 'NO' and column_default = 'false') as switches_added_off,
    (select count(*) = 3 from pg_indexes
      where schemaname = 'public' and tablename = 'scout_learning_runs'
        and indexname in ('scout_learning_runs_one_active', 'scout_learning_runs_one_weekly',
                          'scout_learning_runs_one_initial')
        and indexdef ilike 'create unique index%where%') as one_active_weekly_initial,
    exists (select 1 from pg_constraint k, t where k.conrelid = t.snap and k.contype = 'p') as snapshot_key,
    coalesce((select has_function_privilege('service_role', f.claim, 'execute')
                 and not has_function_privilege('anon', f.claim, 'execute')
                 and not has_function_privilege('authenticated', f.claim, 'execute')
                 and has_function_privilege('service_role', f.finish, 'execute')
                 and not has_function_privilege('anon', f.finish, 'execute')
                 and not has_function_privilege('authenticated', f.finish, 'execute')
                 and has_function_privilege('service_role', f.preview, 'execute')
                 and not has_function_privilege('anon', f.preview, 'execute')
                 and not has_function_privilege('authenticated', f.preview, 'execute')
              from f where f.claim is not null and f.finish is not null and f.preview is not null), false)
      as claim_finish_preview_service_role_only,
    coalesce((select not has_function_privilege('anon', f.surface, 'execute')
                 and not has_function_privilege('authenticated', f.surface, 'execute')
              from f where f.surface is not null), false) as surface_report_internal,
    coalesce((select has_function_privilege('authenticated', f.report, 'execute')
                 and not has_function_privilege('anon', f.report, 'execute')
                 and has_function_privilege('authenticated', f.undo, 'execute')
                 and not has_function_privilege('anon', f.undo, 'execute')
              from f where f.report is not null and f.undo is not null), false) as report_undo_signed_in_only,
    coalesce((select bool_and(p.prosecdef) from pg_proc p, f where p.oid in (f.surface, f.report, f.undo)), false)
      as report_undo_security_definer,
    (select count(*) = 0 from public.company_settings cs
      where coalesce((to_jsonb(cs) ->> 'scout_learning_enabled')::boolean, false)
         or coalesce((to_jsonb(cs) ->> 'scout_learning_website')::boolean, false)) as no_company_switched_on_yet
)
select *, (tables_exist and tables_sealed_service_role_only and switches_added_off and one_active_weekly_initial
           and snapshot_key and claim_finish_preview_service_role_only and surface_report_internal
           and report_undo_signed_in_only and report_undo_security_definer and no_company_switched_on_yet)
         as all_checks_true
from checks;
