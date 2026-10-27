import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import type { ProductionStatus } from '@/lib/production/client';
import type { Rate, Report } from '@/lib/production/reports';
import { dollars } from '@/lib/production/answers';
import type { RateCardDefinition } from '@/lib/production/rules';

const percent = (v: number | null | undefined) => (v === null || v === undefined ? 'none yet' : `${Math.round(v * 100)}%`);
const vsEstimate = (ratio: number) => (ratio === 0 ? 'none yet' : `${ratio >= 1 ? '+' : ''}${Math.round((ratio - 1) * 100)}% against the estimate`);
const human = (k: string) => k.replace(/_/g, ' ');
/** Labels in sentence case ("1 to 2 weeks booked"), not every word capitalized. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function RateTable({ title, rows, format, hint }: { title: string; rows: Rate[]; format: (v: number) => string; hint?: string }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      <div className="divide-y text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex justify-between gap-2 py-1">
            <span>{sentence(human(r.label))}</span>
            <span className="text-muted-foreground">{format(r.value)} <span className="text-xs">({r.n})</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Card className="p-4 space-y-3"><div className="font-semibold">{title}</div>{children}</Card>
);

/**
 * Jobs > Crew work > Reports: did we estimate the resources right, and did the price produce the economics we
 * expected? Each part shows only to the people who may read it: hours to the office, prices and win rates to sales
 * and the office, costs and margins only to the owner and the cost viewers (the report hook reads accordingly).
 */
export function ReportsTab({ report, isLoading, can, def }: { report: Report; isLoading: boolean; can: ProductionStatus['can']; def: RateCardDefinition | null }) {
  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const mh = report.manHours;

  return (
    <div className="space-y-3">
      {report.insights.length > 0 && (
        <Section title="What the finished jobs say">
          <ul className="list-disc pl-5 text-sm space-y-1">{report.insights.map((s) => <li key={s}>{s}</li>)}</ul>
        </Section>
      )}
      <Section title="Estimated against actual">
        {report.jobsWithActuals === 0 ? (
          <p className="text-sm text-muted-foreground">Reports fill in as crew leaders enter the actual hours on finished jobs.</p>
        ) : (
          <>
            <div className="text-sm">{report.jobsWithActuals} finished job{report.jobsWithActuals === 1 ? '' : 's'}: {mh.estimated} man-hours estimated, {mh.actual} actual{mh.diffPct !== null ? ` (${mh.diffPct >= 0 ? '+' : ''}${Math.round(mh.diffPct * 100)}%)` : ''}.</div>
            {report.equipmentHours.length > 0 && (
              <div className="divide-y text-sm">
                {report.equipmentHours.map((e) => (
                  <div key={e.key} className="flex justify-between gap-2 py-1"><span>{sentence(human(e.key))} hours</span><span className="text-muted-foreground">{e.estimated} estimated, {e.actual} actual</span></div>
                ))}
              </div>
            )}
            <RateTable title="By estimator" rows={report.accuracy.byEstimator} format={vsEstimate} />
            <RateTable title="By tree size" rows={report.accuracy.bySize} format={vsEstimate} />
            <RateTable title="By access" rows={report.accuracy.byAccess} format={vsEstimate} />
            <RateTable title="By equipment" rows={report.accuracy.byEquipment} format={vsEstimate} />
          </>
        )}
      </Section>
      {can.price && (
        <>
          <Section title="Revenue per actual man-hour">
            <div className="text-sm">
              {report.revenuePerManHour.overall !== null ? `${dollars(report.revenuePerManHour.overall)} overall` : 'None yet.'}
              {def?.pricing.manHourRate ? `, target ${dollars(def.pricing.manHourRate)}` : ''}
            </div>
            <RateTable title="By crew" rows={report.revenuePerManHour.byCrew} format={dollars} />
            <RateTable title="By kind of work" rows={report.revenuePerManHour.byService} format={dollars} />
          </Section>
          <Section title="Win rate">
            <div className="text-sm">{report.winRate.overall === null || report.winRate.overall === undefined ? 'No estimate won or lost yet.' : `${percent(report.winRate.overall)} of decided estimates won.`}</div>
            <RateTable title="By price" rows={report.winRate.byPriceBand} format={(v) => percent(v)} />
            <RateTable title="By salesperson" rows={report.winRate.bySalesperson} format={(v) => percent(v)} />
            <RateTable title="By how booked we were when it was sent" rows={report.winRate.byBacklog} format={(v) => percent(v)} />
          </Section>
          <Section title="Price changes">
            <div className="text-sm">
              {report.overrides.share === null || report.overrides.share === undefined ? 'No priced work yet.' : (
                <>
                  {percent(report.overrides.share)} of priced work was changed by hand ({percent(report.overrides.lowerShare)} lower, {percent(report.overrides.higherShare)} higher).
                  {report.overrides.winOverridden !== null && report.overrides.winOverridden !== undefined && <>{' '}Won: {percent(report.overrides.winOverridden)} with a change, {percent(report.overrides.winStandard)} without.</>}
                </>
              )}
            </div>
            <RateTable title="Reasons" rows={report.overrides.byReason} format={(v) => percent(v)} />
          </Section>
        </>
      )}
      {report.costs && (
        <Section title="Cost and margin">
          <div className="text-sm">Finished jobs: {dollars(report.costs.estimated)} estimated cost, {dollars(report.costs.actual)} extra expenses entered.</div>
          <RateTable title="Margin by service" rows={report.costs.marginByService} format={(v) => percent(v)} />
        </Section>
      )}
    </div>
  );
}
