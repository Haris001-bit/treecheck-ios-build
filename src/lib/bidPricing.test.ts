import { describe, expect, it } from 'vitest';
import { calculatePricing, normalizeCosts, calculateAtSale } from './bidPricing';

describe('acceptance test 1 — simple reverse bid', () => {
  const r = calculatePricing({
    crewMinimum: 600,
    crewShare: 0.4,
    laborFlat: 300,
    disposalFlat: 400,
    fixedDollar: 300,
    estimatorPercent: 0,
    otherCosts: 0,
    ownerMinimum: 0.3,
  });
  it('base sale is 2500', () => expect(r.baseSale).toBe(2500));
  it('climber gets 600, owner 900 at 36%', () => {
    expect(Math.round(r.baseBreakdown!.crew)).toBe(600);
    expect(Math.round(r.baseBreakdown!.owner)).toBe(900);
    expect(r.baseBreakdown!.ownerPercent).toBeCloseTo(0.36, 4);
  });
  it('owner minimum satisfied', () => expect(r.ownerMinimum.passes).toBe(true));
});

describe('acceptance test 2 — crew calculation', () => {
  const c = normalizeCosts({ crewSize: 3, jobHours: 4, disposalLoads: 2, laborRate: 33 });
  it('grounds = 396', () => expect(c.grounds).toBe(396));
  it('disposal = 160', () => expect(c.disposal).toBe(160));
  it('man-hours are not multiplied by crew size again', () => {
    expect(normalizeCosts({ crewSize: 3, totalLaborHours: 15, laborRate: 33 }).grounds).toBe(495);
  });
});

describe('acceptance test 3 — forward owner adjustment', () => {
  const r = calculatePricing({
    salePrice: 1200,
    fixedDollar: 300,
    laborFlat: 300,
    disposalFlat: 400,
    crewShare: 0.4,
    ownerMinimum: 0.3,
  });
  it('adjusts to 2000', () => {
    expect(r.enteredSale).toBe(1200);
    expect(r.adjustedBaseSale).toBe(2000);
    expect(r.baseSale).toBe(2000);
  });
  it('net 1000 / climber 400 / owner 600 at 30%', () => {
    expect(Math.round(r.baseBreakdown!.net)).toBe(1000);
    expect(Math.round(r.baseBreakdown!.crew)).toBe(400);
    expect(Math.round(r.baseBreakdown!.owner)).toBe(600);
    expect(r.baseBreakdown!.ownerPercent).toBeCloseTo(0.3, 4);
  });
});

describe('acceptance test 4 — percentage fixed cost', () => {
  const r = calculatePricing({
    salePrice: 500,
    fixedDollar: 0,
    fixedPercent: 0.3,
    crewShare: 0.4,
    laborFlat: 400,
    disposalFlat: 0,
    ownerMinimum: 0.3,
  });
  it('required sale is 2000', () => expect(r.baseSale).toBe(2000));
});

describe('acceptance test 5 — minimum and ideal', () => {
  const r = calculatePricing({
    crewMinimum: 600,
    crewIdeal: 800,
    crewSize: 3,
    jobHours: 4,
    disposalLoads: 2, laborRate: 33,
    fixedDollar: 300,
    crewShare: 0.4,
  });
  it('costs', () => {
    expect(r.costs.grounds).toBe(396);
    expect(r.costs.disposal).toBe(160);
  });
  it('floor 2356 / base 2856', () => {
    expect(r.minimumSaleFloor).toBe(2356);
    expect(r.baseSale).toBe(2856);
  });
  it('+10% 3142 / +15% 3284', () => {
    expect(r.plus10Sale).toBe(3142);
    expect(r.plus15Sale).toBe(3284);
  });
  it('safe rounded quotes never dip below base', () => {
    expect(r.rounded25Quote).toBe(2875);
    expect(r.rounded50Quote).toBe(2900);
  });
});

describe('guardrails', () => {
  it('flags infeasible percentage costs', () => {
    const r = calculatePricing({ crewMinimum: 600, fixedPercent: 0.7, estimatorPercent: 0.4 });
    expect(r.baseSale).toBeNull();
    expect(r.warnings[0]).toMatch(/infeasible/i);
  });
  it('flags a losing job', () => {
    const r = calculatePricing({ salePrice: 200, fixedDollar: 300, laborFlat: 500, ownerMinimumEnabled: false });
    expect(r.warnings.join(' ')).toMatch(/lose money/i);
  });
  it('never rounds the climber below his minimum', () => {
    const r = calculatePricing({ crewMinimum: 601.37, crewShare: 0.4, fixedDollar: 0, laborFlat: 0, disposalFlat: 0 });
    expect(calculateAtSale(r.baseSale!, normalizeCosts({ crewShare: 0.4, fixedDollar: 0, laborFlat: 0, disposalFlat: 0 })).crew).toBeGreaterThanOrEqual(601.37);
  });
  it('raises the price for the owner minimum without changing the climber payout', () => {
    const r = calculatePricing({ crewMinimum: 900, crewShare: 0.8, fixedDollar: 0, laborFlat: 0, disposalFlat: 0, ownerMinimum: 0.3 });
    expect(r.ownerMinimum.passes).toBe(true);
    expect(Math.round(r.baseBreakdown!.crew)).toBe(900);
    expect(r.plus15Breakdown!.crew).toBe(900);
  });
});
