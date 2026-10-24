import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CashflowSeries, RevenueBasis } from '../../../../supabase/functions/_shared/pulse/engine';
import { BAD_TEXT, GOOD_TEXT, CASHFLOW_IN_STROKE, CASHFLOW_OUT_STROKE, CHART_BORDER, CHART_MUTED } from '../tone';
import { day, revenueWords, usd } from './pulseScreenTypes';

/** Receives only engine-calculated daily totals; no queries or client-side financial aggregation. */
export function PulseCashflowChart({ series, basis, compact = false }: { series?: CashflowSeries; basis: RevenueBasis; compact?: boolean }) {
  const incoming = revenueWords(basis).title;
  const title = `${incoming} vs costs · past 30 days`;
  const hasData = series?.points.some(p => p.revenue !== null || p.cost !== null);
  return <section aria-label={title} className={compact ? 'mt-2 min-w-0' : 'space-y-2'}>
    <h2 className={compact ? 'text-xs text-muted-foreground' : 'text-lg font-bold'}>{title}</h2>
    {!series || !hasData ? <p className="py-3 text-xs text-muted-foreground">Daily numbers aren’t available yet.</p> : <>
      <div className={compact ? 'h-28 w-full min-w-0' : 'h-64 w-full min-w-0'}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series.points} accessibilityLayer margin={{ top: 8, right: 8, bottom: 0, left: compact ? 0 : 6 }}>
            <CartesianGrid vertical={false} stroke={CHART_BORDER} />
            <XAxis dataKey="date" tickFormatter={day} ticks={[series.from, series.to]} padding={{ left: 22, right: 22 }} stroke={CHART_MUTED} fontSize={11} tickLine={false} axisLine={false} interval={0} />
            <YAxis hide={compact} width={64} stroke={CHART_MUTED} fontSize={11} tickFormatter={(value: number) => usd(value)} tickLine={false} axisLine={false} />
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-sm">
              <p className="mb-1 font-bold">{day(String(label))}</p>
              {payload.map(p => <p key={String(p.dataKey)} className={p.dataKey === 'revenue' ? GOOD_TEXT : BAD_TEXT}>{p.name}: {usd(Number(p.value))}</p>)}
            </div> : null} />
            <Line name={incoming} dataKey="revenue" type="linear" stroke={CASHFLOW_IN_STROKE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
            <Line name="Costs" dataKey="cost" type="linear" stroke={CASHFLOW_OUT_STROKE} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className={`flex items-center gap-1 ${GOOD_TEXT}`}><span className="inline-block w-3 border-t-2 border-success" />{incoming}</span>
        <span className={`flex items-center gap-1 ${BAD_TEXT}`}><span className="inline-block w-3 border-t-2 border-dashed border-destructive" />Costs</span>
      </div>
      {series.partial_from && <p className="mt-1 text-xs text-muted-foreground">Partial history: some costs only count from {day(series.partial_from)}.</p>}
      {!compact && <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer py-2">Daily amounts</summary>
        <table className="w-full text-left tabular-nums"><caption className="sr-only">{title}</caption>
          <thead><tr><th className="py-1">Date</th><th>{incoming}</th><th>Costs</th></tr></thead>
          <tbody>{series.points.map(p => <tr key={p.date}><th className="py-1 font-normal">{day(p.date)}</th><td>{p.revenue === null ? 'Unavailable' : usd(p.revenue)}</td><td>{p.cost === null ? 'Unavailable' : usd(p.cost)}</td></tr>)}</tbody>
        </table>
      </details>}
    </>}
  </section>;
}