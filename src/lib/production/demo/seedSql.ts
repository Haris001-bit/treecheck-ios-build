/**
 * Renders buildBigOak() as docs/demo/demo_production_setup.sql. Dates are written relative to the day the seed runs
 * (now() and current_date), so whenever it is run before the expo the backlog, the open jobs and the finished jobs sit
 * where the story needs them. Test-only.
 */
import { PRICING_ENGINE_VERSION } from '../rules';
import { PRODUCTION_ENGINE_VERSION } from '../productionRules';
import { BIG_OAK, buildBigOak } from './bigOak';

const TIMBER = '705cecc2-5926-48c1-a728-b3ebd6b920a2';
const TIMBER_DEMO = ['914561d0-fba3-4b90-97b7-673ed8e8b458', '4de5dd88-5c08-4732-b108-64cd62d626a2'];

const str = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${str(JSON.stringify(v))}::jsonb`;
const num = (n: number | null | undefined) => (n === null || n === undefined ? 'null' : String(n));
const ago = (days: number | null) => (days === null ? 'null' : `now() - interval '${days} days'`);
const dayFromNow = (days: number | null) => (days === null ? 'null' : `current_date + ${days}`);

export function renderBigOakSql(): string {
  const b = buildBigOak();
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  push(
    `-- TreeCheck expo demo, large-company setup: "${BIG_OAK.company}", a crew company with made-up numbers.`,
    '-- Generated from src/lib/production/demo (bigOak.ts, seedSql.ts). Do not edit by hand: change bigOak.ts and',
    '-- regenerate (UPDATE_DEMO_SQL=1 npx vitest run src/lib/production/demo).',
    '-- Run it in Lovable > Cloud > SQL editor (TreeCheck project) after PS1, once the two Big Oak logins exist:',
    `--   ${BIG_OAK.ownerEmail} (the owner) and ${BIG_OAK.crewEmail} (becomes its crew leader).`,
    "-- Safe to run again: each run resets Big Oak's crew estimates, packets, rate cards, settings and costs. It changes only",
    '-- those two logins and rows owned by Big Oak, never Timber, Timber Demo or any other company. Nothing in it sends a',
    '-- text, email or push. The last statement prints one read-back row; send that row to Claude.',
    '',
    'begin;',
    '',
    "-- The SQL editor runs with no login. For this transaction only it acts as the backend, so the profiles guard",
    "-- (protect_profile_payment_fields) lets the crew leader join Big Oak. The setting ends at commit or rollback.",
    "select set_config('request.jwt.claim.role', 'service_role', true);",
    '',
    'create temp table demo_ids on commit drop as',
    `select (select p.id from public.profiles p where lower(p.email) = ${str(BIG_OAK.ownerEmail)} limit 1) as owner_id,`,
    `       (select p.id from public.profiles p where lower(p.email) = ${str(BIG_OAK.crewEmail)} limit 1) as crew_id;`,
    '',
    'do $$',
    'declare o uuid; c uuid;',
    'begin',
    '  select owner_id, crew_id into o, c from demo_ids;',
    '  if o is null or c is null or o = c then',
    `    raise exception 'Create the two Big Oak logins first (${BIG_OAK.ownerEmail} and ${BIG_OAK.crewEmail}): nothing was changed.';`,
    '  end if;',
    `  if o in ('${TIMBER}', '${TIMBER_DEMO[0]}', '${TIMBER_DEMO[1]}') or c in ('${TIMBER}', '${TIMBER_DEMO[0]}', '${TIMBER_DEMO[1]}') then`,
    "    raise exception 'Those are not the Big Oak logins: nothing was changed.';",
    '  end if;',
    '  if exists (select 1 from public.bid_requests r where r.owner_contractor_id in (o, c)) then',
    "    raise exception 'A Big Oak login already has real jobs: nothing was changed.';",
    '  end if;',
    'end $$;',
    '',
    '-- 1. The logins: sandbox (the off switch), no phone numbers, no service area. The second becomes the crew leader.',
    'update public.profiles p',
    `   set is_sandbox = true, account_type = 'company', parent_contractor_id = null, full_name = 'Demo Owner',`,
    `       company_name = ${str(BIG_OAK.company)}, phone = null, crew_auto_broadcast = false`,
    '  from demo_ids d where p.id = d.owner_id;',
    'update public.profiles p',
    `   set is_sandbox = true, account_type = 'company', parent_contractor_id = d.owner_id, full_name = 'Demo Crew Leader',`,
    `       company_name = ${str(BIG_OAK.company)}, phone = null, crew_auto_broadcast = false`,
    '  from demo_ids d where p.id = d.crew_id;',
    'delete from public.service_areas s using demo_ids d where s.contractor_id in (d.owner_id, d.crew_id);',
    'delete from public.company_settings s using demo_ids d where s.contractor_id = d.crew_id;',
    'delete from public.company_billing x using demo_ids d where x.owner_id = d.crew_id;',
    '',
    '-- 2. The company: runs its own crews, no subs; a complimentary plan so the demo stays open through the expo.',
    'insert into public.company_settings (contractor_id, operating_model, sub_usage, auto_broadcast, onboarding_completed_at)',
    "select owner_id, 'employees', 'never', false, now() from demo_ids",
    'on conflict (contractor_id) do update',
    "   set operating_model = 'employees', sub_usage = 'never', auto_broadcast = false,",
    '       onboarding_completed_at = coalesce(public.company_settings.onboarding_completed_at, now());',
    'insert into public.company_billing (owner_id, pricing_version, complimentary, status, current_period_end, capacity, dma_source)',
    `select owner_id, '2026-10', true, 'active', now() + interval '1 year', ${json({ scout: 2, manager: 1, field: 3 })}, 'none' from demo_ids`,
    'on conflict (owner_id) do update',
    "   set pricing_version = '2026-10', complimentary = true, status = 'active', current_period_end = excluded.current_period_end,",
    '       capacity = excluded.capacity;',
    'delete from public.team_member_access m using demo_ids d where m.owner_id = d.owner_id;',
    'insert into public.team_member_access (owner_id, user_id, email, seat_type, member_kind, permissions, status)',
    `select owner_id, crew_id, ${str(BIG_OAK.crewEmail)}, 'field', 'employee', ${json({ assignedJobs: true })}, 'active' from demo_ids;`,
    '',
    '-- 3. In the large-company rollout as a test company (nobody else sees it until production_rollout.live).',
    'update public.production_rollout',
    '   set test_owner_ids = array(select distinct x from unnest(test_owner_ids || array[(select owner_id from demo_ids)]) x),',
    '       updated_at = now()',
    ' where id = 1;',
    '',
    "-- 4. Reset: only Big Oak's own crew estimates (their costs and packets go with them), rate cards, settings and costs.",
    'delete from public.production_estimates e using demo_ids d where e.contractor_id = d.owner_id;',
    'delete from public.production_rate_cards c using demo_ids d where c.contractor_id = d.owner_id;',
    'delete from public.production_settings s using demo_ids d where s.contractor_id = d.owner_id;',
    'delete from public.production_labor_roles r using demo_ids d where r.contractor_id = d.owner_id;',
    'delete from public.production_equipment q using demo_ids d where q.contractor_id = d.owner_id;',
    'delete from public.production_pricing x using demo_ids d where x.contractor_id = d.owner_id;',
    '',
    '-- 5. What crews and equipment cost (made up), and the settings.',
    'insert into public.production_labor_roles (contractor_id, role_key, name, loaded_hourly_cost, sort_order)',
    `select owner_id, v.k, v.n, v.c, v.o from demo_ids, (values ${b.costs.roles.map(([k, n, c], i) => `(${str(k)}, ${str(n)}, ${c}, ${i})`).join(', ')}) as v(k, n, c, o);`,
    'insert into public.production_equipment (contractor_id, equipment_key, name, hourly_cost, unit, sort_order)',
    `select owner_id, v.k, v.n, v.c, v.u, v.o from demo_ids, (values ${b.costs.equipment.map(([k, n, c, u], i) => `(${str(k)}, ${str(n)}, ${c}, ${str(u)}, ${i})`).join(', ')}) as v(k, n, c, u, o);`,
    'insert into public.production_pricing (contractor_id, target_margin, minimum_job_charge, disposal_per_load)',
    `select owner_id, ${b.costs.pricing.target_margin}, ${b.costs.pricing.minimum_job_charge}, ${b.costs.pricing.disposal_per_load} from demo_ids;`,
    'insert into public.production_settings (contractor_id, basics, crew_counts, resources, cost_viewer_ids, send_unit_cost,',
    '  isa_credentials, active_profile, profile_schedule)',
    `select owner_id, ${json(b.settings.basics)}, ${json(b.settings.crew_counts)}, ${json(b.settings.resources)}, '{}'::uuid[],`,
    `  ${b.settings.send_unit_cost}, jsonb_build_object(owner_id::text, ${str(BIG_OAK.isa)}), ${str(b.settings.active_profile)}, '[]'::jsonb`,
    '  from demo_ids;',
    '',
    '-- 6. Rate cards: version 1 ($112 a man-hour, archived) and version 2 ($120, in force).',
  );
  for (const v of [1, 2] as const) {
    push(
      'insert into public.production_rate_cards (id, contractor_id, label, branch_key, status, version, effective_from, published_at,',
      '  published_by, based_on, pricing_engine_version, definition)',
      `select ${str(BIG_OAK.cardIds[v])}, owner_id, ${str(v === 1 ? 'Spring rates' : 'Fall rates')}, null, ${str(v === 1 ? 'archived' : 'published')}, ${v},`,
      `  current_date - ${v === 1 ? 90 : 40}, now() - interval '${v === 1 ? 90 : 40} days', owner_id, ${v === 1 ? 'null' : str(BIG_OAK.cardIds[1])},`,
      `  ${str(PRICING_ENGINE_VERSION)}, ${json(b.cards[v])}`,
      '  from demo_ids;',
    );
  }

  push('', '-- 7. Fourteen estimates over 90 days: 9 won (5 finished, 4 booked), 3 lost, 1 sent, 1 draft.');
  for (const e of b.estimates) {
    push(
      'insert into public.production_estimates (id, contractor_id, number, status, salesperson_id, customer, trees, work_items,',
      '  rate_card_id, rate_card_version, pricing_engine_version, production_engine_version, profile, totals, payment_plan,',
      '  sent_at, backlog_weeks_at_send, backlog_weeks_at_sale, approved_at, approved_via, approved_by, lost_at, lost_reason,',
      '  created_by, created_at)',
      `select ${str(e.id)}, owner_id, ${e.number}, ${str(e.status)}, owner_id, ${json(e.customer)}, ${json(e.trees)}, ${json(e.workItems)},`,
      `  ${str(BIG_OAK.cardIds[e.card])}, ${e.card}, ${str(PRICING_ENGINE_VERSION)}, ${str(PRODUCTION_ENGINE_VERSION)}, 'normal', ${json(e.totals)},`,
      `  ${e.paymentPlan ? json(e.paymentPlan) : 'null'}, ${ago(e.sentDaysAgo)}, ${num(e.backlogAtSend)}, ${num(e.backlogAtSale)},`,
      `  ${ago(e.approvedDaysAgo)}, ${e.approvedDaysAgo === null ? 'null' : "'manual'"}, ${e.approvedDaysAgo === null ? 'null' : 'owner_id'},`,
      `  ${ago(e.lostDaysAgo)}, ${e.lostReason ? str(e.lostReason) : 'null'}, owner_id, ${ago(e.daysAgo)}`,
      '  from demo_ids;',
    );
    if (e.costs) {
      push(
        'insert into public.production_estimate_costs (estimate_id, contractor_id, items, totals, rates)',
        `select ${str(e.id)}, owner_id, ${json(e.costs.items)}, ${json(e.costs.totals)}, '{}'::jsonb from demo_ids;`,
      );
    }
  }

  push('', '-- 8. The job packets of the won estimates: finished ones with what the crew leader typed, the rest booked or waiting.');
  for (const p of b.packets) {
    const deps = p.dependsOn.length ? `array[${p.dependsOn.map(str).join(', ')}]::text[]` : "'{}'::text[]";
    push(
      'insert into public.production_packets (contractor_id, estimate_id, package_key, title, fulfillment, salesperson_name, estimate_number,',
      '  rate_card_version, scope, customer, crew, est_hours, est_crew_hours, est_man_hours, resources, scheduling_class, depends_on,',
      '  status, planned_date, crew_leader_id, tasks, actuals, completed_at, created_at)',
      `select owner_id, ${str(p.estimateId)}::uuid, ${str(p.packageKey)}, ${str(p.title)}, ${str(p.fulfillment)}, 'Demo Owner', ${p.estimateNumber},`,
      `  2, ${json(p.scope)}, ${json(p.customer)}, ${json(p.crew)}, ${p.estHours}, ${p.estCrewHours}, ${p.estManHours}, ${json(p.resources)},`,
      `  ${str(p.schedulingClass)}, ${deps}, ${str(p.status)}, ${dayFromNow(p.plannedInDays)}, ${p.leader ? 'crew_id' : 'null'}, ${json(p.tasks)},`,
      `  ${p.actuals ? json(p.actuals) : 'null'}, ${ago(p.completedDaysAgo)}, now()`,
      '  from demo_ids;',
    );
  }

  push(
    '',
    'commit;',
    '',
    '-- Read-back: send this row to Claude. (demo_ids went with the commit, so the logins are looked up again.)',
    'with demo_ids as (',
    `  select (select p.id from public.profiles p where lower(p.email) = ${str(BIG_OAK.ownerEmail)} limit 1) as owner_id,`,
    `         (select p.id from public.profiles p where lower(p.email) = ${str(BIG_OAK.crewEmail)} limit 1) as crew_id)`,
    'select json_build_object(',
    "  'logins_ready', (select count(*) = 2 from public.profiles p, demo_ids d where p.id in (d.owner_id, d.crew_id) and p.is_sandbox),",
    "  'crew_leader', (select count(*) = 1 from public.team_member_access m, demo_ids d where m.owner_id = d.owner_id and m.user_id = d.crew_id and m.status = 'active'),",
    "  'complimentary', (select complimentary from public.company_billing x, demo_ids d where x.owner_id = d.owner_id),",
    "  'in_rollout', (select d.owner_id = any(r.test_owner_ids) from public.production_rollout r, demo_ids d where r.id = 1),",
    "  'cards', (select count(*) from public.production_rate_cards c, demo_ids d where c.contractor_id = d.owner_id),",
    "  'estimates', (select count(*) from public.production_estimates e, demo_ids d where e.contractor_id = d.owner_id),",
    "  'packets', (select count(*) from public.production_packets k, demo_ids d where k.contractor_id = d.owner_id),",
    "  'packets_done', (select count(*) from public.production_packets k, demo_ids d where k.contractor_id = d.owner_id and k.status = 'done'),",
    "  'timber_untouched', (select count(*) = 0 from public.production_estimates e where e.contractor_id = '" + TIMBER + "')",
    ') as big_oak_demo;',
    '',
  );
  return out.join('\n');
}
