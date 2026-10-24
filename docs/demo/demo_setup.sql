-- TreeCheck event demo (milestone 2): sets up the demo company and copies 8 of Timber's Scout jobs into it,
-- with made-up customers. Run it in Lovable > Cloud > SQL editor (TreeCheck project). Safe to run again: each run
-- resets the demo's jobs. It changes only the two demo logins and rows owned by the demo company. It never changes
-- Timber's rows, website posts (dma_published_projects) or photo files. Nothing in it sends a text, email or push.
-- The last statement prints one read-back row; send that row to Claude.
--
-- Demo owner   914561d0-fba3-4b90-97b7-673ed8e8b458 (company "Timber Demo")
-- Demo climber 4de5dd88-5c08-4732-b108-64cd62d626a2
-- Timber       705cecc2-5926-48c1-a728-b3ebd6b920a2 (copied from, read-only)

begin;

create temp table demo_ids on commit drop as
select '914561d0-fba3-4b90-97b7-673ed8e8b458'::uuid as owner_id,
       '4de5dd88-5c08-4732-b108-64cd62d626a2'::uuid as climber_id,
       '705cecc2-5926-48c1-a728-b3ebd6b920a2'::uuid as timber_id;

do $$
begin
  if (select count(*) from public.profiles p join demo_ids d on p.id in (d.owner_id, d.climber_id)) <> 2 then
    raise exception 'The two demo logins are missing: nothing was changed.';
  end if;
end $$;

-- Replaces a customer's name, street, phone numbers and emails in free text with the made-up ones.
-- Name words are matched case-sensitively, so a tree word like "ash" in the notes is left alone.
create or replace function pg_temp.scrub(t text, real_name text, real_street text, fake_name text, fake_street text, fake_phone text)
returns text language plpgsql as $f$
declare
  w text;
  i int := 0;
begin
  if t is null then return null; end if;
  if coalesce(trim(real_street), '') <> '' then t := replace(t, trim(real_street), fake_street); end if;
  if coalesce(trim(real_name), '') <> '' then t := replace(t, trim(real_name), fake_name); end if;
  foreach w in array regexp_split_to_array(coalesce(trim(real_name), ''), '\s+') loop
    i := i + 1;
    if w ~ '^[A-Za-z]{3,}$' then
      t := regexp_replace(t, '\m' || w || '\M',
        case when i = 1 then split_part(fake_name, ' ', 1) else split_part(fake_name, ' ', 2) end, 'g');
    end if;
  end loop;
  t := regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'their email', 'g');
  t := regexp_replace(t, '\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}', fake_phone, 'g');
  return t;
end $f$;

-- 1. The two logins: sandbox (the off switch), no phone numbers, no service area.
update public.profiles p
   set is_sandbox = true, dma_beta_enabled = true, phone = null, crew_auto_broadcast = false,
       account_type = 'company', full_name = 'Demo Owner', company_name = 'Timber Demo'
  from demo_ids d where p.id = d.owner_id;
update public.profiles p
   set is_sandbox = true, account_type = 'subcontractor', phone = null, crew_auto_broadcast = false,
       full_name = 'Demo Climber'
  from demo_ids d where p.id = d.climber_id;
delete from public.service_areas s using demo_ids d where s.contractor_id in (d.owner_id, d.climber_id);

insert into public.company_settings (contractor_id, sub_usage, auto_broadcast, onboarding_completed_at)
select owner_id, 'sometimes', false, now() from demo_ids
on conflict (contractor_id) do update
   set sub_usage = excluded.sub_usage, auto_broadcast = false,
       onboarding_completed_at = coalesce(public.company_settings.onboarding_completed_at, now());

delete from public.product_entitlements e using demo_ids d where e.contractor_id in (d.owner_id, d.climber_id);
insert into public.product_entitlements (contractor_id, product, status, metadata)
select owner_id, 'scout', 'active', '{"source": "event demo"}'::jsonb from demo_ids
union all
select climber_id, 'crew_membership', 'active', '{"source": "event demo"}'::jsonb from demo_ids;

delete from public.scout_rate_cards r using demo_ids d where r.contractor_id = d.owner_id;
insert into public.scout_rate_cards (contractor_id, chipper_rate, chipper_rate_type, climber_hourly, crane_hourly,
  crane_mobilization_fee, disposal_per_load, ground_crew_hourly, markup_pct, minimum_job_price, rigging_advanced_pct,
  rigging_intermediate_pct, stump_base_inches, stump_base_price, stump_per_inch)
select d.owner_id, r.chipper_rate, r.chipper_rate_type, r.climber_hourly, r.crane_hourly, r.crane_mobilization_fee,
  r.disposal_per_load, r.ground_crew_hourly, r.markup_pct, r.minimum_job_price, r.rigging_advanced_pct,
  r.rigging_intermediate_pct, r.stump_base_inches, r.stump_base_price, r.stump_per_inch
from public.scout_rate_cards r join demo_ids d on r.contractor_id = d.timber_id;

-- 2. Reset: only the demo company's own jobs, Scout captures and crew.
delete from public.bid_requests b using demo_ids d where b.owner_contractor_id = d.owner_id;
delete from public.scout_captures c using demo_ids d
 where c.owner_id = d.owner_id or c.contractor_id in (d.owner_id, d.climber_id);
delete from public.crew_members m using demo_ids d where m.owner_contractor_id = d.owner_id;

-- 3. Crew: the demo climber, plus 5 made-up crew members with no phone, email or login.
create temp table climber_row on commit drop as select gen_random_uuid() as id;
insert into public.crew_members (id, owner_contractor_id, user_id, full_name, trade, status, phone, email,
  rating_avg, rating_count, jobs_completed, insured, years_climbing, tree_experience_level)
select c.id, d.owner_id, d.climber_id, 'Demo Climber', 'climber', 'active', null, null, 4.8, 23, 31, 'yes', 9, 'experienced'
from climber_row c, demo_ids d;

create temp table fake_crew on commit drop as
select v.k, gen_random_uuid() as id, v.full_name, v.trade, v.rating, v.jobs
from (values
  (1, 'Jordan Reyes', 'climber', 4.9, 42),
  (2, 'Casey Bennett', 'climber', 4.6, 18),
  (3, 'Tyler Brooks', 'both', 4.7, 27),
  (4, 'Morgan Ellis', 'ground', 4.5, 12),
  (5, 'Riley Cooper', 'climber', 4.3, 9)
) as v(k, full_name, trade, rating, jobs);
insert into public.crew_members (id, owner_contractor_id, user_id, full_name, trade, status, phone, email,
  rating_avg, rating_count, jobs_completed)
select f.id, d.owner_id, null, f.full_name, f.trade, 'active', null, null, f.rating, f.jobs, f.jobs
from fake_crew f, demo_ids d;

insert into public.crew_profiles (user_id, network_visible, home_city)
select climber_id, false, 'Edmond' from demo_ids
on conflict (user_id) do update set network_visible = false;

-- 4. Timber's 8 newest Scout jobs, with made-up customers.
create temp table src_jobs on commit drop as
select r.*, row_number() over (order by r.created_at desc) as n
from public.bid_requests r join demo_ids d on r.owner_contractor_id = d.timber_id
where r.capture_id is not null
order by r.created_at desc
limit 8;

create temp table fake on commit drop as
select * from (values
  (1, 'Dana Whitfield', '(405) 555-0101', '1418 Willow Bend Ct'),
  (2, 'Marcus Hale', '(405) 555-0102', '907 Copper Ridge Dr'),
  (3, 'Lena Ortiz', '(405) 555-0103', '2210 Stonebrook Ln'),
  (4, 'Grant Mercer', '(405) 555-0104', '615 Cedar Crest Way'),
  (5, 'Priya Nolan', '(405) 555-0105', '3307 Bluestem Ct'),
  (6, 'Owen Castillo', '(405) 555-0106', '1122 Prairie Wind Dr'),
  (7, 'Hannah Pruitt', '(405) 555-0107', '840 Red Oak Trl'),
  (8, 'Victor Lang', '(405) 555-0108', '2903 Sandhill Cir')
) as v(n, name, phone, street);

create temp table job_map on commit drop as
select s.id as old_id, gen_random_uuid() as new_id, s.capture_id as old_capture_id, gen_random_uuid() as new_capture_id, s.n
from src_jobs s;

insert into public.scout_captures (id, contractor_id, owner_id, status, approved_at, created_at, photo_path, photo_paths,
  trees, customer_name, customer_phone, customer_email, address_street, address_city, address_state, address_zip,
  notes_raw, notes_summary, ai_notes, final_notes, ai_service, final_service, requested_service, ai_price_min,
  ai_price_max, final_price_min, final_price_max, ai_difficulty, ai_risk, price_source, circumference_inches,
  diameter_inches, voice_memo_path, promoted_lead_id, wk_breakdown, wk_chipper, wk_chipper_amount,
  wk_climber_required, wk_crane_hours, wk_crane_required, wk_extras_amount, wk_extras_note, wk_ground_crew,
  wk_hours, wk_loads, wk_rigging_level, wk_stump, wk_stump_diameter_inches, wk_total)
select j.new_capture_id, d.owner_id, d.owner_id, 'approved', coalesce(c.approved_at, c.created_at), c.created_at,
  c.photo_path, c.photo_paths,
  pg_temp.scrub(c.trees::text, c.customer_name, c.address_street, f.name, f.street, f.phone)::jsonb,
  f.name, f.phone, null, f.street, c.address_city, c.address_state, c.address_zip,
  null,
  pg_temp.scrub(c.notes_summary, c.customer_name, c.address_street, f.name, f.street, f.phone),
  pg_temp.scrub(c.ai_notes, c.customer_name, c.address_street, f.name, f.street, f.phone),
  pg_temp.scrub(c.final_notes, c.customer_name, c.address_street, f.name, f.street, f.phone),
  c.ai_service, c.final_service, c.requested_service, c.ai_price_min, c.ai_price_max, c.final_price_min,
  c.final_price_max, c.ai_difficulty, c.ai_risk, c.price_source, c.circumference_inches, c.diameter_inches,
  null, null, pg_temp.scrub(c.wk_breakdown::text, c.customer_name, c.address_street, f.name, f.street, f.phone)::jsonb, c.wk_chipper, c.wk_chipper_amount, c.wk_climber_required, c.wk_crane_hours,
  c.wk_crane_required, c.wk_extras_amount,
  pg_temp.scrub(c.wk_extras_note, c.customer_name, c.address_street, f.name, f.street, f.phone),
  c.wk_ground_crew, c.wk_hours, c.wk_loads, c.wk_rigging_level, c.wk_stump, c.wk_stump_diameter_inches, c.wk_total
from job_map j
join public.scout_captures c on c.id = j.old_capture_id
join fake f on f.n = j.n
cross join demo_ids d;

insert into public.bid_requests (id, owner_contractor_id, capture_id, created_at, created_by, title, description, city,
  customer_name, customer_phone, customer_address, trees, photo_path, photo_paths, status, workflow_status, audience,
  role_needed, pay_mode, fixed_pay, fixed_pay_type, ground_pay_per_worker, equipment_needed, crew_counts,
  needs_stump_grinding, stump_diameter_inches, needs_site_visit, site_visit_done_at, target_margin_pct, owner_cost,
  pricing_inputs, offered_dates, confirmed_dates, climber_dates_status, awarded_date, awarded_ground_date, deadline_at,
  hired_at, quote_sent_at, discount_quote_sent_at, first_refusal_released_at, lead_id, jobber_quote_id,
  jobber_quote_number, quote_status, owner_notes, workflow_notes, visit_text_body)
select j.new_id, d.owner_id,
  case when c.id is null then null else j.new_capture_id end,
  r.created_at, null,
  coalesce(nullif(c.final_service, ''), nullif(c.ai_service, ''), nullif(c.requested_service, ''), 'Tree job')
    || coalesce(' in ' || nullif(r.city, ''), ''),
  pg_temp.scrub(r.description, coalesce(r.customer_name, c.customer_name),
    coalesce(c.address_street, split_part(r.customer_address, ',', 1)), f.name, f.street, f.phone),
  r.city, f.name, f.phone, f.street || coalesce(', ' || nullif(r.city, ''), ''),
  pg_temp.scrub(r.trees::text, coalesce(r.customer_name, c.customer_name),
    coalesce(c.address_street, split_part(r.customer_address, ',', 1)), f.name, f.street, f.phone)::jsonb,
  r.photo_path, r.photo_paths, r.status, r.workflow_status, r.audience, r.role_needed, r.pay_mode, r.fixed_pay,
  r.fixed_pay_type, r.ground_pay_per_worker, r.equipment_needed, r.crew_counts, r.needs_stump_grinding,
  r.stump_diameter_inches, r.needs_site_visit, r.site_visit_done_at, r.target_margin_pct, r.owner_cost,
  r.pricing_inputs, r.offered_dates, r.confirmed_dates, r.climber_dates_status, r.awarded_date, r.awarded_ground_date,
  r.deadline_at, r.hired_at, r.quote_sent_at, r.discount_quote_sent_at, coalesce(r.first_refusal_released_at, now()),
  null, null, null, null, null, null, null
from job_map j
join src_jobs r on r.id = j.old_id
join fake f on f.n = j.n
left join public.scout_captures c on c.id = j.old_capture_id
cross join demo_ids d;

-- 5. Offers: at most 5 per role per job, moved to the made-up crew (no notes).
create temp table bid_map on commit drop as
select b.id as old_id, gen_random_uuid() as new_id, j.new_id as new_job,
  row_number() over (partition by b.bid_request_id, coalesce(b.bid_role, '') order by b.created_at) as rn
from public.bids b join job_map j on j.old_id = b.bid_request_id;
delete from bid_map where rn > 5;

insert into public.bids (id, bid_request_id, crew_member_id, bid_role, ideal_pay, min_pay, status, available_dates,
  crew_size, equipment, est_disposal_loads, est_hours, ground_crew_size, mini_skid_hours, needs_mini_skid,
  people_count, rate_type, notes, created_at)
select m.new_id, m.new_job, fc.id, b.bid_role, b.ideal_pay, b.min_pay, b.status, b.available_dates, b.crew_size,
  b.equipment, b.est_disposal_loads, b.est_hours, b.ground_crew_size, b.mini_skid_hours, b.needs_mini_skid,
  b.people_count, b.rate_type, null, b.created_at
from bid_map m
join public.bids b on b.id = m.old_id
join fake_crew fc on fc.k = m.rn;

-- The awards and the picked price point at the copied offers.
update public.bid_requests r
   set awarded_bid_id = (select m.new_id from bid_map m where m.old_id = s.awarded_bid_id),
       awarded_ground_bid_id = (select m.new_id from bid_map m where m.old_id = s.awarded_ground_bid_id),
       awarded_stump_bid_id = (select m.new_id from bid_map m where m.old_id = s.awarded_stump_bid_id),
       quote_pick = case when s.quote_pick is null then null else
         jsonb_set(jsonb_set(s.quote_pick::jsonb, '{bid_id}',
           coalesce(to_jsonb((select m.new_id from bid_map m where m.old_id::text = s.quote_pick::jsonb ->> 'bid_id')), 'null'::jsonb)),
           '{picked_by_name}', '"Demo Owner"'::jsonb) end
  from job_map j join src_jobs s on s.id = j.old_id
 where r.id = j.new_id;

-- 6. The 2 newest jobs reopen for live bidding at the booth. Their days start after the event (2026-11-11 to
-- 2026-11-14), so they are still ahead at the booth whenever this runs.
create temp table next_days on commit drop as
select to_char(x.d, 'YYYY-MM-DD') as day, row_number() over (order by x.d) as k
from generate_series(greatest(current_date, date '2026-11-14') + 2, greatest(current_date, date '2026-11-14') + 21,
  interval '1 day') as x(d)
where extract(isodow from x.d) < 6;

update public.bid_requests r
   set status = 'open', workflow_status = 'open', awarded_bid_id = null, awarded_ground_bid_id = null,
       awarded_stump_bid_id = null, awarded_date = null, awarded_ground_date = null, hired_at = null,
       quote_pick = null, quote_sent_at = null, climber_dates_status = null, confirmed_dates = '[]'::jsonb,
       deadline_at = (greatest(current_date, date '2026-11-14') + 7)::timestamptz,
       offered_dates = (select jsonb_agg(day order by k) from next_days where k <= 4)
  from job_map j where r.id = j.new_id and j.n <= 2;
update public.bids b
   set status = 'submitted', available_dates = (select jsonb_agg(day order by k) from next_days where k <= 4)
  from job_map j where b.bid_request_id = j.new_id and j.n <= 2;

-- 7. The demo climber wins up to 3 of the awarded jobs, with confirmed days ahead.
create temp table climber_wins on commit drop as
select r.id as job_id, r.awarded_bid_id as bid_id
from public.bid_requests r join job_map j on j.new_id = r.id
where j.n > 2 and r.awarded_bid_id is not null
order by j.n
limit 3;
update public.bids b
   set crew_member_id = (select id from climber_row),
       available_dates = (select jsonb_agg(day order by k) from next_days where k between 3 and 4)
  from climber_wins w where b.id = w.bid_id;
update public.bid_requests r
   set climber_dates_status = 'confirmed',
       confirmed_dates = (select jsonb_agg(day order by k) from next_days where k between 3 and 4),
       awarded_date = (select day::date from next_days where k = 3)
  from climber_wins w where r.id = w.job_id;

insert into public.bid_request_recipients (bid_request_id, crew_member_id, notified_at)
select r.id, (select id from climber_row), now()
from public.bid_requests r join job_map j on j.new_id = r.id
where j.n <= 2 or r.id in (select job_id from climber_wins)
on conflict do nothing;

-- 8. Timers, so no reminder sweep acts on a copied job.
update public.bid_requests r
   set first_refusal_until = null,
       first_refusal_released_at = coalesce(r.first_refusal_released_at, now()),
       climber_dates_requested_at = null,
       climber_dates_reminded_at = now(),
       climber_dates_status = case when r.climber_dates_status = 'requested' then 'confirmed' else r.climber_dates_status end,
       quote_followup_alerted_at = case when r.workflow_status = 'quote_sent' then now() else r.quote_followup_alerted_at end
  from job_map j where r.id = j.new_id;

-- 9. Scout learning for the booth (milestone 4, added 2026-10-22): the switch on and a first report, so the Scout
-- screen's learning card shows what the weekly loop does. Its jobs are Timber's latest report's (the jobs the loop
-- really compares: removals and stump jobs with a picked price, none quoted with extra stump grinding; cities and
-- prices only, no customer details), with what the demo's adjustment would have priced them at. The loop never runs
-- for a sandbox company, so the report stays as it is until this script runs again. Booth captures get its
-- adjustment (removals with no trunk size 5% lower), which their breakdown shows as "Company adjustment".
delete from public.scout_learning_runs x using demo_ids d where x.company_id = d.owner_id;
update public.company_settings s set scout_learning_enabled = true, scout_learning_website = false
  from demo_ids d where s.contractor_id = d.owner_id;

with src as (
  -- Timber's newest finished report from the current loop (its jobs carry the crew's numbers), with 3 jobs or more.
  select x.jobs from public.scout_learning_runs x join demo_ids d on x.company_id = d.timber_id
   where x.surface = 'scout' and x.status in ('rewritten', 'unchanged') and jsonb_array_length(x.jobs) >= 3
     and (x.jobs -> 0) ? 'crew'
   order by x.finished_at desc
   limit 1
), j as (
  select e from src, jsonb_array_elements(src.jobs) as e
)
insert into public.scout_learning_runs (company_id, surface, kind, status, attempts, claimed_at, finished_at, jobs,
  avg_gap_pct, summary, changes, guidance, block, active, activated_at, model)
select d.owner_id, 'scout', 'initial', 'rewritten', 1, now(), now(),
  coalesce((select jsonb_agg((j.e - 'projected') || jsonb_build_object('projected',
      case when j.e ->> 'service' = 'Tree Removal' and coalesce((j.e ->> 'size_given')::boolean, false) = false
        then greatest(round((j.e ->> 'estimate')::numeric * 0.95), 250) else (j.e ->> 'estimate')::numeric end)
    order by j.e ->> 'picked_on' desc) from j), '[]'::jsonb),
  null,
  'Scout compared its estimates with the prices you picked on these jobs. Removals without a trunk size now come out '
    || '5 percent lower, and Scout reads a single removal as one or two loads unless the debris is clearly bigger.',
  '["Tree removals with no trunk size given now come out 5% lower.", "New note on reading your jobs: Single tree removals usually need one or two disposal loads, with higher counts reserved for clearly larger debris volumes."]'::jsonb,
  jsonb_build_object('factors', jsonb_build_array(jsonb_build_object('service', 'Tree Removal', 'size', 'not_given', 'factor', 0.95,
    'jobs', (select count(*) from j where j.e ->> 'service' = 'Tree Removal' and coalesce((j.e ->> 'size_given')::boolean, false) = false))),
    'rules', jsonb_build_array('Single tree removals usually need one or two disposal loads, with higher counts reserved for clearly larger debris volumes.')),
  E'COMPANY GUIDANCE (learned each week from this company''s own picked prices)\n'
    || E'Price factors (applied once, at the Company adjustment step; "no diameter given" means diameter_inches was blank or NaN):\n'
    || E'- Tree Removal, no diameter given: x0.95\n'
    || E'How this company''s jobs usually read:\n'
    || '- Single tree removals usually need one or two disposal loads, with higher counts reserved for clearly larger debris volumes.',
  true, now(), 'openai/gpt-6-astra'
from demo_ids d;

commit;

-- Read-back (one row). Every "ok_" value should be true.
with d as (
  select '914561d0-fba3-4b90-97b7-673ed8e8b458'::uuid as owner_id,
         '4de5dd88-5c08-4732-b108-64cd62d626a2'::uuid as climber_id,
         '705cecc2-5926-48c1-a728-b3ebd6b920a2'::uuid as timber_id
)
select
  (select count(*) from public.bid_requests r, d where r.owner_contractor_id = d.owner_id) as demo_jobs,
  (select count(*) from public.bid_requests r, d where r.owner_contractor_id = d.owner_id and r.status = 'open') as open_jobs,
  (select count(*) from public.bids b join public.crew_members m on m.id = b.crew_member_id, d
    where m.user_id = d.climber_id) as climber_offers,
  (select bool_and(p.is_sandbox) from public.profiles p, d where p.id in (d.owner_id, d.climber_id)) as ok_both_sandbox,
  (select count(*) = 0 from public.profiles p, d where p.id in (d.owner_id, d.climber_id) and p.phone is not null) as ok_no_login_phones,
  (select count(*) = 0 from public.crew_members m, d where m.owner_contractor_id = d.owner_id
    and (m.phone is not null or m.status = 'network' or (m.user_id is not null and m.user_id <> d.climber_id))) as ok_crew_only_demo,
  (select count(*) = 0 from public.crew_members m, d where m.user_id = d.climber_id and m.owner_contractor_id <> d.owner_id) as ok_climber_only_in_demo,
  (select coalesce(bool_and(not cp.network_visible), false) from public.crew_profiles cp, d where cp.user_id = d.climber_id) as ok_climber_off_network,
  (select count(*) = 0 from public.bid_requests r, d where r.owner_contractor_id = d.owner_id
    and (r.customer_phone !~ '555-01' or r.jobber_quote_id is not null or r.lead_id is not null)) as ok_jobs_made_up,
  (select count(*) = 0 from public.scout_captures c, d where c.owner_id = d.owner_id
    and (c.customer_email is not null or c.voice_memo_path is not null or c.customer_phone !~ '555-01')) as ok_captures_made_up,
  (select count(*) = 0 from public.bids b join public.bid_requests r on r.id = b.bid_request_id
    join public.crew_members m on m.id = b.crew_member_id, d
    where r.owner_contractor_id = d.owner_id and m.owner_contractor_id <> d.owner_id) as ok_offers_only_demo_crew,
  (select count(*) = 0 from public.bid_request_recipients x join public.bid_requests r on r.id = x.bid_request_id
    join public.crew_members m on m.id = x.crew_member_id, d
    where r.owner_contractor_id = d.owner_id and m.owner_contractor_id <> d.owner_id) as ok_recipients_only_demo_crew,
  (select count(*) = 2 from public.product_entitlements e, d
    where e.contractor_id in (d.owner_id, d.climber_id) and e.status = 'active') as ok_entitlements,
  (select count(*) = 1 from public.scout_learning_runs x, d where x.company_id = d.owner_id and x.active
    and x.status = 'rewritten' and jsonb_array_length(x.jobs) > 0) as ok_learning_report,
  (select count(*) = 0 from public.scout_learning_runs x, d where x.company_id = d.timber_id and x.kind = 'initial'
    and x.claimed_at > now() - interval '1 minute') as ok_timber_learning_untouched,
  (select count(*) from public.bid_requests r, d where r.owner_contractor_id = d.timber_id) as timber_jobs_untouched;
