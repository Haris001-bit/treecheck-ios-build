import { describe, it, expect } from 'vitest';
import { priceWorkItem, applyOverride, isMaterialOverride, estimateTotals, isOffered, recommendSpecies, type WorkItemResult } from './pricing';
import { activeProfile, recommendProfile } from './profiles';
import { parseDefinition, type RateCardDefinition, type Answers } from './rules';
import { priceSheetCard } from './testing/priceSheetFixture';

const DAY = '2026-10-26';
const svc = (def: RateCardDefinition, key: string) => def.services.find((s) => s.key === key)!;
const price = (def: RateCardDefinition, key: string, a: Answers, settings = null): WorkItemResult =>
  priceWorkItem(def, svc(def, key), a, { day: DAY, settings });
const amount = (r: WorkItemResult) => (r.kind === 'ok' ? r.engineAmount : `${r.kind}`);

describe('rate card definition', () => {
  it('parses the price sheet fixture', () => {
    expect(parseDefinition(priceSheetCard()).kind).toBe('ok');
  });
  it('refuses a bad definition with readable issues', () => {
    const r = parseDefinition({ schemaVersion: 1, services: [{ key: 'Bad Key', name: '', category: 'nope', questions: [], strategy: { kind: 'fixed', price: -1 } }] });
    expect(r.kind).toBe('invalid');
    if (r.kind === 'invalid') expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe('pricing strategies with the price sheet in Mark\'s document', () => {
  const def = priceSheetCard();
  it('dynamic cables: $700 each with a $1,400 job minimum', () => {
    expect(amount(price(def, 'dynamic_cable', { cables: 3 }))).toBe(2100);
    const one = price(def, 'dynamic_cable', { cables: 1 });
    expect(amount(one)).toBe(1400);
    expect(one.kind === 'ok' && one.minimumApplied).toBe(true);
  });
  it('EHS cable $500 plus $250 for hub and spoke', () => {
    expect(amount(price(def, 'ehs_cable', { cables: 1 }))).toBe(500);
    expect(amount(price(def, 'ehs_cable', { cables: 1, hub_spoke: true }))).toBe(750);
  });
  it('bracing: $250, or $400 above 35" DBH', () => {
    expect(amount(price(def, 'brace', { dbh: 30 }))).toBe(250);
    expect(amount(price(def, 'brace', { dbh: 35 }))).toBe(250);
    expect(amount(price(def, 'brace', { dbh: 38 }))).toBe(400);
  });
  it('props: $1,500 for the first plus $500 each after', () => {
    expect(amount(price(def, 'props', { props: 1 }))).toBe(1500);
    expect(amount(price(def, 'props', { props: 3 }))).toBe(2500);
  });
  it('stumps: $15 a diameter inch, $350 minimum', () => {
    expect(amount(price(def, 'stump', { stump_diameter: 30 }))).toBe(450);
    expect(amount(price(def, 'stump', { stump_diameter: 20 }))).toBe(350);
  });
  it('stumps already on site: the $5 to $10 range is blocked until an admin picks a rule', () => {
    const r = price(def, 'stump', { stump_diameter: 30, on_site: true });
    expect(r.kind).toBe('blocked');
    const d2 = priceSheetCard();
    const st = svc(d2, 'stump').strategy;
    if (st.kind === 'measurement') st.variants![0].range!.rule = 'mid';
    expect(amount(price(d2, 'stump', { stump_diameter: 60, on_site: true }))).toBe(450);
  });
  it('PHC: $250 per 30 minutes, so $500 an hour', () => {
    expect(amount(price(def, 'phc_visit', { minutes: 60 }))).toBe(500);
    expect(amount(price(def, 'phc_visit', { minutes: 45 }))).toBe(500);
    expect(amount(price(def, 'phc_visit', { minutes: 20 }))).toBe(250);
  });
  it('trunk injection: max($250, DBH × $20) per tree', () => {
    expect(amount(price(def, 'trunk_injection', { dbh: 20 }))).toBe(400);
    expect(amount(price(def, 'trunk_injection', { dbh: 10 }))).toBe(250);
    expect(amount(price(def, 'trunk_injection', { dbh: 20, trees: 3 }))).toBe(1200);
  });
  it('planting: the matrix gives a 3" shade tree $2,400; a missing size is not offered', () => {
    expect(amount(price(def, 'planting', { type: 'shade', size: '3in' }))).toBe(2400);
    expect(amount(price(def, 'planting', { type: 'shade', size: '3in', qty: 2 }))).toBe(4800);
    expect(price(def, 'planting', { type: 'evergreen', size: '4in' }).kind).toBe('blocked');
  });
  it('height pricing stops at the stated maximum', () => {
    expect(amount(price(def, 'japanese_maple', { height: 6 }))).toBe(2100);
    expect(amount(price(def, 'japanese_maple', { height: 12 }))).toBe(2800);
  });
  it('a membership quotes its first payment and carries the monthly terms', () => {
    const r = price(def, 'membership', { lot: 'front_1_3' });
    expect(amount(r)).toBe(300);
    expect(r.kind === 'ok' && r.recurring).toEqual({ monthly: 45, months: 12, visits: 3, total: 840, label: 'Front, 1 to 3 trees' });
  });
  it('asks for what is missing', () => {
    const r = price(def, 'dynamic_cable', {});
    expect(r.kind).toBe('missing');
    if (r.kind === 'missing') expect(r.missing).toEqual(['cables']);
  });
});

describe('crew-time pricing, both methods', () => {
  it('man-hour: a 3-person crew for 4 hours at $125 is $1,500', () => {
    const def = priceSheetCard();
    const r = price(def, 'removal', { crew: 'crew3', hours: 4 });
    expect(amount(r)).toBe(1500);
    if (r.kind === 'ok') {
      expect(r.production.manHours).toBe(12);
      expect(r.production.headcount).toBe(3);
    }
  });
  it('a 4-person full day: $4,000 by the rate, the $5,000 day as a floor until an admin decides', () => {
    const def = priceSheetCard();
    expect(amount(price(def, 'removal', { crew: 'crew4', hours: 8 }))).toBe(5000);
    def.decisions.push({ key: 'day_vs_rate:removal:full_day_4', choice: 'rate' });
    expect(amount(price(def, 'removal', { crew: 'crew4', hours: 8 }))).toBe(4000);
    def.decisions[0].choice = 'day_price';
    expect(amount(price(def, 'removal', { crew: 'crew4', hours: 12 }))).toBe(5000);
    def.decisions[0].choice = 'floor';
    expect(amount(price(def, 'removal', { crew: 'crew4', hours: 12 }))).toBe(6000);
  });
  it('the job minimum still applies to a short crew job', () => {
    expect(amount(price(priceSheetCard(), 'removal', { crew: 'crew2', hours: 2 }))).toBe(650);
  });
  it('equipment adders and the lift and mini-skid answers', () => {
    const r = price(priceSheetCard(), 'removal', { crew: 'crew3', hours: 4, crane: true, lift: true, mini: true });
    expect(amount(r)).toBe(3300);
    if (r.kind === 'ok') expect(r.production.equipment.map((e) => e.key).sort()).toEqual(['crane', 'lift', 'mini_skid']);
  });
  it('pay plus target return: frozen selling rates (cost ÷ (1 − margin)) times crew hours', () => {
    const def = priceSheetCard();
    def.pricing.method = 'cost_plus';
    def.pricing.derivedRates = { roles: { climber: 60, ground: 40 }, equipment: { lift: 50 } };
    expect(amount(price(def, 'removal', { crew: 'crew3', hours: 4 }))).toBe(650);
    expect(amount(price(def, 'removal', { crew: 'crew3', hours: 5, lift: true }))).toBe(950);
    def.pricing.derivedRates = undefined;
    expect(price(def, 'removal', { crew: 'crew3', hours: 4 }).kind).toBe('blocked');
  });
  it('structured flags come from answers, not from quote titles', () => {
    const r = price(priceSheetCard(), 'removal', { crew: 'crew3', hours: 4, utility: 'line_drop', access: 'rear_yard', crane: true });
    expect(r.kind === 'ok' && r.flags).toEqual({ utility_requirement: 'LINE_DROP', equipment_requirement: 'CRANE', access: 'REAR' });
  });
});

describe('profiles, eligibility and species', () => {
  it('High Demand adds 10%; a scheduled window beats the manual choice', () => {
    const def = priceSheetCard();
    expect(amount(price(def, 'removal', { crew: 'crew3', hours: 4 }, { active_profile: 'high_demand' } as never))).toBe(1650);
    const s = { active_profile: 'high_demand', profile_schedule: [{ key: 'winter_fill', from: '2026-10-20', to: '2026-11-30' }] };
    expect(activeProfile(def, s, DAY)?.key).toBe('winter_fill');
    expect(activeProfile(def, s, '2026-12-05')?.key).toBe('high_demand');
    expect(activeProfile(def, null, DAY)?.key).toBe('normal');
  });
  it('not offered, and outside the selling months', () => {
    const def = priceSheetCard();
    expect(price(def, 'basal_bark', {})).toEqual({ kind: 'not_offered', reason: 'Not offered' });
    expect(price(def, 'fruit_tgr', {})).toEqual({ kind: 'not_offered', reason: 'Sold only in March and September' });
    expect(isOffered(svc(def, 'fruit_tgr'), '2026-03-02').kind).toBe('ok');
  });
  it('recommends the company\'s approved species for the site', () => {
    expect(recommendSpecies(svc(priceSheetCard(), 'planting'), { type: 'shade', light: 'full_sun', moisture: 'dry' })).toEqual(['Bur oak', 'Lacebark elm']);
  });
  it('recommends a profile from the backlog, and an 8 to 12% increase for $108 against $125', () => {
    const r = recommendProfile(priceSheetCard(), { backlogWeeks: 3.2, realizedRate: 108, targetRate: 125 });
    expect(r.key).toBe('high_demand');
    expect(r.increase).toEqual({ low: 8, high: 12 });
    expect(r.text).toContain('about 8 to 12%');
    expect(recommendProfile(priceSheetCard(), { backlogWeeks: 0.5 }).key).toBe('winter_fill');
    expect(recommendProfile(priceSheetCard(), { backlogWeeks: 1.5 }).key).toBe('normal');
  });
});

describe('overrides and totals', () => {
  it('a material override needs a reason', () => {
    expect(applyOverride(3250, 2800)).toEqual({ kind: 'needs_reason', direction: 'lower' });
    expect(applyOverride(3250, 4000)).toEqual({ kind: 'needs_reason', direction: 'higher' });
    expect(applyOverride(3250, 2800, 'Competitive situation')).toEqual({ kind: 'ok', price: 2800, override: { from: 3250, to: 2800, reason: 'Competitive situation', material: true } });
    expect(applyOverride(3250, 3260)).toEqual({ kind: 'ok', price: 3260, override: { from: 3250, to: 3260, reason: null, material: false } });
    expect(applyOverride(3250, null)).toEqual({ kind: 'ok', price: 3250, override: null });
  });
  it('5% or $50, whichever is bigger', () => {
    expect(isMaterialOverride(400, 449)).toBe(false);
    expect(isMaterialOverride(400, 450)).toBe(true);
    expect(isMaterialOverride(4000, 4190)).toBe(false);
    expect(isMaterialOverride(4000, 4200)).toBe(true);
  });
  it('recommended items count until the customer decides; optional ones only when selected', () => {
    const def = priceSheetCard();
    const lines = [
      { id: 'a', price: 1500, kind: 'required' as const },
      { id: 'b', price: 450, kind: 'recommended' as const },
      { id: 'c', price: 2400, kind: 'optional' as const },
    ];
    const t = estimateTotals(def, lines, { discountKey: 'veteran', paymentPlanKey: 'deposit_25' });
    expect(t.subtotal).toBe(1950);
    expect(t.optionalTotal).toBe(2400);
    expect(t.discount?.amount).toBe(97.5);
    expect(t.total).toBe(1852.5);
    expect(t.deposit?.amount).toBe(463.13);
    const approved = estimateTotals(def, [{ ...lines[0] }, { ...lines[1], selected: false }, { ...lines[2], selected: true }], { approved: true });
    expect(approved.subtotal).toBe(3900);
  });
});
