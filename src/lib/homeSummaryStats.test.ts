import { describe, it, expect } from 'vitest';
import { monthStats, monthWindows, nothingRecorded } from '../../supabase/functions/home-summary/stats';

const job = (created: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ created_at: created, workflow_status: status, completed_at: null, quote_pick: null, ...extra }) as any;

describe('dashboard month summary numbers', () => {
  it('compares this month so far with the same days of last month', () => {
    expect(monthWindows('2026-10-20')).toEqual({ current: { from: '2026-10-01', to: '2026-10-20' }, previous: { from: '2026-09-01', to: '2026-09-20' } });
  });
  it('caps last month at its own length (Mar 31 vs Feb 28)', () => {
    expect(monthWindows('2026-03-31').previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
  it('counts sold quotes by the day they were picked, only when accepted', () => {
    const s = monthStats([
      job('2026-09-25T15:00:00Z', 'job_scheduled', { quote_pick: { amount: 2500, picked_at: '2026-10-02T15:00:00Z' } }),
      job('2026-10-03T15:00:00Z', 'quote_declined', { quote_pick: { amount: 900, picked_at: '2026-10-04T15:00:00Z' } }),
    ], [], '2026-10-20');
    expect(s.current.quotes_accepted).toBe(1);
    expect(s.current.sold_amount).toBe(2500);
    expect(s.current.new_jobs).toBe(1);
    expect(s.current.lost).toBe(1);
  });
  it('leaves out last month after the matching day', () => {
    const s = monthStats([job('2026-09-25T15:00:00Z', 'open')], [], '2026-10-20');
    expect(s.previous.new_jobs).toBe(0);
  });
  it('says nothing to summarize when there is no activity', () => {
    expect(nothingRecorded(monthStats([], [], '2026-10-20'))).toBe(true);
  });
});
