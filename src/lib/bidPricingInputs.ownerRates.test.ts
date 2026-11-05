import { describe, it, expect } from 'vitest';
import { withBidExtras, withOwnerRates } from './bidPricingInputs';

const card = { labor_rate: 30, disposal_per_load: 60, mini_skid_rate: 50, mini_skid_rate_type: 'hour' };
const skidBid = { needs_mini_skid: true, est_hours: 4 };

describe('Settings rates reach Jobs', () => {
  it('mini skid uses the Settings rate ($50/hr) when the job has none', () => {
    expect(withBidExtras(withOwnerRates({}, card), skidBid).equipmentCost).toBe(200);
  });
  it('labor and dump fee follow Settings', () => {
    const out = withOwnerRates({}, card);
    expect(out.laborRate).toBe(30);
    expect(out.disposalRate).toBe(60);
  });
  it('a rate typed on the job still wins', () => {
    expect(withOwnerRates({ miniSkidRate: 75 }, card).miniSkidRate).toBe(75);
  });
  it('day rate charges once per 8-hour day', () => {
    const out = withBidExtras(withOwnerRates({}, { ...card, mini_skid_rate_type: 'day', mini_skid_rate: 300 }), { needs_mini_skid: true, est_hours: 10 });
    expect(out.equipmentCost).toBe(600);
  });
});
