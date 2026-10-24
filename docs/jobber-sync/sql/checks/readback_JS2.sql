-- Read-only check after applying JS2. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Returns one row of true/false values; every column must be true (all_checks_true is true only when all the
-- others are). Nothing is changed and no job or customer rows are read: only the database catalog.
with t as (select to_regclass('public.job_jobber_days') as oid),
f as (
  select to_regprocedure('public.claim_jobber_visit_days(uuid)') as claim,
         to_regprocedure('public.replace_job_jobber_days(uuid,date,date,jsonb)') as repl,
         to_regprocedure('public.calendar_jobs()') as cal
),
checks as (
  select
    (select oid is not null from t) as table_exists,
    coalesce((select c.relrowsecurity from pg_class c, t where c.oid = t.oid), false) as table_rls_on,
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_jobber_days') as table_has_no_policy,
    coalesce((select not has_table_privilege('anon', t.oid, 'select') and not has_table_privilege('anon', t.oid, 'insert')
                 and not has_table_privilege('anon', t.oid, 'update') and not has_table_privilege('anon', t.oid, 'delete')
                 and not has_table_privilege('authenticated', t.oid, 'select') and not has_table_privilege('authenticated', t.oid, 'insert')
                 and not has_table_privilege('authenticated', t.oid, 'update') and not has_table_privilege('authenticated', t.oid, 'delete')
              from t where t.oid is not null), false) as table_closed_to_browsers,
    coalesce((select has_table_privilege('service_role', t.oid, 'select') and has_table_privilege('service_role', t.oid, 'insert')
                 and has_table_privilege('service_role', t.oid, 'delete')
              from t where t.oid is not null), false) as table_open_to_service_role,
    exists (
      select 1 from pg_constraint k, t
       where k.conrelid = t.oid and k.contype = 'p'
         and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
               where a.attrelid = t.oid and a.attnum = any (k.conkey)) = array['bid_request_id', 'day']
    ) as primary_key_job_and_day,
    exists (
      select 1 from pg_constraint k, t
       where k.conrelid = t.oid and k.contype = 'f' and k.confrelid = to_regclass('public.bid_requests') and k.confdeltype = 'c'
    ) as cascades_from_bid_requests,
    (select count(*) = 2 from information_schema.columns
      where table_schema = 'public' and table_name = 'company_jobber_state'
        and column_name in ('visit_days_started_at', 'visit_days_synced_at')) as state_columns_added,
    coalesce((select has_function_privilege('service_role', f.claim, 'execute')
                 and not has_function_privilege('anon', f.claim, 'execute')
                 and not has_function_privilege('authenticated', f.claim, 'execute')
              from f where f.claim is not null), false) as claim_service_role_only,
    coalesce((select has_function_privilege('service_role', f.repl, 'execute')
                 and not has_function_privilege('anon', f.repl, 'execute')
                 and not has_function_privilege('authenticated', f.repl, 'execute')
              from f where f.repl is not null), false) as replace_service_role_only,
    coalesce((select bool_and(coalesce(p.proconfig::text, '') like '%search_path%') from pg_proc p, f
               where p.oid in (f.claim, f.repl)), false) as functions_pin_search_path,
    coalesce((select p.prosrc like '%job_jobber_days%' from pg_proc p, f where p.oid = f.cal), false) as calendar_reads_jobber_days,
    coalesce((select has_function_privilege('authenticated', f.cal, 'execute')
                 and not has_function_privilege('anon', f.cal, 'execute')
              from f where f.cal is not null), false) as calendar_for_signed_in_only
)
select checks.*,
       (table_exists and table_rls_on and table_has_no_policy and table_closed_to_browsers and table_open_to_service_role
        and primary_key_job_and_day and cascades_from_bid_requests and state_columns_added and claim_service_role_only
        and replace_service_role_only and functions_pin_search_path and calendar_reads_jobber_days
        and calendar_for_signed_in_only) as all_checks_true
from checks;
