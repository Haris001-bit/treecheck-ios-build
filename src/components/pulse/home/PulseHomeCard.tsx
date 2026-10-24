// Financial Pulse on Home: this month so far against the same days of last month (pulse-get's summary mode,
// engine-6). Pulse code: Home.tsx only places it and never reads Pulse data itself. It shows numbers only,
// never a bank name, an account or a transaction. Theme tokens only.
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, LineChart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { usePulseAccess } from '@/hooks/pulse/usePulseAccess';
import { pulseHomeSummary } from '@/lib/pulse/api';
import type { Change } from '../../../../supabase/functions/_shared/pulse/engine';
import { agoText, day, revenueWords, upDownText, usd } from '../screen/pulseScreenTypes';
import { changeTone, homeStateOf, type PulseHomeState } from './homeState';
import { amountTone } from '../tone';
import { PulseCashflowChart } from '../screen/PulseCashflowChart';

function Shell({ subtitle, button, children }: { subtitle: string; button: string; children?: ReactNode }) {
  return (
    <section aria-label="Financial Pulse" className="flex flex-col gap-3 border-t border-border py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <LineChart className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-base font-bold">Financial Pulse</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          {children}
        </div>
      </div>
      <Button asChild variant="outline" className="shrink-0 self-start sm:self-center">
        <Link to="/dashboard/pulse">{button}<ArrowRight /></Link>
      </Button>
    </section>
  );
}

const note = (text: string) => <p className="text-xs text-muted-foreground" role="status">{text}</p>;

function Row({ label, amount, change, costRow, fair, compare }: { label: string; amount: number; change: Change; costRow: boolean; fair: boolean; compare: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">
        <span className={amountTone(amount, costRow)}>{usd(amount)}</span>{compare && <> <span className={`text-xs ${changeTone(change, costRow, fair)}`}>{upDownText(change)}</span></>}
      </span>
    </div>
  );
}

/** The card for one state. Pure, so every state can be shown and tested without the server. */
export function PulseHomeCardView({ state }: { state: PulseHomeState }) {
  switch (state.kind) {
    case 'not_allowed':
      return <Shell subtitle="Connect bank + Jobber · month-to-date trends" button="Set up" />;
    case 'loading':
      return <Shell subtitle="Month to date vs last month" button="Open Pulse">{note('Loading…')}</Shell>;
    case 'setup':
      return <Shell subtitle="Month to date vs last month" button="Finish setup">{note('Finish setting up Pulse to see this month’s numbers here.')}</Shell>;
    case 'error':
      return <Shell subtitle="Month to date vs last month" button="Open Pulse">{note('Couldn’t load your numbers here. Open Pulse to see them.')}</Shell>;
    case 'arriving':
      return <Shell subtitle="Month to date vs last month" button="Open Pulse">{note('Your first numbers are still coming in.')}</Shell>;
    case 'empty':
      return <Shell subtitle="Month to date vs last month" button="Open Pulse">{note('No numbers yet this month.')}</Shell>;
    case 'numbers': {
      const { summary, nowMs } = state;
      const m = summary.month;
      if (!m) return <Shell subtitle="Month to date vs last month" button="Open Pulse">{note("No numbers yet this month.")}</Shell>;
      const { current, previous } = m;
      const hasPrev = previous.has_data;
      const fair = hasPrev && m.comparable;
      const loss = current.profit < 0;
      const updatedHours = summary.updated_at ? (nowMs - Date.parse(summary.updated_at)) / 3_600_000 : null;
      const roughFrom = current.partial_from ?? previous.partial_from;
      return (
        <Shell subtitle={`${day(current.from)} to ${day(current.to)} vs ${day(previous.from)} to ${day(previous.to)}`} button="Open Pulse">
          <div>
            <p className="text-xs text-muted-foreground">{loss ? 'Loss so far this month' : 'Profit so far this month'}</p>
            <p className={`home-number text-3xl font-black tabular-nums ${amountTone(current.profit)}`}>{usd(current.profit)}</p>
            {hasPrev && (
              <p className={`text-xs ${changeTone(m.profit, false, fair)}`}>{upDownText(m.profit)} vs the same days last month</p>
            )}
          </div>
          <div className="space-y-1">
            <Row label={revenueWords(summary.revenue_basis).title} amount={current.revenue} change={m.revenue} costRow={false} fair={fair} compare={hasPrev} />
            <Row label="Costs" amount={current.cost} change={m.cost} costRow fair={fair} compare={hasPrev} />
          </div>
          <PulseCashflowChart series={summary.cashflow_30} basis={summary.revenue_basis} compact />
          {!hasPrev && note('Nothing to compare with last month yet.')}
          {hasPrev && !m.comparable && note(`Rough comparison: some numbers only count from ${roughFrom ? day(roughFrom) : 'recently'}.`)}
          {updatedHours !== null && Number.isFinite(updatedHours) && note(`Updated ${agoText(Math.max(0, updatedHours))}`)}
        </Shell>
      );
    }
  }
}

/** Home's Pulse card: owners with Pulse switched on see their numbers; everyone else sees Set up. */
export function PulseHomeCard() {
  const { loading, allowed, ownerId } = usePulseAccess();
  const query = useQuery({
    queryKey: ['pulse', ownerId, 'home-summary'],
    queryFn: pulseHomeSummary,
    enabled: allowed && !!ownerId,
    staleTime: 60_000,
    retry: 1,
  });
  let state: PulseHomeState;
  if (loading) state = { kind: 'loading' };
  else if (!allowed) state = { kind: 'not_allowed' };
  else if (!query.data) state = { kind: 'loading' };
  else state = homeStateOf(query.data, Date.now());
  return <PulseHomeCardView state={state} />;
}
