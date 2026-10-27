/**
 * Large-company setup, expo demo: "Big Oak Tree Co.", a crew company with made-up numbers only (nothing from a real
 * company's price sheet). Its rate cards, settings, costs, 14 estimates over 90 days and their job packets are built
 * with the same engine the app uses, so every price and packet is what the app itself would make. seedSql.ts turns this
 * into docs/demo/demo_production_setup.sql. Test-only: the app never imports it.
 *
 * The story it tells at the booth: 3-person removals run about 17% longer than estimated (rear access mostly), so crews
 * earn less per man-hour than the target; about 3 weeks of work is booked and both crews are over capacity for the next
 * two weeks, so High Demand is suggested along with a modest increase.
 */
import { starterDefinition } from '../starter';
import { RateCardDefinitionSchema, type RateCardDefinition, type Answers } from '../rules';
import { priceEstimate, approvedItems, type EstimateItemInput, type PricedItem } from '../estimate';
import { evaluatePlaybooks } from '../playbooks';
import { planPackets, type PacketSpec } from '../packaging';
import { costEstimate, type CostConfig } from '../costs';

export const BIG_OAK = {
  company: 'Big Oak Tree Co.',
  ownerEmail: 'bigoak.owner@treecheck.test',
  crewEmail: 'bigoak.crew@treecheck.test',
  isa: 'DEMO-0000A',
  /** Fixed row ids, so a second run of the seed replaces the same rows. "b16 0a" for Big Oak. */
  cardIds: { 1: 'b160ac00-0000-4000-8000-0000000c0001', 2: 'b160ac00-0000-4000-8000-0000000c0002' } as Record<1 | 2, string>,
  estimateId: (n: number) => `b160ac00-0000-4000-8000-${String(n).padStart(12, '0')}`,
};

type ServicePatch = Record<string, unknown>;

/** The demo card: the starter card with Big Oak's own made-up prices. Version 1 was $112 a man-hour, version 2 is $120. */
export function bigOakCard(version: 1 | 2): RateCardDefinition {
  const def = starterDefinition() as unknown as { services: ServicePatch[]; pricing: ServicePatch; policies: ServicePatch } & RateCardDefinition;
  const rate = version === 1 ? 112 : 120;
  def.pricing = { ...def.pricing, method: 'man_hour', manHourRate: rate, dayHours: 8 };
  const service = (key: string, patch: (s: ServicePatch) => void) => patch(def.services.find((s) => s.key === key)!);
  const strategy = (s: ServicePatch) => s.strategy as ServicePatch;
  // Big Oak sends its 3-person crew for the smaller work too, so all sold work sits on its two crews.
  const onCrew3 = (s: ServicePatch) => { s.production = { ...(s.production as ServicePatch), crewTemplate: 'crew3' }; };
  service('removal', (s) => { s.minimum = 600; strategy(s).equipmentAdders = [{ question: 'crane', equipment: 'crane', perJob: 1600 }, { question: 'grapple', equipment: 'grapple_truck', perJob: 900 }]; });
  service('pruning', (s) => { s.minimum = 450; });
  service('stump', (s) => { s.minimum = 275; Object.assign(strategy(s), { perUnit: 13, variants: [{ when: { question: 'on_site', equals: true }, range: { low: 9, high: 11, rule: 'low' } }] }); onCrew3(s); });
  service('dynamic_cable', (s) => { s.minimum = 1280; strategy(s).unitPrice = 640; onCrew3(s); });
  service('ehs_cable', (s) => { strategy(s).unitPrice = 460; onCrew3(s); });
  service('brace', (s) => { strategy(s).bands = [{ upTo: 35, price: 230 }, { upTo: null, price: 370 }]; onCrew3(s); });
  service('props', (s) => { Object.assign(strategy(s), { first: 1350, additional: 450 }); onCrew3(s); });
  service('airspade', (s) => { strategy(s).blockPrice = 280; });
  service('planting', (s) => {
    strategy(s).cells = { 'shade|2in': 1650, 'shade|3in': 2250, 'shade|4in': 2950, 'ornamental|2in': 1450, 'ornamental|3in': 1950, 'ornamental|4in': 2600 };
    s.species = [{ type: 'shade', light: ['full_sun'], moisture: ['average', 'dry'], species: ['Shumard oak', 'Lacebark elm'] }];
    onCrew3(s);
  });
  service('evergreen_planting', (s) => { strategy(s).perFoot = 160; onCrew3(s); });
  service('phc_visit', (s) => { strategy(s).blockPrice = 230; });
  service('trunk_injection', (s) => { Object.assign(strategy(s), { perInch: 18, perTreeMinimum: 230 }); });
  service('membership', (s) => {
    strategy(s).classes = [
      { value: 'small', label: 'Small lot', initial: 280, monthly: 40, months: 12, visits: 2 },
      { value: 'medium', label: 'Medium lot', initial: 380, monthly: 55, months: 12, visits: 3 },
      { value: 'large', label: 'Large lot', initial: 480, monthly: 75, months: 12, visits: 4 },
    ];
  });
  service('ground_work', (s) => { s.minimum = 300; });
  def.policies = {
    ...def.policies,
    consultation: {
      showSalesperson: true, showIsa: true, showWorkWindow: true, showNextSteps: true,
      text: 'Consultation and written estimate by Big Oak Tree Co.',
      nextStepsText: 'Approve online and we will call you to set the day.',
    },
    discounts: [{ key: 'neighbor', label: 'Neighbor discount', percent: 5 }],
    paymentPlans: [{ key: 'deposit_30', label: '30% deposit', depositPercent: 30, installments: 2, termsText: '30% to schedule the work, the balance when it is done.' }],
  };
  return RateCardDefinitionSchema.parse(def);
}

/** Big Oak's company settings (production_settings), less the owner's ISA line, which the seed adds by id. */
export const BIG_OAK_SETTINGS = {
  basics: { branches: [], workingDays: [1, 2, 3, 4, 5], dayHours: 8, territory: 'Springfield and nearby towns', taxRate: null },
  crew_counts: { crew3: 1, crew4: 1 },
  resources: [
    { key: 'lift', name: 'Lift', ownership: 'owned', units: 1, hoursPerDay: 6, leadTimeDays: 0 },
    { key: 'mini_skid', name: 'Mini skid', ownership: 'owned', units: 1, hoursPerDay: 8, leadTimeDays: 0 },
    { key: 'stump_grinder', name: 'Stump grinder', ownership: 'owned', units: 1, hoursPerDay: 8, leadTimeDays: 0 },
    { key: 'crane', name: 'Crane', ownership: 'vendor', units: 1, hoursPerDay: 8, leadTimeDays: 5, restrictions: 'Book with the vendor a week ahead' },
  ],
  send_unit_cost: false,
  active_profile: 'normal',
  profile_schedule: [],
};

/** Mark's cost tables for Big Oak (made up): loaded pay per hour, equipment per hour, each or job, and the pricing row. */
export const BIG_OAK_COSTS = {
  roles: [['crew_lead', 'Crew lead', 36], ['climber', 'Climber', 32], ['ground', 'Ground', 23], ['phc_tech', 'PHC technician', 28]] as [string, string, number][],
  equipment: [
    ['lift', 'Lift', 42, 'hour'], ['chip_truck', 'Chip truck', 20, 'hour'], ['chipper', 'Chipper', 16, 'hour'], ['mini_skid', 'Mini skid', 18, 'hour'],
    ['stump_grinder', 'Stump grinder', 26, 'hour'], ['crane', 'Crane (vendor)', 1450, 'job'], ['grapple_truck', 'Grapple truck (vendor)', 800, 'job'],
    ['airspade', 'AirSpade', 15, 'hour'], ['dynamic_cable', 'Dynamic cable', 85, 'each'], ['ehs_cable', 'EHS cable', 60, 'each'],
    ['brace_rod', 'Brace rod', 40, 'each'], ['prop', 'Prop', 380, 'each'], ['nursery_tree', 'Nursery tree', 420, 'each'],
  ] as [string, string, number, 'hour' | 'each' | 'job'][],
  pricing: { target_margin: 0.35, minimum_job_charge: 450, disposal_per_load: 95 },
};

const costConfig = (): CostConfig => ({
  laborRates: Object.fromEntries(BIG_OAK_COSTS.roles.map(([k, , c]) => [k, c])),
  equipmentRates: Object.fromEntries(BIG_OAK_COSTS.equipment.map(([k, , c]) => [k, c])),
  equipmentUnits: Object.fromEntries(BIG_OAK_COSTS.equipment.map(([k, , , u]) => [k, u])),
  vendorKeys: ['crane', 'grapple_truck'],
  targetMargin: BIG_OAK_COSTS.pricing.target_margin,
  minimumJobCharge: BIG_OAK_COSTS.pricing.minimum_job_charge,
  disposalPerLoad: BIG_OAK_COSTS.pricing.disposal_per_load,
});

/** How a packet of a won estimate stands today: done (with what the crew leader typed), or open on a day from today. */
type PacketPlan =
  | { status: 'done'; daysAgo: number; hours: number; headcount: number; factors: string[]; leader?: boolean }
  | { status: 'ready' | 'planned' | 'in_progress'; inDays?: number; leader?: boolean };

interface DemoSpec {
  number: number; card: 1 | 2; daysAgo: number; status: 'approved' | 'lost' | 'sent' | 'draft';
  customer: { name: string; phone: string; email: string; address: string; gateCode?: string; accessNotes?: string };
  trees: { key: string; label: string; location?: string }[];
  items: EstimateItemInput[];
  discountKey?: string; paymentPlanKey?: string;
  sentDaysAgo?: number; approvedDaysAgo?: number; lostDaysAgo?: number; lostReason?: string; backlogAtSend?: number;
  chosen?: string[]; work?: Record<string, PacketPlan>;
}

const item = (id: string, serviceKey: string, answers: Answers, over: Partial<EstimateItemInput> = {}): EstimateItemInput =>
  ({ id, serviceKey, treeKey: 't1', kind: 'required', answers, ...over });
const removal = (crew: string, hours: number, extra: Answers = {}): Answers => ({ crew, hours, debris: 'haul_all', access: 'easy', ...extra });
const done = (daysAgo: number, hours: number, factors: string[], leader = false): PacketPlan => ({ status: 'done', daysAgo, hours, headcount: 3, factors, leader });

/** The 14 estimates: 5 won and finished, 4 won and booked, 3 lost, 1 sent, 1 draft. */
export const DEMO_SPECS: DemoSpec[] = [
  {
    number: 1001, card: 1, daysAgo: 82, status: 'approved', sentDaysAgo: 81, approvedDaysAgo: 78, backlogAtSend: 0.6,
    customer: { name: 'Avery Collins', phone: '555-0101', email: 'avery@example.com', address: '1200 Elm St, Springfield', accessNotes: 'Narrow side yard' },
    trees: [{ key: 't1', label: 'Back yard oak', location: 'Rear yard' }],
    items: [item('w1', 'removal', removal('crew3', 4, { dbh: 22, access: 'rear_yard' })), item('w2', 'stump', { stump_diameter: 20 })],
    work: { removal: done(70, 5, ['restricted rear access']), stump: done(70, 1.2, []) },
  },
  {
    number: 1002, card: 1, daysAgo: 74, status: 'approved', sentDaysAgo: 73, approvedDaysAgo: 71, backlogAtSend: 1.2,
    customer: { name: 'Jordan Reyes', phone: '555-0102', email: 'jordan@example.com', address: '48 Birch Rd, Springfield' },
    trees: [{ key: 't1', label: 'Front maple', location: 'Front yard' }],
    items: [item('w1', 'removal', removal('crew3', 5, { dbh: 26, lift: true }))],
    work: { removal: done(60, 6, ['more debris than expected']) },
  },
  {
    number: 1003, card: 1, daysAgo: 61, status: 'approved', sentDaysAgo: 60, approvedDaysAgo: 57, backlogAtSend: 1.8,
    customer: { name: 'Morgan Patel', phone: '555-0103', email: 'morgan@example.com', address: '9 Cedar Ct, Springfield', gateCode: '2580' },
    trees: [{ key: 't1', label: 'Leaning pine', location: 'Rear yard' }],
    items: [item('w1', 'removal', removal('crew3', 4, { dbh: 20, access: 'rear_yard', gated: true, gate_code: '2580' }))],
    work: { removal: done(50, 5, ['restricted rear access']) },
  },
  {
    number: 1004, card: 2, daysAgo: 45, status: 'approved', sentDaysAgo: 44, approvedDaysAgo: 41, backlogAtSend: 2.4, discountKey: 'neighbor',
    customer: { name: 'Riley Thompson', phone: '555-0104', email: 'riley@example.com', address: '310 Walnut Ave, Springfield' },
    trees: [{ key: 't1', label: 'Twin-trunk oak', location: 'Rear yard' }],
    items: [item('w1', 'removal', removal('crew3', 5, { dbh: 28, access: 'rear_yard', mini: true }))],
    work: { removal: done(35, 6, ['restricted rear access', 'bigger than estimated'], true) },
  },
  {
    number: 1005, card: 2, daysAgo: 33, status: 'approved', sentDaysAgo: 32, approvedDaysAgo: 30, backlogAtSend: 1.5,
    customer: { name: 'Casey Nguyen', phone: '555-0105', email: 'casey@example.com', address: '77 Spruce Ln, Springfield' },
    trees: [{ key: 't1', label: 'Dead ash', location: 'By the driveway' }],
    items: [item('w1', 'removal', removal('crew3', 5, { dbh: 24, access: 'moderate' }), { sell: 1950, overrideReason: 'Hazard' })],
    work: { removal: done(24, 5, ['hazard tree'], true) },
  },
  {
    number: 1006, card: 2, daysAgo: 20, status: 'approved', sentDaysAgo: 19, approvedDaysAgo: 12, backlogAtSend: 2.2,
    customer: { name: 'Taylor Brooks', phone: '555-0106', email: 'taylor@example.com', address: '5 Orchard Way, Springfield', accessNotes: 'Lot clearing for a new garage' },
    trees: [{ key: 't1', label: 'Lot clearing, 8 trees', location: 'Back lot' }],
    items: [item('w1', 'removal', removal('crew4', 80, { dbh: 30, mini: true })), item('w2', 'stump', { stump_diameter: 30 })],
    work: { removal: { status: 'planned', inDays: 1, leader: true }, stump: { status: 'ready' } },
  },
  {
    number: 1007, card: 2, daysAgo: 14, status: 'approved', sentDaysAgo: 13, approvedDaysAgo: 9, backlogAtSend: 2.6, paymentPlanKey: 'deposit_30',
    customer: { name: 'Jamie Foster', phone: '555-0107', email: 'jamie@example.com', address: '2 Lakeview Dr, Springfield' },
    trees: [{ key: 't1', label: 'Two oaks over the house', location: 'Side yard' }, { key: 't2', label: 'Replacement trees', location: 'Front yard' }],
    items: [
      item('w1', 'removal', removal('crew4', 48, { dbh: 38, crane: true, utility: 'line_drop' })),
      item('w2', 'planting', { type: 'shade', size: '3in', qty: 2 }, { treeKey: 't2', kind: 'recommended' }),
    ],
    chosen: ['w2'],
    work: { removal: { status: 'planned', inDays: 5 }, planting: { status: 'ready' } },
  },
  {
    number: 1008, card: 2, daysAgo: 9, status: 'approved', sentDaysAgo: 8, approvedDaysAgo: 5, backlogAtSend: 2.9,
    customer: { name: 'Quinn Harper', phone: '555-0108', email: 'quinn@example.com', address: '640 Magnolia St, Springfield' },
    trees: [{ key: 't1', label: 'Five live oaks', location: 'Around the house' }],
    items: [item('w1', 'pruning', { crew: 'crew3', hours: 48, dbh: 32, lift: true, access: 'easy' }), item('w2', 'dynamic_cable', { cables: 2 })],
    work: { pruning: { status: 'in_progress', inDays: 0, leader: true }, cabling: { status: 'planned', inDays: 8, leader: true } },
  },
  {
    number: 1009, card: 2, daysAgo: 5, status: 'approved', sentDaysAgo: 4, approvedDaysAgo: 2, backlogAtSend: 3.1,
    customer: { name: 'Drew Sullivan', phone: '555-0109', email: 'drew@example.com', address: '18 Hillcrest Rd, Springfield', accessNotes: 'Steep back yard' },
    trees: [{ key: 't1', label: 'Two pecans', location: 'Rear yard' }],
    items: [item('w1', 'removal', removal('crew3', 64, { dbh: 34, access: 'rear_yard' })), item('w2', 'stump', { stump_diameter: 26 })],
    work: { removal: { status: 'ready' }, stump: { status: 'ready' } },
  },
  {
    number: 1010, card: 1, daysAgo: 70, status: 'lost', sentDaysAgo: 69, lostDaysAgo: 60, lostReason: 'Price', backlogAtSend: 3.2,
    customer: { name: 'Skyler Grant', phone: '555-0110', email: 'skyler@example.com', address: '23 Pine St, Springfield' },
    trees: [{ key: 't1', label: 'Large oak', location: 'Front yard' }],
    items: [item('w1', 'removal', removal('crew4', 8, { dbh: 36 }), { sell: 3300, overrideReason: 'Competitive situation' }), item('w2', 'stump', { stump_diameter: 34 })],
  },
  {
    number: 1011, card: 2, daysAgo: 40, status: 'lost', sentDaysAgo: 39, lostDaysAgo: 30, lostReason: 'Went with another company', backlogAtSend: 2.1,
    customer: { name: 'Rowan Ellis', phone: '555-0111', email: 'rowan@example.com', address: '91 Aspen Ct, Springfield' },
    trees: [{ key: 't1', label: 'Street-side elm', location: 'Front yard' }],
    items: [item('w1', 'pruning', { crew: 'crew3', hours: 6, dbh: 20, access: 'easy' })],
  },
  {
    number: 1012, card: 2, daysAgo: 18, status: 'lost', sentDaysAgo: 17, lostDaysAgo: 10, lostReason: 'No response', backlogAtSend: 3.5,
    customer: { name: 'Emerson Hale', phone: '555-0112', email: 'emerson@example.com', address: '7 Willow Bend, Springfield' },
    trees: [{ key: 't1', label: 'New ornamentals', location: 'Front bed' }],
    items: [item('w1', 'planting', { type: 'ornamental', size: '2in', qty: 3 })],
  },
  {
    number: 1013, card: 2, daysAgo: 3, status: 'sent', sentDaysAgo: 3, backlogAtSend: 3.0,
    customer: { name: 'Hayden Moore', phone: '555-0113', email: 'hayden@example.com', address: '450 Sycamore Ave, Springfield' },
    trees: [{ key: 't1', label: 'Storm-damaged oak', location: 'Rear yard' }],
    items: [
      item('w1', 'removal', removal('crew3', 6, { dbh: 25, access: 'rear_yard' })),
      item('w2', 'stump', { stump_diameter: 24 }),
      item('w3', 'phc_visit', { minutes: 45, treatment: 'Soil care for the remaining trees' }, { kind: 'recommended' }),
      item('w4', 'membership', { lot: 'medium' }, { kind: 'optional' }),
    ],
  },
  {
    number: 1014, card: 2, daysAgo: 0, status: 'draft',
    customer: { name: 'Parker Lane', phone: '555-0114', email: 'parker@example.com', address: '12 Meadow Dr, Springfield' },
    trees: [{ key: 't1', label: 'Front oak', location: 'Front yard' }],
    items: [item('w1', 'pruning', { crew: 'crew3', hours: 4, dbh: 18, access: 'easy' })],
  },
];

export interface DemoEstimateRow {
  id: string; number: number; status: string; card: 1 | 2; daysAgo: number; sentDaysAgo: number | null; approvedDaysAgo: number | null;
  lostDaysAgo: number | null; lostReason: string | null; backlogAtSend: number | null; backlogAtSale: number | null;
  customer: DemoSpec['customer']; trees: DemoSpec['trees']; workItems: PricedItem[]; totals: Record<string, unknown>;
  paymentPlan: unknown | null; costs: { items: unknown[]; totals: Record<string, unknown> } | null;
}
export interface DemoPacketRow {
  estimateId: string; estimateNumber: number; packageKey: string; title: string; fulfillment: string; scope: unknown[];
  customer: Record<string, string | null>; crew: { template: string | null; headcount: number }; estHours: number; estCrewHours: number; estManHours: number;
  resources: { key: string; hours: number }[]; schedulingClass: string; dependsOn: string[]; tasks: { key: string; kind: string; title: string; status: string; dueAt: null }[];
  status: string; plannedInDays: number | null; completedDaysAgo: number | null; leader: boolean;
  actuals: { headcount: number; hours: number; manHours: number; equipment: Record<string, number>; expenses: null; factors: string[] } | null;
}

/** Everything the seed writes, priced and packaged by the app's own engine. */
export function buildBigOak() {
  const cards = { 1: bigOakCard(1), 2: bigOakCard(2) };
  const cfg = costConfig();
  const estimates: DemoEstimateRow[] = [];
  const packets: DemoPacketRow[] = [];
  for (const spec of DEMO_SPECS) {
    const def = cards[spec.card];
    const decided = spec.status === 'approved';
    const priced = priceEstimate(def, spec.items, { day: '2026-10-26', discountKey: spec.discountKey, paymentPlanKey: spec.paymentPlanKey });
    if (!priced.ok) throw new Error(`#${spec.number}: ${priced.problems.join('; ')}`);
    const id = BIG_OAK.estimateId(spec.number);
    const marked = priced.items.map((i) => (i.kind === 'required' ? i : { ...i, selected: decided ? (spec.chosen ?? []).includes(i.id) : null }));
    const plan = spec.paymentPlanKey ? def.policies.paymentPlans.find((p) => p.key === spec.paymentPlanKey) ?? null : null;
    const costs = costEstimate(marked.filter((i) => i.production).map((i) => ({
      id: i.id, price: i.price ?? 0, production: i.production!, counts: i.kind === 'required' || (decided ? i.selected === true : i.kind === 'recommended'),
    })), cfg, def.policies.commission);
    estimates.push({
      id, number: spec.number, status: spec.status, card: spec.card, daysAgo: spec.daysAgo, sentDaysAgo: spec.sentDaysAgo ?? null,
      approvedDaysAgo: spec.approvedDaysAgo ?? null, lostDaysAgo: spec.lostDaysAgo ?? null, lostReason: spec.lostReason ?? null,
      backlogAtSend: spec.backlogAtSend ?? null, backlogAtSale: decided ? spec.backlogAtSend ?? null : null,
      customer: spec.customer, trees: spec.trees, workItems: marked,
      totals: { ...(decided ? priceEstimate(def, marked, { day: '2026-10-26', discountKey: spec.discountKey, paymentPlanKey: spec.paymentPlanKey, approved: true }).totals : priced.totals), discountKey: spec.discountKey ?? null, paymentPlanKey: spec.paymentPlanKey ?? null },
      paymentPlan: plan, costs: { items: costs.items, totals: costs.totals },
    });
    if (!decided) continue;

    const sold = approvedItems(marked, spec.chosen ?? []).filter((i) => i.production);
    const services = new Map(def.services.map((s) => [s.key, s]));
    const playbook = evaluatePlaybooks(def, sold.map((i) => ({ id: i.id, serviceKey: i.serviceKey, serviceName: i.serviceName, category: services.get(i.serviceKey)!.category, answers: i.answers, flags: i.flags })));
    const trees = new Map(spec.trees.map((t) => [t.key, t]));
    const planned: PacketSpec[] = planPackets(def, sold.map((i) => {
      const t = i.treeKey ? trees.get(i.treeKey) : undefined;
      return { id: i.id, service: services.get(i.serviceKey)!, answers: i.answers, production: i.production!, flags: i.flags, treeLabel: t?.label ?? null, location: t?.location ?? null, photos: [] };
    }), playbook);
    for (const p of planned) {
      const state = spec.work?.[p.packageKey];
      if (!state) throw new Error(`#${spec.number}: no plan for the ${p.packageKey} packet`);
      const isDone = state.status === 'done';
      packets.push({
        estimateId: id, estimateNumber: spec.number, packageKey: p.packageKey, title: p.title, fulfillment: p.fulfillment, scope: p.scope,
        customer: { name: spec.customer.name, phone: spec.customer.phone, address: spec.customer.address, gateCode: spec.customer.gateCode ?? null, accessNotes: spec.customer.accessNotes ?? null },
        crew: p.crew, estHours: p.estHours, estCrewHours: p.estCrewHours, estManHours: p.estManHours, resources: p.resources,
        schedulingClass: p.schedulingClass, dependsOn: p.dependsOn,
        tasks: p.tasks.map((t) => ({ key: t.key, kind: t.kind, title: t.title, status: isDone ? 'done' : 'open', dueAt: null })),
        status: state.status, plannedInDays: isDone ? null : state.inDays ?? null, completedDaysAgo: isDone ? state.daysAgo : null, leader: !!state.leader,
        actuals: isDone ? {
          headcount: state.headcount, hours: state.hours, manHours: Math.round(state.headcount * state.hours * 100) / 100,
          equipment: Object.fromEntries(p.resources.map((r) => [r.key, Math.round(r.hours * (state.hours / Math.max(0.01, p.estHours)) * 100) / 100])),
          expenses: null, factors: state.factors,
        } : null,
      });
    }
  }
  return { cards, settings: BIG_OAK_SETTINGS, costs: BIG_OAK_COSTS, estimates, packets };
}
