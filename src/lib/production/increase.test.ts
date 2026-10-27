// Large-company setup, PR5: acting on the profile advice puts a crew-time price increase into a draft card.
import { describe, expect, it } from 'vitest';
import { priceSheetCard } from './testing/priceSheetFixture';
import { applyIncrease, recommendProfile } from './profiles';
import { priceWorkItem } from './pricing';

const removal = (def: ReturnType<typeof priceSheetCard>, answers: Record<string, string | number>) => {
  const r = priceWorkItem(def, def.services.find((s) => s.key === 'removal')!, answers, { day: '2026-10-26' });
  return r.kind === 'ok' ? r.engineAmount : null;
};

describe('applyIncrease', () => {
  it('per man-hour: the rates and day prices go up, nothing else changes', () => {
    const def = priceSheetCard();
    const advice = recommendProfile(def, { backlogWeeks: 3.2, realizedRate: 111, targetRate: 125 });
    expect(advice.increase).toEqual({ low: 6, high: 9 });
    const raised = applyIncrease(def, 9);
    expect(raised.pricing.manHourRate).toBe(136);
    const removalSvc = raised.services.find((s) => s.key === 'removal')!;
    expect(removalSvc.strategy.kind === 'crew_time' && removalSvc.strategy.floors?.[0].price).toBe(5450);
    expect(removal(raised, { crew: 'crew3', hours: 4 })).toBe(1632);
    expect(raised.services.find((s) => s.key === 'stump')).toEqual(def.services.find((s) => s.key === 'stump'));
    expect(def.pricing.manHourRate).toBe(125);
  });

  it('pay plus a target return: the margin rises so selling rates go up by the same percent, to be worked out at publish', () => {
    const def = priceSheetCard();
    def.pricing.method = 'cost_plus';
    def.pricing.targetMargin = 0.3;
    def.pricing.derivedRates = { roles: { climber: 60 }, equipment: {} };
    const raised = applyIncrease(def, 10);
    expect(raised.pricing.targetMargin).toBe(0.364);
    expect(raised.pricing.derivedRates).toBeUndefined();
    // Same pay: 42 / (1 - 0.3) = 60 before, 42 / (1 - 0.364) = 66 after, 10% more.
    expect(Math.round(42 / (1 - raised.pricing.targetMargin!))).toBe(66);
  });
});
