import { describe, it, expect } from 'vitest';
import {
  calculateWorksheet,
  worksheetHasInput,
  DEFAULT_RATE_CARD,
  EMPTY_WORKSHEET,
  type WorksheetInputs,
} from './scoutWorksheet';

const wk = (over: Partial<WorksheetInputs>): WorksheetInputs => ({ ...EMPTY_WORKSHEET, ...over });

describe('scout worksheet — reverse-engineered price from costs + target profit', () => {
  it('prices 1750 of costs at 30% profit to 2500', () => {
    // climber 800 + crew 2×5×25=250 + disposal 2×100=200 + mini skid 5×100=500
    const r = calculateWorksheet(
      wk({ climberPayout: 800, groundCrew: 2, hours: 5, loads: 2, miniSkid: true }),
      { ...DEFAULT_RATE_CARD, disposal_per_load: 100 },
    );
    expect(r.subtotal).toBe(1750);
    expect(r.total).toBe(2500);
    expect(r.profit).toBe(750);
  });

  it('with 0% target profit the price equals the costs', () => {
    const r = calculateWorksheet(
      wk({ climberPayout: 500, groundCrew: 1, hours: 4 }),
      { ...DEFAULT_RATE_CARD, target_profit_pct: 0 },
    );
    expect(r.subtotal).toBe(600); // 500 + 1×4×25
    expect(r.total).toBe(600);
    expect(r.profit).toBe(0);
  });

  it('never prices below the minimum job price', () => {
    const r = calculateWorksheet(
      wk({ groundCrew: 1, hours: 4 }), // 100 of costs → 142.86 at 30%
      { ...DEFAULT_RATE_CARD, minimum_job_price: 500 },
    );
    expect(r.total).toBe(500);
    expect(r.profit).toBe(400);
  });

  it('charges crane time at the pay rate plus the mobilization fee', () => {
    const r = calculateWorksheet(
      wk({ craneRequired: true, craneHours: 3 }),
      { ...DEFAULT_RATE_CARD, crane_hourly: 350, crane_mobilization_fee: 200, target_profit_pct: 0 },
    );
    expect(r.subtotal).toBe(1250); // 3×350 + 200
    expect(r.total).toBe(1250);
  });

  it('prices stump grinding by diameter from the sub’s rates', () => {
    const r = calculateWorksheet(
      wk({ stump: true, stumpDiameterInches: 18 }),
      { ...DEFAULT_RATE_CARD, target_profit_pct: 0 },
    );
    expect(r.subtotal).toBe(292); // 250 up to 12" + 6" × 7
  });

  it('prices the chipper per day flat or per hour on site', () => {
    const perDay = calculateWorksheet(
      wk({ chipper: true, hours: 6 }),
      { ...DEFAULT_RATE_CARD, chipper_rate: 400, chipper_rate_type: 'day', target_profit_pct: 0 },
    );
    expect(perDay.subtotal).toBe(400);
    const perHour = calculateWorksheet(
      wk({ chipper: true, hours: 6 }),
      { ...DEFAULT_RATE_CARD, chipper_rate: 75, chipper_rate_type: 'hour', target_profit_pct: 0 },
    );
    expect(perHour.subtotal).toBe(450);
  });

  it('adds the per-job overhead to priced jobs and respects it in the profit math', () => {
    const r = calculateWorksheet(
      wk({ climberPayout: 500, groundCrew: 1, hours: 4 }),
      { ...DEFAULT_RATE_CARD, overhead_per_job: 200, target_profit_pct: 30 },
    );
    // 500 + 100 crew + 200 overhead = 800 costs → 800/0.7 = 1142.86
    expect(r.subtotal).toBe(800);
    expect(r.total).toBe(1142.86);
    expect(r.lines.some((l) => l.label === 'Overhead' && l.amount === 200)).toBe(true);
  });

  it('never adds overhead to an empty worksheet', () => {
    const r = calculateWorksheet(
      EMPTY_WORKSHEET,
      { ...DEFAULT_RATE_CARD, overhead_per_job: 200 },
    );
    expect(r.subtotal).toBe(0);
    expect(r.total).toBe(0);
  });

  it('has no input when nothing is filled in, and input with only a climber payout', () => {
    expect(worksheetHasInput(EMPTY_WORKSHEET)).toBe(false);
    expect(worksheetHasInput(wk({ climberPayout: 800 }))).toBe(true);
  });
});
