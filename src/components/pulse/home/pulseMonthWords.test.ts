import { describe, it, expect } from 'vitest';
import { pulseMonthWords } from './pulseMonthWords';

const summary = (prevHas: boolean) => ({
  engine_version: 'x', today: '2026-10-20', revenue_basis: 'payments', updated_at: null, arriving: false,
  month: {
    comparable: true,
    current: { from: '2026-10-01', to: '2026-10-20', revenue: 30000, cost: 18000, profit: 12000, has_data: true, partial_from: null },
    previous: { from: '2026-09-01', to: '2026-09-20', revenue: 25000, cost: 20000, profit: 5000, has_data: prevHas, partial_from: null },
    revenue: { amount: 5000, percent: 20 }, cost: { amount: -2000, percent: -10 }, profit: { amount: 7000, percent: 140 },
  },
}) as any;

describe('Pulse welcome summary (fixed rules, no AI)', () => {
  it('states this month and the change from the same days last month', () => {
    const w = pulseMonthWords(summary(true))!.join(' ');
    expect(w).toContain('payments received $30,000, costs $18,000, a profit of $12,000');
    expect(w).toContain('profit up $7,000 (140%)');
    expect(w).toContain('costs down $2,000 (10%)');
  });
  it('says there is nothing to compare when last month has no numbers', () => {
    expect(pulseMonthWords(summary(false))!.join(' ')).toContain('nothing from last month');
  });
});
