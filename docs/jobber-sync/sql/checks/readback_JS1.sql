-- Read-only check after applying JS1. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Returns one row of true/false values; every column must be true (all_checks_true is true only when all the
-- others are). Nothing is changed and no job, price or customer rows are read: only the database catalog.
with expected_tables (name) as (
  values ('company_jobber_settings'), ('company_jobber_state'), ('bid_request_quotes')
),
rel as (
  select e.name, to_regclass('public.' || e.name) as oid from expected_tables e
),
expected_columns (table_name, column_name) as (
  values
    ('company_jobber_settings', 'contractor_id'), ('company_jobber_settings', 'quotes_on_award'),
    ('company_jobber_settings', 'auto_hire'), ('company_jobber_settings', 'book_jobs'),
    ('company_jobber_settings', 'completion_sync'), ('company_jobber_settings', 'free_days'),
    ('company_jobber_settings', 'jobber_import'), ('company_jobber_settings', 'closeout_invoices'),
    ('company_jobber_settings', 'busy_visits_per_day'), ('company_jobber_settings', 'timezone'),
    ('company_jobber_settings', 'default_province'), ('company_jobber_settings', 'quote_template'),
    ('company_jobber_settings', 'change_note'), ('company_jobber_settings', 'created_at'),
    ('company_jobber_settings', 'updated_at'),
    ('company_jobber_state', 'contractor_id'), ('company_jobber_state', 'busy_counts'),
    ('company_jobber_state', 'busy_window_start'), ('company_jobber_state', 'busy_window_end'),
    ('company_jobber_state', 'busy_coverage_end'), ('company_jobber_state', 'busy_fetched_at'),
    ('company_jobber_state', 'busy_fetch_started_at'), ('company_jobber_state', 'throttle_available'),
    ('company_jobber_state', 'throttle_checked_at'), ('company_jobber_state', 'reconciled_at'),
    ('company_jobber_state', 'reconcile_started_at'), ('company_jobber_state', 'digest_sent_on'),
    ('company_jobber_state', 'disconnected_alerted_on'), ('company_jobber_state', 'updated_at'),
    ('bid_request_quotes', 'bid_request_id'), ('bid_request_quotes', 'owner_contractor_id'),
    ('bid_request_quotes', 'sale_price'), ('bid_request_quotes', 'price_source'),
    ('bid_request_quotes', 'pick_option'), ('bid_request_quotes', 'formula_sale'),
    ('bid_request_quotes', 'line_items'), ('bid_request_quotes', 'quote_state'),
    ('bid_request_quotes', 'quote_uncertain'), ('bid_request_quotes', 'quote_trigger'),
    ('bid_request_quotes', 'quote_claimed_at'), ('bid_request_quotes', 'quote_attempts'),
    ('bid_request_quotes', 'quote_error'), ('bid_request_quotes', 'quote_created_at'),
    ('bid_request_quotes', 'previous_quote_ids'), ('bid_request_quotes', 'jobber_client_id'),
    ('bid_request_quotes', 'client_match'), ('bid_request_quotes', 'client_match_ambiguous'),
    ('bid_request_quotes', 'jobber_property_id'), ('bid_request_quotes', 'jobber_quote_status'),
    ('bid_request_quotes', 'jobber_quote_subtotal'), ('bid_request_quotes', 'jobber_quote_discount'),
    ('bid_request_quotes', 'jobber_quote_tax'), ('bid_request_quotes', 'jobber_quote_deposit'),
    ('bid_request_quotes', 'jobber_quote_total'), ('bid_request_quotes', 'quote_approved_at'),
    ('bid_request_quotes', 'quote_checked_at'), ('bid_request_quotes', 'hire_requested_at'),
    ('bid_request_quotes', 'hire_requested_by'), ('bid_request_quotes', 'jobber_job_id'),
    ('bid_request_quotes', 'jobber_job_number'), ('bid_request_quotes', 'job_link_source'),
    ('bid_request_quotes', 'job_state'), ('bid_request_quotes', 'job_claimed_at'),
    ('bid_request_quotes', 'job_error'), ('bid_request_quotes', 'booked_date'),
    ('bid_request_quotes', 'job_checked_at'), ('bid_request_quotes', 'duplicate_job_ids'),
    ('bid_request_quotes', 'office_alerts'), ('bid_request_quotes', 'jobber_completed_at'),
    ('bid_request_quotes', 'completion_synced_at'), ('bid_request_quotes', 'created_at'),
    ('bid_request_quotes', 'updated_at')
),
switch_columns (column_name) as (
  values ('quotes_on_award'), ('auto_hire'), ('book_jobs'), ('completion_sync'), ('free_days'),
         ('jobber_import'), ('closeout_invoices')
),
alert_fn as (
  select to_regprocedure('public.tc_alert_once(uuid,text)') as oid
),
checks as (
  select
    (select count(*) = 3 from rel where rel.oid is not null)
      as tables_exist,
    (select count(*) = (select count(*) from expected_columns)
       from expected_columns ec
       join information_schema.columns c
         on c.table_schema = 'public' and c.table_name = ec.table_name and c.column_name = ec.column_name)
      as columns_present,
    (select count(*) = 3 from rel join pg_class c on c.oid = rel.oid where c.relrowsecurity)
      as rls_on,
    -- Exactly one rule per table, and it is a SELECT rule for signed-in users.
    (select count(*) = 3 from rel
      where (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = rel.name) = 1
        and exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = rel.name and p.cmd = 'SELECT'
                       and p.permissive = 'PERMISSIVE' and p.roles = array['authenticated']::name[]))
      as one_select_policy_each,
    -- The rules read exactly as written: own company for settings and state, the job's office for quotes.
    (select count(*) = 3 from pg_policies p
      where p.schemaname = 'public'
        and ((p.tablename in ('company_jobber_settings', 'company_jobber_state')
              and replace(p.qual, 'public.', '') = '(contractor_id = get_parent_contractor_id(auth.uid()))')
          or (p.tablename = 'bid_request_quotes'
              and replace(p.qual, 'public.', '') = 'is_bid_request_owner(bid_request_id)')))
      as policies_scope_to_own_company,
    (select count(*) = 3 from rel
      where not has_table_privilege('anon', rel.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        and not has_any_column_privilege('anon', rel.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
      as no_anon_grants,
    (select count(*) = 3 from rel
      where has_table_privilege('authenticated', rel.oid, 'SELECT')
        and not has_table_privilege('authenticated', rel.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        and not has_any_column_privilege('authenticated', rel.oid, 'INSERT, UPDATE, REFERENCES'))
      as authenticated_select_only,
    (select count(*) = 3 from rel
      where has_table_privilege('service_role', rel.oid, 'SELECT')
        and has_table_privilege('service_role', rel.oid, 'INSERT')
        and has_table_privilege('service_role', rel.oid, 'UPDATE')
        and has_table_privilege('service_role', rel.oid, 'DELETE'))
      as service_role_reads_and_writes,
    coalesce((select i.indisunique and i.indisvalid and i.indnatts = 1
                     and i.indrelid = to_regclass('public.bid_requests')
                     and pg_get_indexdef(i.indexrelid, 1, true) = 'jobber_quote_id'
                     and pg_get_expr(i.indpred, i.indrelid) = '(jobber_quote_id IS NOT NULL)'
                from pg_index i where i.indexrelid = to_regclass('public.bid_requests_jobber_quote_key')), false)
      as quote_id_unique_when_set,
    coalesce((select i.indisunique and i.indisvalid and i.indnatts = 1
                     and i.indrelid = to_regclass('public.bid_request_quotes')
                     and pg_get_indexdef(i.indexrelid, 1, true) = 'jobber_job_id'
                     and pg_get_expr(i.indpred, i.indrelid) = '(jobber_job_id IS NOT NULL)'
                from pg_index i where i.indexrelid = to_regclass('public.bid_request_quotes_job_key')), false)
      as job_id_unique_when_set,
    coalesce((select i.indisvalid and i.indnatts = 1
                     and i.indrelid = to_regclass('public.bid_request_quotes')
                     and pg_get_indexdef(i.indexrelid, 1, true) = 'owner_contractor_id'
                from pg_index i where i.indexrelid = to_regclass('public.bid_request_quotes_owner_idx')), false)
      as owner_index_exists,
    (select count(*) = 7 from switch_columns s
       join information_schema.columns c
         on c.table_schema = 'public' and c.table_name = 'company_jobber_settings' and c.column_name = s.column_name
      where c.data_type = 'boolean' and c.is_nullable = 'NO' and c.column_default = 'false')
      as switches_default_false,
    -- BEFORE UPDATE FOR EACH ROW (tgtype 2 + 16 + 1) on settings and quotes, calling update_updated_at_column.
    (select count(distinct tg.tgrelid) = 2 from pg_trigger tg
      where tg.tgrelid in (to_regclass('public.company_jobber_settings'), to_regclass('public.bid_request_quotes'))
        and not tg.tgisinternal and tg.tgenabled <> 'D'
        and tg.tgfoid = to_regprocedure('public.update_updated_at_column()')
        and (tg.tgtype::int & 19) = 19)
      as updated_at_triggers,
    coalesce((select p.prosecdef and p.prorettype = 'boolean'::regtype and 'search_path=public' = any(p.proconfig)
                from pg_proc p join alert_fn f on p.oid = f.oid), false)
      as alert_once_definer_with_search_path,
    coalesce((select has_function_privilege('service_role', f.oid, 'EXECUTE')
                     and not has_function_privilege('authenticated', f.oid, 'EXECUTE')
                     and not has_function_privilege('anon', f.oid, 'EXECUTE')
                from alert_fn f where f.oid is not null), false)
      as alert_once_service_role_only
)
select not exists (select 1 from json_each_text(row_to_json(checks)) j where j.value is distinct from 'true')
         as all_checks_true,
       checks.*
  from checks;
