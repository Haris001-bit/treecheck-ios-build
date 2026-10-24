-- Read-only check after applying PL1. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Returns one row of true/false values; every column must be true (all_checks_true is true only when all the others
-- are). Nothing is changed and no customer rows are read: only the database catalog and the one switch row.
with t as (
  select to_regclass('public.billing_rollout') as rollout, to_regclass('public.billing_reminders') as reminders
), sealed as (
  select c.oid,
         c.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
         and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
         and not has_table_privilege('anon', c.oid, 'insert') and not has_table_privilege('authenticated', c.oid, 'insert')
         and not has_table_privilege('anon', c.oid, 'update') and not has_table_privilege('authenticated', c.oid, 'update')
         and has_table_privilege('service_role', c.oid, 'select') and has_table_privilege('service_role', c.oid, 'insert') as ok
    from pg_class c, t where c.oid in (t.rollout, t.reminders)
), r as (
  select count(*) = 1 as one_row, bool_and(not web_live) as web_live_off from public.billing_rollout
), checks as (
  select
    (select rollout is not null and reminders is not null from t) as tables_exist,
    (select count(*) = 2 and bool_and(ok) from sealed) as tables_sealed,
    (select one_row from r) as one_switch_row,
    (select web_live_off from r) as web_live_still_off,
    to_regprocedure('public.billing_rollout_status()') is not null as status_function,
    has_function_privilege('anon', 'public.billing_rollout_status()', 'execute') as status_readable,
    not has_function_privilege('authenticated', 'public.company_past_due_grace(timestamptz,text)', 'execute') as grace_private,
    position('company_past_due_grace' in pg_get_functiondef('public.company_plan(uuid)'::regprocedure)) > 0 as plan_has_grace,
    position('company_past_due_grace' in pg_get_functiondef('public.company_has_permission(uuid,text)'::regprocedure)) > 0 as permission_has_grace,
    not has_function_privilege('authenticated', 'public.company_plan(uuid)', 'execute') as company_plan_still_private
)
select *, (tables_exist and tables_sealed and one_switch_row and web_live_still_off and status_function and status_readable
           and grace_private and plan_has_grace and permission_has_grace and company_plan_still_private) as all_checks_true
from checks;
