import { describe, it, expect } from 'vitest';
import { recommendPrice } from './engine';
import { deriveCostPlusRates, costWorkItem, costEstimate } from './costs';
import { evaluatePlaybooks, proposalTitle, type PlaybookItem } from './playbooks';
import { planPackets } from './packaging';
import { capacityView, backlogWeeks, suggestSlot, type CapacityPacket, type CapacitySettings } from './capacity';
import { computeReports, type ReportEstimate, type ReportPacket } from './reports';
import { buildProposal } from './proposal';
import { aiSchema, factsToAnswers, AI_FACTS } from './aiFacts';
import { priceWorkItem, type WorkItemQuote } from './pricing';
import { starterDefinition } from './starter';
import { priceSheetCard } from './testing/priceSheetFixture';
import type { ProductionEstimate } from './productionRules';
import type { Answers, RateCardDefinition } from './rules';

const DAY = '2026-10-26';
const quoteOf = (def: RateCardDefinition, key: string, a: Answers) => {
  const r = priceWorkItem(def, def.services.find((s) => s.key === key)!, a, { day: DAY });
  if (r.kind !== 'ok') throw new Error(`${key}: ${r.kind}`);
  return r as WorkItemQuote;
};

describe('costs and the target return', () => {
  const cfg = { laborRates: { climber: 42, ground: 28 }, equipmentRates: { lift: 35, crane: 400, dynamic_cable: 90 }, targetMargin: 0.3, disposalPerLoad: 50 };
  it('a 30% return means $1,000 of cost is priced at $1,429 (margin, never cost × 1.3)', () => {
    expect(recommendPrice(1000, { targetMargin: 0.3 }).price).toBe(1429);
    expect(deriveCostPlusRates(cfg)).toEqual({ roles: { climber: 60, ground: 40 }, equipment: { lift: 50, crane: 571.43, dynamic_cable: 128.57 }, disposalPerLoad: 71.43 });
  });
  it('costs labor, equipment, materials and vendor separately; commission basis leaves out the crane', () => {
    const p: ProductionEstimate = {
      crewTemplate: 'crew3', headcount: 3, hours: 4, crewHours: 4, manHours: 12,
      crew: [{ roleKey: 'climber', count: 1, hours: 4 }, { roleKey: 'ground', count: 2, hours: 4 }],
      equipment: [{ key: 'lift', hours: 4 }, { key: 'crane', hours: 4 }], materials: [{ key: 'dynamic_cable', quantity: 2 }], loads: 1,
      source: 'answered', confidence: 'high', assumptions: [],
    };
    const c = costWorkItem(p, { ...cfg, equipmentUnits: { crane: 'job', dynamic_cable: 'each' }, vendorKeys: ['crane'] });
    expect(c).toMatchObject({ labor: 392, equipment: 140, vendor: 400, materials: 180, disposal: 50, total: 1162 });
    const e = costEstimate([{ id: 'w1', price: 2500, production: p, counts: true }], { ...cfg, equipmentUnits: { crane: 'job', dynamic_cable: 'each' }, vendorKeys: ['crane'] },
      { excludedResources: ['crane'], deductions: [{ resource: 'crane', amount: 100 }], rate: 0.1 });
    expect(e.totals).toMatchObject({ price: 2500, cost: 1162, grossProfit: 1338, commissionBasis: 2000, commission: 200 });
  });
});

describe('playbooks and production packets', () => {
  const def = starterDefinition();
  const removal = { crew: 'crew3', hours: 5, utility: 'line_drop', crane: true, gated: true, urgency: 'asap', dbh: 32, access: 'rear_yard', debris: 'haul_all' };
  const items: PlaybookItem[] = [
    { id: 'w1', serviceKey: 'removal', serviceName: 'Tree removal', category: 'removal', answers: removal, flags: quoteOf({ ...def, pricing: { ...def.pricing, manHourRate: 125 } }, 'removal', removal).flags },
    { id: 'w2', serviceKey: 'dynamic_cable', serviceName: 'Dynamic cabling', category: 'cabling', answers: { cables: 2 }, flags: { special_material: 'DYNAMIC_CABLE' } },
  ];
  it('line drop, crane, gate and ASAP on a removal; a material check for cabling', () => {
    const r = evaluatePlaybooks(def, items);
    expect(r.tasks.map((t) => t.kind).sort()).toEqual(['gate_code', 'material_check', 'utility_disconnect', 'vendor']);
    expect(r.tasks.find((t) => t.kind === 'utility_disconnect')?.due).toBe('before_job');
    expect(r.tasks.find((t) => t.kind === 'vendor')?.title).toBe('Book the crane (Tree removal)');
    expect(r.schedulingClass).toBe('asap');
    expect(r.requiredAnswers.map((x) => x.question)).toEqual(['gate_code']);
    expect(r.resources).toEqual([{ resource: 'crane', mode: 'vendor', itemIds: ['w1'] }]);
  });
  it('packets per package with dependencies, tasks where they belong, and no price anywhere', () => {
    const d = priceSheetCard();
    const stumpQ = quoteOf(d, 'stump', { stump_diameter: 30 });
    const remQ = quoteOf(d, 'removal', { crew: 'crew3', hours: 4, utility: 'line_drop' });
    const plantQ = quoteOf(d, 'planting', { type: 'shade', size: '3in' });
    const ins = [
      { id: 'a', service: d.services.find((s) => s.key === 'removal')!, answers: { crew: 'crew3', hours: 4, utility: 'line_drop', access: 'rear_yard' }, production: remQ.production, treeLabel: 'Tree 1', flags: remQ.flags },
      { id: 'b', service: d.services.find((s) => s.key === 'stump')!, answers: { stump_diameter: 30 }, production: stumpQ.production, treeLabel: 'Tree 1' },
      { id: 'c', service: d.services.find((s) => s.key === 'planting')!, answers: { type: 'shade', size: '3in' }, production: plantQ.production, treeLabel: 'Replacement' },
    ];
    const pb = evaluatePlaybooks({ ...d, playbooks: starterDefinition().playbooks }, ins.map((i) => ({ id: i.id, serviceKey: i.service.key, serviceName: i.service.name, category: i.service.category, answers: i.answers, flags: i.flags ?? {} })));
    const packets = planPackets(d, ins, pb);
    expect(packets.map((p) => p.packageKey)).toEqual(['removal', 'stump', 'planting']);
    expect(packets.find((p) => p.packageKey === 'stump')?.dependsOn).toEqual(['removal']);
    expect(packets.find((p) => p.packageKey === 'planting')?.dependsOn).toEqual(['removal', 'stump']);
    expect(packets[0].tasks.map((t) => t.kind)).toEqual(['utility_disconnect']);
    expect(packets[0].scope[0]).toMatchObject({ tree: 'Tree 1', utility: 'LINE_DROP', access: 'rear_yard' });
    expect(packets[0].scope[0].scope).toContain('access: rear yard');
    expect(JSON.stringify(packets)).not.toMatch(/price|\$\d/i);
  });
  it('writes a proposal title from what was sold', () => {
    expect(proposalTitle(['Tree removal', 'Stump grinding'])).toBe('Tree removal and stump grinding');
    expect(proposalTitle(['Tree removal', 'Stump grinding', 'Tree planting', 'Trunk injection'])).toBe('Tree removal, stump grinding and 2 more');
  });
});

describe('capacity', () => {
  const s: CapacitySettings = { crewCounts: { crew3: 1 }, workingDays: [0, 1, 2, 3, 4, 5, 6], dayHours: 8, resources: [{ key: 'lift', units: 1, hoursPerDay: 24 / 7 }] };
  const pk = (id: string, hours: number, lift: number, date: string | null, status = 'ready'): CapacityPacket =>
    ({ id, crewTemplate: 'crew3', estCrewHours: hours, resources: lift ? [{ key: 'lift', hours: lift }] : [], status, scheduledDate: date });
  it('Mark\'s example: 126 crew-hours sold against 112 available, lift 38 against 48', () => {
    const packets = [pk('a', 40, 12, '2026-10-27'), pk('b', 46, 14, null), pk('c', 40, 12, '2026-11-05'), pk('d', 30, 0, '2026-11-20'), pk('e', 20, 6, '2026-10-28', 'done')];
    const v = capacityView(packets, s, DAY, 14);
    expect(v.crews).toEqual([{ key: 'crew3', demand: 126, available: 112, over: true }]);
    expect(v.resources).toEqual([{ key: 'lift', demand: 38, available: 48, over: false }]);
  });
  it('backlog in weeks, and the first day with room', () => {
    expect(backlogWeeks([pk('a', 112, 0, null)], s)).toBe(2);
    const busy = [pk('x', 8, 0, '2026-10-26', 'scheduled'), pk('y', 8, 0, '2026-10-27', 'scheduled')];
    expect(suggestSlot(pk('n', 6, 0, null), busy, s, DAY)).toBe('2026-10-28');
    expect(suggestSlot({ ...pk('n', 6, 0, null), schedulingClass: 'priority', promisedWindow: { from: '2026-11-02' } }, busy, s, DAY)).toBe('2026-11-02');
  });
});

describe('reports', () => {
  it('writes Mark\'s insight: 4.6 hours estimated, 5.4 actual, underestimated 17%, $111 a man-hour against $125, rear access', () => {
    const est: ReportEstimate[] = [1, 2, 3].map((i) => ({
      id: `e${i}`, status: 'approved', salespersonId: 's1', salespersonName: 'Sam', total: 1798.2, backlogWeeksAtSend: 2,
      items: [{ serviceKey: 'removal', serviceName: 'Tree removal', category: 'removal', engineAmount: 1798.2, price: 1798.2, crewTemplate: 'crew3', headcount: 3, estHours: 4.6, estManHours: 13.8, equipmentHours: { lift: 4 }, access: i < 3 ? 'rear_yard' : 'easy', dbh: 30 }],
    }));
    est.push({ id: 'e4', status: 'lost', salespersonId: 's1', total: 6000, backlogWeeksAtSend: 4, items: [{ serviceKey: 'removal', serviceName: 'Tree removal', category: 'removal', engineAmount: 6500, price: 6000, override: { from: 6500, to: 6000, reason: 'Competitive situation', material: true }, crewTemplate: 'crew4', headcount: 4, estHours: 8, estManHours: 32, equipmentHours: {} }] });
    const est4 = [4.5, 4.6, 4.7];
    const act = [5.3, 5.4, 5.5];
    const packets: ReportPacket[] = [0, 1, 2].map((i) => ({
      estimateId: `e${i + 1}`, packageKey: 'removal', crewTemplate: 'crew3', estHours: est4[i], estManHours: est4[i] * 3, estEquipment: { lift: 4 }, services: ['removal'],
      actuals: { hours: act[i], manHours: act[i] * 3, equipment: { lift: 5 }, factors: i < 2 ? ['restricted rear access'] : ['dead tree'] },
    }));
    const r = computeReports({ estimates: est, packets, targetRate: 125, crewNames: { crew3: '3-person climb crew' } });
    expect(r.insights[0]).toBe('3-person climb crew removal jobs: estimated 4.6 hours on average, actual 5.4, underestimated by 17%. Realized $111 a man-hour against the $125 target. Most common factor: restricted rear access.');
    expect(r.manHours.diffPct).toBe(0.17);
    expect(r.revenuePerManHour.overall).toBe(111);
    expect(r.winRate.overall).toBe(0.75);
    expect(r.winRate.byPriceBand.find((b) => b.key === '5k_plus')).toMatchObject({ value: 0, n: 1 });
    expect(r.overrides).toMatchObject({ share: 0.25, lowerShare: 0.25, winOverridden: 0, winStandard: 1 });
    expect(r.equipmentHours).toEqual([{ key: 'lift', estimated: 12, actual: 15 }]);
  });
});

describe('proposal', () => {
  it('consultation first, one priced line per item, optional and recommended flags, terms, internal cost only when allowed', () => {
    const def = priceSheetCard();
    def.policies.consultation = { showSalesperson: true, showIsa: true, showWorkWindow: true, showNextSteps: true, text: 'Consultation and estimate.', nextStepsText: 'We call you to schedule after approval.' };
    const svc = (k: string) => def.services.find((s) => s.key === k)!;
    const mem = quoteOf(def, 'membership', { lot: 'front_1_3' });
    const input = {
      items: [
        { id: 'a', service: svc('removal'), answers: { crew: 'crew3', hours: 4 }, price: 1500, kind: 'required' as const, treeLabel: 'Tree 1', unitCost: 700 },
        { id: 'b', service: svc('stump'), answers: { stump_diameter: 30 }, price: 450, kind: 'recommended' as const },
        { id: 'c', service: svc('membership'), answers: { lot: 'front_1_3' }, price: 300, kind: 'optional' as const, recurring: mem.recurring },
      ],
      salespersonName: 'Sam Ortiz', isa: 'OK-1234A', workWindow: 'week of November 16', paymentPlanKey: 'deposit_25',
    };
    const p = buildProposal(def, input);
    expect(p.consultationText).toBe('Consultation and estimate. Estimator: Sam Ortiz, ISA Certified Arborist OK-1234A. Expected start: week of November 16. We call you to schedule after approval.');
    expect(p.lines.map((l) => [l.name, l.unitPrice, l.optional, l.recommended])).toEqual([['Tree 1: Tree removal', 1500, false, false], ['Stump grinding', 450, true, true], ['Tree Health Membership', 300, true, false]]);
    expect(p.lines[0].unitCost).toBe(null);
    expect(buildProposal(def, { ...input, sendUnitCost: true }).lines[0].unitCost).toBe(700);
    expect(p.termsLines[0]).toBe('Tree Health Membership (Front, 1 to 3 trees): $300 to start, then $45 a month for 12 months, 3 visits.');
    expect(p.termsLines[1]).toBe('25% to schedule, the rest when the work is done.');
    expect(p.totals).toMatchObject({ subtotal: 1950, optionalTotal: 300, total: 1950 });
    expect(p.title).toBe('Tree removal, stump grinding and Tree Health Membership');
  });
});

describe('AI facts', () => {
  it('a strict schema with every fact required and the company\'s services as the only choices', () => {
    type TreeSchema = { properties: { services: { items: { enum: string[] } }; facts: { required: string[]; additionalProperties: boolean } } };
    const schema = aiSchema([{ key: 'removal' }, { key: 'stump' }]) as unknown as { properties: { trees: { items: TreeSchema } } };
    const tree = schema.properties.trees.items;
    expect(tree.properties.services.items.enum).toEqual(['removal', 'stump']);
    expect(tree.properties.facts.required).toEqual(AI_FACTS.map((f) => f.key));
    expect(tree.properties.facts.additionalProperties).toBe(false);
  });
  it('facts become answers: crew size to the matching crew, time to hours; low confidence is highlighted', () => {
    const def = starterDefinition();
    const removal = def.services.find((s) => s.key === 'removal')!;
    const r = factsToAnswers(removal, {
      crew_size: { value: 3, confidence: 0.9 }, duration_hours: { value: 4, confidence: 0.8 }, dbh: { value: 32, confidence: 0.5 },
      lift: { value: true, confidence: 0.9 }, access: { value: 'rear_yard', confidence: 0.7 }, debris: { value: 'haul_all', confidence: 0.95 },
      crane: { value: null, confidence: 0 },
    }, def.crews);
    expect(r.answers).toEqual({ crew: 'crew3', hours: 4, dbh: 32, lift: true, debris: 'haul_all', access: 'rear_yard' });
    expect(r.uncertain).toEqual(['dbh']);
  });
});
