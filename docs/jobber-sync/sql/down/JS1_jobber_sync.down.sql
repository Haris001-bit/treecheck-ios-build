-- Rollback for JS1. Use it only if the tables themselves cause a problem (plan section 11, rollback step 5):
-- switching off, TC_JOBBER_KILL=1 and the revert PRs come first. Safe to run twice.
--
-- FIRST export the counts and record them in CLIENT_LOG, because every row in the three tables is lost. Run this
-- on its own (counts only), and if TreeCheck made any Jobber quotes or jobs, save the JS5 list too (Haris only):
--   select (select count(*) from public.company_jobber_settings) as settings_rows,
--          (select count(*) from public.company_jobber_settings
--            where quotes_on_award or auto_hire or book_jobs or completion_sync
--               or free_days or jobber_import or closeout_invoices) as companies_with_a_switch_on,
--          (select count(*) from public.company_jobber_state) as state_rows,
--          (select count(*) from public.bid_request_quotes) as quote_rows,
--          (select jsonb_object_agg(s.quote_state, s.n)
--             from (select quote_state, count(*) as n from public.bid_request_quotes group by 1) s) as quote_rows_by_state,
--          (select count(*) from public.bid_request_quotes where jobber_job_id is not null) as linked_jobber_jobs;
--
-- Functions deployed later keep working without these tables: every switch reads as off (plan section 2.6).
-- The Jobber quote ids and numbers on bid_requests stay; only their unique index is dropped.

drop function if exists public.tc_alert_once(uuid, text);
drop table if exists public.bid_request_quotes;
drop table if exists public.company_jobber_state;
drop table if exists public.company_jobber_settings;
drop index if exists public.bid_requests_jobber_quote_key;
