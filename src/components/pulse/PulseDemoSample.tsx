// Demo (sandbox) logins see this labeled, fictional Pulse page instead of real Pulse: the demo company has no
// bank or Jobber account, and no real Pulse data is ever read here.
import { ArrowUpRight, ArrowDownRight, LineChart } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { BAD_TEXT, CASHFLOW_IN_STROKE, CASHFLOW_OUT_STROKE, CHART_BORDER, GOOD_TEXT } from './tone';

const IN = '0.0,94 10.7,100 21.3,100 32.0,100 42.7,55 53.3,96 64.0,100 74.7,90 85.3,86 96.0,100 106.7,100 117.3,100 128.0,97 138.7,8 149.3,94 160.0,90 170.7,96 181.3,97 192.0,40 202.7,92 213.3,98 224.0,100 234.7,97 245.3,62 256.0,100 266.7,100 277.3,25 288.0,96 298.7,100 309.3,94 320.0,50';
const OUT = '0.0,88 10.7,91 21.3,100 32.0,100 42.7,87 53.3,92 64.0,91 74.7,95 85.3,90 96.0,100 106.7,100 117.3,96 128.0,95 138.7,92 149.3,70 160.0,100 170.7,98 181.3,78 192.0,94 202.7,96 213.3,91 224.0,88 234.7,96 245.3,94 256.0,97 266.7,100 277.3,86 288.0,90 298.7,97 309.3,95 320.0,100';

const COSTS: [string, number][] = [
  ['Crew & subcontractors', 21450], ['Fuel', 3820], ['Equipment & repairs', 2960],
  ['Dump & disposal fees', 1740], ['Insurance', 1380], ['Marketing', 950],
];
const PAYMENTS: [string, string, number][] = [
  ['Oct 26', 'Removal · Edmond', 4200], ['Oct 24', 'Removal + stump · OKC', 3650],
  ['Oct 22', 'Pruning · Nichols Hills', 1850], ['Oct 20', 'Removal · Moore', 2900],
];
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

export function PulseDemoSample() {
  const totalCosts = COSTS.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <header>
        <p className="text-xs text-primary">TREECHECK</p>
        <h1 className="flex items-center gap-2 text-2xl font-light"><LineChart className="h-5 w-5 text-primary" />Financial Pulse</h1>
        <p className="mt-1 text-xs text-muted-foreground">Demo company · illustrative sample data, not actual results</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Payments in · month to date</p><p className={`mt-1 text-3xl font-black tabular-nums ${GOOD_TEXT}`}>{usd(50750)}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Costs out · month to date</p><p className={`mt-1 text-3xl font-black tabular-nums ${BAD_TEXT}`}>{usd(32300)}</p></Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Profit · month to date</p>
          <p className={`mt-1 text-3xl font-black tabular-nums ${GOOD_TEXT}`}>{usd(18450)}</p>
          <p className={`mt-1 flex items-center gap-1 text-xs ${GOOD_TEXT}`}><ArrowUpRight className="h-4 w-4" />24% ahead of the same days last month</p>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm text-muted-foreground">Payments vs costs · past 30 days</h2>
        <div role="img" aria-label="Line chart of payments versus costs over the past 30 days" className="mt-3">
          <svg viewBox="0 0 320 110" className="h-40 w-full" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2="320" y1="100" y2="100" stroke={CHART_BORDER} strokeWidth="1" />
            <line x1="0" x2="320" y1="55" y2="55" stroke={CHART_BORDER} strokeWidth="0.5" />
            <line x1="0" x2="320" y1="10" y2="10" stroke={CHART_BORDER} strokeWidth="0.5" />
            <polyline fill="none" stroke={CASHFLOW_OUT_STROKE} strokeWidth="1.5" strokeDasharray="4 3" points={OUT} />
            <polyline fill="none" stroke={CASHFLOW_IN_STROKE} strokeWidth="2" points={IN} />
          </svg>
          <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ backgroundColor: CASHFLOW_IN_STROKE }} />Payments in</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ backgroundColor: CASHFLOW_OUT_STROKE }} />Costs out</span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-sm text-muted-foreground">Where the money went</h2>
          <div className="space-y-2">
            {COSTS.map(([name, v]) => (
              <div key={name}>
                <div className="flex justify-between text-sm"><span>{name}</span><span className="tabular-nums">{usd(v)}</span></div>
                <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-destructive/70" style={{ width: `${Math.round((v / totalCosts) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          <p className={`mt-3 flex items-center gap-1 text-xs ${BAD_TEXT}`}><ArrowDownRight className="h-4 w-4" />Fuel is up 12% vs last month</p>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-sm text-muted-foreground">Recent payments</h2>
          <div className="divide-y divide-border">
            {PAYMENTS.map(([d, what, v]) => (
              <div key={d + what} className="flex justify-between py-2 text-sm">
                <span><span className="text-muted-foreground">{d}</span> · {what}</span>
                <span className={`tabular-nums ${GOOD_TEXT}`}>+{usd(v)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">Sample numbers for demos. Real companies see their own bank and Jobber numbers here.</p>
    </div>
  );
}
