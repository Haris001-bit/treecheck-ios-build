-- Canary-day SQL for Jobber quotes (plan sections 5 and 11.3). Run once in Lovable > Cloud > SQL editor (TreeCheck
-- project) on the morning quotes_on_award is first switched on for Timber, BEFORE switching it on. Needs JS1.
-- It marks every Timber job already in progress as 'manual', so TreeCheck never makes a Jobber quote for it by
-- itself (Leslee may already have quoted it). The office can still use Try again or Link on the job card.
-- In progress means any of: a price pick, an award (climber, ground crew or stump grinder; bid-submit awards the
-- lowest stump price by itself, and that price is the one taken to the homeowner), a hire, or a workflow status of
-- quote_sent, quote_accepted or job_scheduled. A job that already has a row keeps it unchanged, so running this
-- twice adds nothing.
--
-- BEFORE RUNNING: on the line under "with params as", replace TIMBER_OWNER_ID with Timber's company owner id (the
-- owner_contractor_id on Timber's jobs), keeping the quotes around it. Left as it is, the query stops with
-- "invalid input syntax for type uuid" and changes nothing.
--
-- Returns one row: manual_rows_added (rows written now), jobs_in_progress (Timber jobs that match, with or without
-- a row before) and owner_found (false means the id is not a company owner, and nothing was written).
with params as (
  select 'TIMBER_OWNER_ID'::uuid as owner_id
),
company as (
  select p.owner_id from params p where public.get_parent_contractor_id(p.owner_id) = p.owner_id
),
in_progress as (
  select br.id, br.owner_contractor_id
    from public.bid_requests br
    join company c on c.owner_id = br.owner_contractor_id
   where br.quote_pick is not null
      or br.awarded_bid_id is not null
      or br.awarded_ground_bid_id is not null
      or br.awarded_stump_bid_id is not null
      or br.hired_at is not null
      or br.workflow_status in ('quote_sent', 'quote_accepted', 'job_scheduled')
),
added as (
  insert into public.bid_request_quotes (bid_request_id, owner_contractor_id, quote_state, quote_error)
  select ip.id, ip.owner_contractor_id, 'manual', 'in progress before Jobber quotes were switched on'
    from in_progress ip
  on conflict (bid_request_id) do nothing
  returning bid_request_id
)
select (select count(*) from added) as manual_rows_added,
       (select count(*) from in_progress) as jobs_in_progress,
       exists (select 1 from company) as owner_found;
