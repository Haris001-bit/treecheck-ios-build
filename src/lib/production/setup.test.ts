import { describe, it, expect } from 'vitest';
import { findContradictions, publishBlockers } from './contradictions';
import { starterDefinition } from './starter';
import { normalizeImport, type ImportedSheet } from './importSheet';
import { validatePastJobs } from './validation';
import { priceSheetCard } from './testing/priceSheetFixture';
import { parseDefinition } from './rules';

describe('contradictions', () => {
  it('flags the $5,000 four-person day against $125 a man-hour: they only agree at 10-hour days', () => {
    const def = priceSheetCard();
    const c = findContradictions(def).find((x) => x.kind === 'day_vs_rate');
    expect(c?.message).toContain('$5,000');
    expect(c?.message).toContain('$4,000');
    expect(c?.message).toContain('10-hour days');
    expect(c?.blocking && !c.resolved).toBe(true);
    def.decisions.push({ key: c!.key, choice: 'floor' });
    expect(findContradictions(def).find((x) => x.kind === 'day_vs_rate')?.resolved).toBe(true);
  });
  it('a price range needs a rule, and the fix is in the card itself', () => {
    const def = priceSheetCard();
    expect(publishBlockers(def).some((c) => c.kind === 'range_rule')).toBe(true);
    const st = def.services.find((s) => s.key === 'stump')!.strategy;
    if (st.kind === 'measurement') st.variants![0].range!.rule = 'ask';
    expect(publishBlockers(def).some((c) => c.kind === 'range_rule')).toBe(false);
  });
  it('finds missing matrix cells, open-ended bands, min above max, unknown questions and conflicting discounts', () => {
    const def = priceSheetCard();
    const planting = def.services.find((s) => s.key === 'planting')!;
    if (planting.strategy.kind === 'matrix') delete planting.strategy.cells['shade|4in'];
    const brace = def.services.find((s) => s.key === 'brace')!;
    if (brace.strategy.kind === 'threshold') brace.strategy.bands = [{ upTo: 35, price: 250 }];
    const props = def.services.find((s) => s.key === 'props')!;
    props.minimum = 900; props.maximum = 500;
    if (props.strategy.kind === 'first_additional') props.strategy.unitQuestion = 'nope';
    def.policies.discounts.push({ key: 'veteran_b', label: 'Veterans and first responders', percent: 10, categories: ['veteran', 'first_responder'] });
    const kinds = new Set(findContradictions(def).map((c) => c.kind));
    for (const k of ['matrix', 'bands', 'min_max', 'missing_question', 'policy']) expect(kinds.has(k as never)).toBe(true);
    const policy = findContradictions(def).find((c) => c.kind === 'policy');
    expect(policy?.choices?.map((x) => x.value)).toEqual(['veteran', 'veteran_b']);
  });
  it('the starter card can\'t be published until the company sets its prices', () => {
    const blockers = publishBlockers(starterDefinition());
    expect(blockers.filter((b) => b.kind === 'unpriced').length).toBeGreaterThanOrEqual(10);
  });
  it("a switched-off service raises nothing, so a company that doesn't sell memberships can still publish", () => {
    const def = starterDefinition();
    const membership = def.services.find((s) => s.strategy.kind === 'recurring_plan')!;
    expect(publishBlockers(def).filter((c) => c.serviceKey === membership.key).map((c) => c.kind)).toContain('membership');
    membership.offered = false;
    expect(findContradictions(def).filter((c) => c.serviceKey === membership.key)).toEqual([]);
    for (const s of def.services) s.offered = false;
    expect(publishBlockers(def)).toEqual([]);

    // The matrix message's own advice works: a size it doesn't sell stops mattering once the service is off.
    const sheet = priceSheetCard();
    const planting = sheet.services.find((s) => s.key === 'planting')!;
    if (planting.strategy.kind === 'matrix') delete planting.strategy.cells['shade|4in'];
    expect(findContradictions(sheet).some((c) => c.kind === 'matrix')).toBe(true);
    planting.offered = false;
    expect(findContradictions(sheet).some((c) => c.kind === 'matrix')).toBe(false);
  });
});

describe('starter rate card', () => {
  it('parses, with 14 services, 5 crews and the playbook rows from Mark\'s document', () => {
    const def = starterDefinition();
    expect(parseDefinition(def).kind).toBe('ok');
    expect(def.services).toHaveLength(14);
    expect(def.crews).toHaveLength(5);
    expect(def.playbooks.map((p) => p.key)).toEqual(['safety_trim', 'line_drop', 'okie', 'cabling', 'bracing', 'airspade', 'crane', 'grapple', 'asap', 'priority', 'gated_access']);
    expect(def.policies.overrideReasons?.lower).toContain('Competitive situation');
  });
});

describe('price sheet import', () => {
  const sheet: ImportedSheet = {
    crew_pricing: { man_hour_rate: 125, day_hours: 8, job_minimum: 650, full_day_prices: [{ headcount: 4, price: 5000 }] },
    services: [
      { name: 'Dynamic cable', category: 'cabling', kind: 'per_unit', unit_label: 'Cables', unit_price: 700, minimum: 1400, quote: '$700/cable, $1,400 job minimum' },
      { name: 'Stump grinding', category: 'stump', kind: 'measurement', unit_label: 'Diameter inches', per_unit: 15, minimum: 350, range_low: 5, range_high: 10, range_condition: 'Production already on site' },
      { name: 'Brace', category: 'bracing', kind: 'threshold', unit_label: 'DBH', threshold: 35, below_price: 250, above_price: 400 },
      { name: 'Trunk injection', category: 'phc', kind: 'per_dbh', per_inch: 20, per_tree_minimum: 250 },
      { name: 'Shade trees', category: 'planting', kind: 'matrix', matrix: [{ row: 'Shade', col: '2"', price: 1800 }, { row: 'Shade', col: '3"', price: 2400 }] },
      { name: 'Basal bark spray', category: 'phc', kind: 'fixed', price: null, not_offered: true },
      { name: 'Fruit TGR', category: 'phc', kind: 'fixed', price: 300, sell_months: [3, 9] },
      { name: 'Mystery service', category: 'other', kind: 'something', quote: 'call for price' },
    ],
    discounts: [{ label: 'Veteran discount', percent: 5, categories: ['veteran'] }],
    payment_plans: [
      { label: 'Three payments', installments: 3, deposit_percent: 0 },
      { label: 'Deposit plus three', installments: 4, deposit_percent: 25 },
    ],
    consultation_text: 'Consultation by an ISA Certified Arborist.',
    conflicts: [{ text: 'Two slides disagree on who qualifies for the discount.', quote: 'veterans only / veterans and first responders' }],
  };
  it('maps the sheet onto services, keeping the crew pricing and the job minimum', () => {
    const { def } = normalizeImport(sheet);
    expect(def.pricing.manHourRate).toBe(125);
    const cable = def.services.find((s) => s.name === 'Dynamic cable')!;
    expect(cable.strategy).toEqual({ kind: 'per_unit', unitQuestion: 'units', unitPrice: 700 });
    expect(cable.minimum).toBe(1400);
    expect(def.services.find((s) => s.name === 'Basal bark spray')!.offered).toBe(false);
    expect(def.services.find((s) => s.name === 'Fruit TGR')!.sellMonths).toEqual([3, 9]);
    const removal = def.services.find((s) => s.key === 'removal')!;
    expect(removal.minimum).toBe(650);
    expect(removal.strategy.kind === 'crew_time' && removal.strategy.floors).toEqual([{ key: 'full_day_4', minHours: 8, headcount: 4, price: 5000 }]);
  });
  it('turns what it can\'t settle into findings and contradictions instead of guessing', () => {
    const { def, findings } = normalizeImport(sheet);
    expect(findings.some((f) => f.key === 'import:payment_plans' && f.blocking)).toBe(true);
    expect(findings.some((f) => f.key.startsWith('import:conflict') && f.quote?.includes('veterans only'))).toBe(true);
    expect(findings.some((f) => f.key.endsWith(':manual'))).toBe(true);
    const kinds = new Set(publishBlockers(def).map((c) => c.kind));
    expect(kinds.has('day_vs_rate')).toBe(true);
    expect(kinds.has('range_rule')).toBe(true);
    expect(kinds.has('finding')).toBe(true);
  });
  it('an empty or unusable sheet leaves the starter card untouched', () => {
    const { def } = normalizeImport({});
    expect(def.services).toHaveLength(14);
  });
});

describe('validation against past jobs', () => {
  it('needs five won and two lost jobs (or a reason), and flags gaps over 10%', () => {
    const def = priceSheetCard();
    def.validation.jobs = [
      { id: '1', label: 'Cabling A', outcome: 'won', service: 'dynamic_cable', answers: { cables: 2 }, actualPrice: 1400 },
      { id: '2', label: 'Cabling B', outcome: 'won', service: 'dynamic_cable', answers: { cables: 3 }, actualPrice: 2100 },
      { id: '3', label: 'Stump', outcome: 'won', service: 'stump', answers: { stump_diameter: 28 }, actualPrice: 425 },
      { id: '4', label: 'Removal B', outcome: 'won', service: 'removal', answers: { crew: 'crew3', hours: 6 }, actualPrice: 2600 },
      { id: '5', label: 'Brace', outcome: 'won', service: 'brace', answers: { dbh: 38 }, actualPrice: 400 },
      { id: '6', label: 'Lost props', outcome: 'lost', service: 'props', answers: { props: 2 }, actualPrice: 2000 },
    ];
    let v = validatePastJobs(def, '2026-10-26');
    expect(v.ready).toBe(false);
    expect(v.reason).toContain('1 more lost');
    expect(v.rows.find((r) => r.id === '3')).toMatchObject({ enginePrice: 420, diffPct: -0.01, flag: 'ok' });
    expect(v.rows.find((r) => r.id === '4')).toMatchObject({ enginePrice: 2250, flag: 'review' });
    def.validation.jobs.push({ id: '7', label: 'Lost stump', outcome: 'lost', service: 'stump', answers: { stump_diameter: 40 }, actualPrice: 600 });
    v = validatePastJobs(def, '2026-10-26');
    expect(v.ready).toBe(true);
    expect(v.summary).toMatchObject({ won: 5, lost: 2 });
    def.validation.jobs = [];
    def.validation.skippedReason = 'New company, no past jobs yet';
    expect(validatePastJobs(def, '2026-10-26').ready).toBe(true);
  });
});
