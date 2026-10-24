import { describe, it, expect } from 'vitest';
import { buildProductionPlan, computeCost, recommendPrice, evaluatePrice, ballparkStatus } from './engine';
import { fromScoutCapture } from './fromScoutCapture';

const cfg = {
  laborRates: { climber: 42, ground: 29, crew_lead: 38 },
  equipmentRates: { chipper: 25, chip_truck: 20, mini_skid: 30 },
  targetMargin: 0.3, minimumJobCharge: 500, disposalPerLoad: 50,
};

describe('production engine', () => {
  it('uses gross-margin math, not markup', () => {
    const r = recommendPrice(1750, { targetMargin: 0.3 });
    expect(r.price).toBe(2500);
    expect(r.grossMargin).toBeCloseTo(0.3, 5);
  });
  it('applies minimum job charge', () => {
    const r = recommendPrice(200, { targetMargin: 0.3, minimumJobCharge: 500 });
    expect(r.price).toBe(500);
    expect(r.minimumApplied).toBe(true);
  });
  it('evaluates a lower final price', () => {
    const e = evaluatePrice(2350, 1750);
    expect(e.grossProfit).toBe(600);
    expect(e.grossMargin).toBeCloseTo(0.2553, 3);
  });
  it('costs labor by role quantity × hours × rate', () => {
    const c = computeCost({ crew: [{ roleKey: 'climber', count: 1, hours: 5.5 }, { roleKey: 'ground', count: 2, hours: 5.5 }], equipment: [], loads: 2 }, cfg);
    expect(c.labor).toBe(550);
    expect(c.disposal).toBe(100);
  });
  it('is low confidence and review-flagged with no inputs', () => {
    const p = buildProductionPlan({});
    expect(p.confidence).toBe('low');
    expect(p.reviewRecommended).toBe(true);
    expect(p.assumptions.some((a) => a.includes('DBH unknown'))).toBe(true);
  });
  it('is high confidence with all key inputs known', () => {
    const p = buildProductionPlan({
      dbhInches: { value: 28, source: 'known' }, heightFt: { value: 58, source: 'known' },
      access: { value: 'moderate', source: 'known' }, dropZone: { value: 'restricted', source: 'known' },
    });
    expect(p.confidence).toBe('high');
    expect(p.method).toBe('climbing_rigging');
  });
  it('ignores climber crew/hours fields', () => {
    const base = { diameter_inches: 28, ai_notes: 'about 55-60 ft, house nearby' };
    const a = buildProductionPlan(fromScoutCapture(base));
    const b = buildProductionPlan(fromScoutCapture({ ...base, wk_ground_crew: 9, wk_hours: 40 }));
    expect(b).toEqual(a);
  });
  it('ballpark status', () => {
    expect(ballparkStatus(2500, 2100, 2800)).toBe('within');
    expect(ballparkStatus(3000, 2100, 2800)).toBe('above');
    expect(ballparkStatus(1000, null, null)).toBe('none');
  });
});
