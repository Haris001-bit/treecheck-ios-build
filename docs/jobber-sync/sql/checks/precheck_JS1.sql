-- Read-only check BEFORE applying JS1. Run in Lovable > Cloud > SQL editor (TreeCheck project).
-- Counts only: no ids, numbers or customer data are shown.
-- duplicate_quote_ids and jobs_sharing_a_quote_id must both be 0. JS1 makes a Jobber quote id unique across
-- jobs, and while two jobs share one the whole migration fails and changes nothing. If either is not 0, stop
-- and do not apply JS1.
-- js1_tables_present is 0 before the first apply and 3 once JS1 is in.
select count(*) as duplicate_quote_ids,
       coalesce(sum(d.n), 0) as jobs_sharing_a_quote_id,
       (select count(*) from public.bid_requests where jobber_quote_id is not null) as jobs_with_a_quote_id,
       (select count(*)
          from (values ('public.company_jobber_settings'), ('public.company_jobber_state'),
                       ('public.bid_request_quotes')) v(t)
         where to_regclass(v.t) is not null) as js1_tables_present
  from (select br.jobber_quote_id, count(*) as n
          from public.bid_requests br
         where br.jobber_quote_id is not null
         group by br.jobber_quote_id
        having count(*) > 1) d;
