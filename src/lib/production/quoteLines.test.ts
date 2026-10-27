// Large-company setup: the Jobber quote a crew estimate becomes, and reading Jobber's answers back.
import { describe, expect, it } from 'vitest';
import { priceSheetCard } from './testing/priceSheetFixture';
import { priceEstimate, type EstimateItemInput, type PricedItem } from './estimate';
import { chosenFromQuote, matchLineIds, packetsForJob, quoteCreateAttributes, quotePlan, withoutTextOnly, workWindowText } from './quoteLines';
import type { RateCardDefinition } from './rules';

const DAY = '2026-10-26';
const ITEMS: EstimateItemInput[] = [
  { id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3', hours: 4, access: 'rear_yard' } },
  { id: 'b', serviceKey: 'stump', treeKey: 't1', kind: 'recommended', answers: { stump_diameter: 30 } },
  { id: 'c', serviceKey: 'planting', treeKey: null, kind: 'optional', answers: { type: 'shade', size: '3in' } },
];
const TREES = [{ key: 't1', label: 'Front oak' }];

function card(): RateCardDefinition {
  const def = priceSheetCard();
  def.policies.consultation = { showSalesperson: true, showIsa: true, showWorkWindow: true, showNextSteps: true, text: 'Consultation and written estimate.', nextStepsText: 'We call you to schedule.' };
  return def;
}
const priced = (def: RateCardDefinition, items = ITEMS) => priceEstimate(def, items, { day: DAY }).items;

describe('quotePlan', () => {
  it('puts the consultation first, one priced line per item with optional and recommended marked, then the terms', () => {
    const def = card();
    const plan = quotePlan(def, {
      items: priced(def), trees: TREES, paymentPlanKey: 'deposit_25', discountKey: 'veteran',
      salespersonName: 'Sam Seller', isa: 'OK-1234A', workWindow: 'in about 3 weeks',
    });
    expect(plan.title).toBe('Tree removal, stump grinding and planting');
    expect(plan.refs.map((r) => r.kind)).toEqual(['consultation', 'work', 'work', 'work', 'terms']);
    expect(plan.lineItems[0]).toMatchObject({ name: 'Consultation', textOnly: true, unitPrice: 0, saveToProductsAndServices: false });
    expect(plan.lineItems[0].description).toBe('Consultation and written estimate. Estimator: Sam Seller, ISA Certified Arborist OK-1234A. Expected start: in about 3 weeks. We call you to schedule.');
    expect(plan.lineItems.slice(1, 4).map((l) => [l.name, l.unitPrice, l.optional, l.recommended])).toEqual([
      ['Front oak: Tree removal', 1500, false, false],
      ['Front oak: Stump grinding', 450, true, true],
      ['Planting', 2400, true, false],
    ]);
    expect(plan.lineItems[1].description).toContain('access: rear yard');
    expect(plan.lineItems[4]).toMatchObject({ name: 'Terms', textOnly: true, description: '25% to schedule, the rest when the work is done.' });
    expect(plan.discount).toEqual({ rate: 5, type: 'Percent' });
    expect(plan.deposit).toEqual({ rate: 25, type: 'Percent' });
    expect(plan.lineItems.every((l) => !('unitCost' in l))).toBe(true);
  });

  it('shows unit costs only when the owner turned it on, and leaves unpriced items off', () => {
    const def = card();
    const items = priced(def, [...ITEMS, { id: 'd', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3' } }]);
    const plan = quotePlan(def, { items, trees: TREES, unitCosts: { a: 900, b: 200, c: 1500 } });
    expect(plan.refs.filter((r) => r.kind === 'work').map((r) => r.workItemId)).toEqual(['a', 'b', 'c']);
    expect(plan.lineItems.filter((l) => !l.textOnly).map((l) => l.unitCost)).toEqual([900, 200, 1500]);
  });

  it('can resend text-only lines as $0 lines, and builds the create attributes as a draft', () => {
    const def = card();
    const plan = quotePlan(def, { items: priced(def), trees: TREES });
    const zero = withoutTextOnly(plan);
    expect(zero.lineItems.some((l) => l.textOnly)).toBe(false);
    expect(zero.lineItems[0]).toMatchObject({ name: 'Consultation', unitPrice: 0 });
    const attrs = quoteCreateAttributes(plan, 'client-1', 'prop-1');
    expect(attrs).toMatchObject({ clientId: 'client-1', propertyId: 'prop-1', title: plan.title });
    for (const k of ['message', 'quoteNumber', 'transitionQuoteTo', 'discount', 'deposit']) expect(attrs).not.toHaveProperty(k);
  });
});

describe('reading Jobber back', () => {
  const def = card();
  const plan = quotePlan(def, { items: priced(def), trees: TREES });

  it('matches each work item to its Jobber line by order and name', () => {
    const lines = plan.lineItems.map((l, i) => ({ id: `L${i}`, name: l.name, sortOrder: i + 1 }));
    expect(matchLineIds(plan, lines.reverse())).toEqual({ a: 'L1', b: 'L2', c: 'L3' });
    const renamed = plan.lineItems.map((l, i) => ({ id: `L${i}`, name: i === 2 ? 'Stump grinding (front)' : l.name, sortOrder: i + 1 }));
    expect(matchLineIds(plan, renamed)).toEqual({ a: 'L1', c: 'L3' });
  });

  it('the options the customer took: from the approved list, else from the line flags, else the defaults', () => {
    const items: Pick<PricedItem, 'id' | 'kind' | 'jobberLineId'>[] = [
      { id: 'a', kind: 'required', jobberLineId: 'L1' },
      { id: 'b', kind: 'recommended', jobberLineId: 'L2' },
      { id: 'c', kind: 'optional', jobberLineId: 'L3' },
    ];
    const lines = [{ id: 'L1', optional: false }, { id: 'L2', optional: true, recommended: false }, { id: 'L3', optional: true, recommended: true }];
    expect(chosenFromQuote(items, lines, ['L1', 'L3'])).toEqual(['c']);
    expect(chosenFromQuote(items, lines, null)).toEqual(['c']);
    expect(chosenFromQuote(items.map((i) => ({ ...i, jobberLineId: null })), lines, ['L1'])).toEqual(['b']);
  });

  it('a job covers every unlinked packet, or the packets whose lines it holds when the quote became several jobs', () => {
    const packets = [
      { id: 'p1', jobber_job_id: null, scope: [{ tree: 'Front oak', service: 'Tree removal' }] },
      { id: 'p2', jobber_job_id: null, scope: [{ tree: 'Front oak', service: 'Stump grinding' }] },
      { id: 'p3', jobber_job_id: 'J9', scope: [{ tree: null, service: 'Planting' }] },
    ];
    expect(packetsForJob(packets, 'J1', [], 1)).toEqual(['p1', 'p2']);
    expect(packetsForJob(packets, 'J1', ['front oak:  tree removal'], 2)).toEqual(['p1']);
    expect(packetsForJob(packets, 'J9', [], 2)).toEqual(['p3']);
  });

  it('the work window reads as a date or as the backlog', () => {
    expect(workWindowText('2026-11-02', 3)).toBe('from November 2');
    expect(workWindowText(null, 0.5)).toBe('within a week');
    expect(workWindowText(null, 2.6)).toBe('in about 3 weeks');
    expect(workWindowText(null, null)).toBeNull();
  });
});
