// Dashboard "Welcome back" summary from Financial Pulse numbers (pulse-get's summary mode).
// Written by fixed rules, never by an AI: Plaid's agreement forbids sending bank data to any AI tool.
import type { Change, HomeSummary } from '../../../../supabase/functions/_shared/pulse/engine';
import { day, revenueWords, usd } from '../screen/pulseScreenTypes';

function moved(c: Change): string {
  if (c.amount === 0) return 'unchanged';
  const pct = c.percent == null ? '' : ` (${Math.abs(c.percent)}%)`;
  return `${c.amount > 0 ? 'up' : 'down'} ${usd(Math.abs(c.amount))}${pct}`;
}

/** Plain sentences about this month so far; null when there are no numbers this month. */
export function pulseMonthWords(summary: HomeSummary): string[] | null {
  const m = summary.month;
  if (!m || !m.current.has_data) return null;
  const { current, previous } = m;
  const rev = revenueWords(summary.revenue_basis);
  const out = [
    `So far this month (${day(current.from)} to ${day(current.to)}): ${rev.lower} ${usd(current.revenue)}, costs ${usd(current.cost)}, ${current.profit < 0 ? 'a loss of' : 'a profit of'} ${usd(Math.abs(current.profit))}.`,
  ];
  if (!previous.has_data) {
    out.push('There is nothing from last month to compare with yet.');
  } else {
    out.push(`Compared with the same days last month: profit ${moved(m.profit)}, ${rev.lower} ${moved(m.revenue)}, costs ${moved(m.cost)}.`);
    if (!m.comparable) out.push('Some of last month’s numbers are incomplete, so this comparison is rough.');
  }
  return out;
}
