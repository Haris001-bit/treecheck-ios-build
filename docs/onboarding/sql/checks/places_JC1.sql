-- Where the Jobber places stand (JC1). Run in Lovable > Cloud > SQL editor (TreeCheck project), after JC1. Nothing is
-- changed. One row per company that is connected to Jobber, chosen, a test company, holding a place, or on the waitlist.
-- "uses_a_place" rows count towards max_accounts (test companies never do).
with l as (
  select max_accounts, open_to_all, chosen_owner_ids, test_owner_ids from public.jobber_connect_limit where id
), ids as (
  select contractor_id as owner_id from public.jobber_tokens
  union select unnest(chosen_owner_ids) from l
  union select unnest(test_owner_ids) from l
  union select owner_id from public.jobber_waitlist
  union select owner_id from public.jobber_connect_attempts where started_at > now() - interval '30 minutes'
)
select coalesce(nullif(trim(p.company_name), ''), nullif(trim(p.full_name), ''), '(no name)') as company,
       (t.contractor_id is not null and t.disconnected_at is null) as connected,
       not coalesce(ids.owner_id = any (l.test_owner_ids), false)
         and ((t.contractor_id is not null and t.disconnected_at is null)
              or exists (select 1 from public.jobber_connect_attempts a
                          where a.owner_id = ids.owner_id and a.started_at > now() - interval '30 minutes')) as uses_a_place,
       coalesce(ids.owner_id = any (l.chosen_owner_ids), false) as chosen,
       coalesce(ids.owner_id = any (l.test_owner_ids), false) as test_company,
       w.owner_id is not null as on_waitlist,
       w.alerted_at is not null as mark_alerted,
       l.max_accounts,
       l.open_to_all,
       ids.owner_id
  from ids
  cross join l
  left join public.profiles p on p.id = ids.owner_id
  left join public.jobber_tokens t on t.contractor_id = ids.owner_id
  left join public.jobber_waitlist w on w.owner_id = ids.owner_id
 order by uses_a_place desc, chosen desc, company;
