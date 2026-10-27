// Large-company setup: pricing a whole crew estimate (the screen's preview and the server's save run this same code).
import { describe, expect, it } from 'vitest';
import { priceSheetCard } from './testing/priceSheetFixture';
import { approvedItems, priceEstimate, type EstimateItemInput } from './estimate';

const DAY = '2026-10-26';
const item = (id: string, serviceKey: string, answers: EstimateItemInput['answers'], over: Partial<EstimateItemInput> = {}): EstimateItemInput =>
  ({ id, serviceKey, treeKey: 't1', kind: 'required', answers, ...over });

describe('priceEstimate', () => {
  it('prices every item from the card and totals what counts', () => {
    const r = priceEstimate(priceSheetCard(), [
      item('a', 'removal', { crew: 'crew3', hours: 4 }),
      item('b', 'stump', { stump_diameter: 30 }, { kind: 'recommended' }),
      item('c', 'planting', { type: 'shade', size: '3in' }, { kind: 'optional' }),
    ], { day: DAY, discountKey: 'veteran', paymentPlanKey: 'deposit_25' });
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.price)).toEqual([1500, 450, 2400]);
    expect(r.items[0].production?.manHours).toBe(12);
    expect(r.totals.subtotal).toBe(1950);
    expect(r.totals.optionalTotal).toBe(2400);
    expect(r.totals.total).toBe(1852.5);
    expect(r.totals.deposit?.amount).toBe(463.13);
  });

  it('a material override needs a reason; a small one does not', () => {
    const def = priceSheetCard();
    const removal = { crew: 'crew3', hours: 4 };
    const lower = priceEstimate(def, [item('a', 'removal', removal, { sell: 1200 })], { day: DAY });
    expect(lower.ok).toBe(false);
    expect(lower.items[0]).toMatchObject({ status: 'needs_reason', price: null, engineAmount: 1500 });
    const reasoned = priceEstimate(def, [item('a', 'removal', removal, { sell: 1200, overrideReason: 'Competitive situation' })], { day: DAY });
    expect(reasoned.items[0]).toMatchObject({ status: 'ok', price: 1200, override: { from: 1500, to: 1200, reason: 'Competitive situation', material: true } });
    expect(reasoned.totals.total).toBe(1200);
    const small = priceEstimate(def, [item('a', 'removal', removal, { sell: 1520 })], { day: DAY });
    expect(small.items[0]).toMatchObject({ status: 'ok', price: 1520 });
  });

  it('reports missing answers, services not offered and services no longer on the card, without pricing them', () => {
    const r = priceEstimate(priceSheetCard(), [
      item('a', 'removal', { crew: 'crew3' }),
      item('b', 'basal_bark', {}),
      item('c', 'gone', {}),
    ], { day: DAY });
    expect(r.ok).toBe(false);
    expect(r.items.map((i) => i.status)).toEqual(['missing', 'not_offered', 'unknown_service']);
    expect(r.items.every((i) => i.price === null)).toBe(true);
    expect(r.totals.total).toBe(0);
    expect(r.problems).toHaveLength(3);
  });

  it('an empty estimate is not ready', () => {
    expect(priceEstimate(priceSheetCard(), [], { day: DAY }).ok).toBe(false);
  });
});

describe('approvedItems', () => {
  const items = [
    { id: 'a', kind: 'required' as const },
    { id: 'b', kind: 'recommended' as const },
    { id: 'c', kind: 'optional' as const },
    { id: 'd', kind: 'recommended' as const, selected: false },
  ];
  it('keeps the required items and the options the customer chose', () => {
    expect(approvedItems(items, ['c']).map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('with no choice given, recommended items stay unless turned down and optional ones drop', () => {
    expect(approvedItems(items, null).map((i) => i.id)).toEqual(['a', 'b']);
  });
});
