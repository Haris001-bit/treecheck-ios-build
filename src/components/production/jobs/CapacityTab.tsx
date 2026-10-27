import { useMemo, useState, type ReactNode } from 'react';
import { CalendarCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { capacitySettingsOf, capacityView, suggestSlot, type CapacityRow } from '@/lib/production/capacity';
import type { SettingsRow } from '@/lib/production/client';
import type { PacketRow, WorkReply } from '@/hooks/useProductionWork';
import { today } from '@/components/production/setup/types';
import { toCapacityPacket } from './reportRows';

const human = (k: string) => k.replace(/_/g, ' ');
/** Names in sentence case ("Mini skid"), not every word capitalized. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const OPEN = ['ready', 'planned', 'scheduled', 'in_progress'];

function Rows({ title, rows, names }: { title: string; rows: CapacityRow[]; names: Record<string, string> }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      {rows.map((r) => {
        const pct = r.available > 0 ? Math.min(100, Math.round((r.demand / r.available) * 100)) : 100;
        return (
          <div key={r.key} className="space-y-1">
            <div className="flex justify-between gap-2 text-sm">
              <span>{sentence(names[r.key] ?? human(r.key))}</span>
              <span className={r.over ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                {r.demand} of {r.available} hours{r.over ? ', over capacity' : ''}
              </span>
            </div>
            <div className="h-2 rounded bg-muted overflow-hidden" aria-hidden>
              <div className={r.over ? 'h-full bg-destructive' : 'h-full bg-primary'} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Jobs > Crew work > Capacity: the next 14 days of sold work against the crews and equipment, and a day for each unplanned job. */
export function CapacityTab({ packets, settings, crewNames, canPlan, act, profile }: {
  packets: PacketRow[]; settings: SettingsRow | null; crewNames: Record<string, string>; canPlan: boolean;
  act: (body: Record<string, unknown>) => Promise<WorkReply | null>; profile?: ReactNode;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const day = today();
  const cs = useMemo(() => capacitySettingsOf(settings), [settings]);
  const cps = useMemo(() => packets.map(toCapacityPacket), [packets]);
  const view = useMemo(() => capacityView(cps, cs, day, 14), [cps, cs, day]);
  const unplanned = packets.filter((p) => OPEN.includes(p.status) && !p.planned_date && !p.scheduled_date);
  const hasCrews = Object.values(cs.crewCounts).some((n) => n > 0);

  return (
    <div className="space-y-3">
      {profile}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="font-semibold">Next 14 days</div>
          <div className="text-xs text-muted-foreground">{dayLabel(view.from)} to {dayLabel(view.to)}, {view.workingDays} working days</div>
        </div>
        {hasCrews ? (
          <>
            <Rows title="Crews" rows={view.crews} names={crewNames} />
            <Rows title="Equipment" rows={view.resources} names={{}} />
            <p className="text-xs text-muted-foreground">Sold work with a day in these two weeks, plus sold work with no day yet. The dispatcher confirms days in Jobber.</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Add how many crews you run (Settings, Crews and pricing) to see capacity.</p>
        )}
      </Card>
      <Card className="p-4 space-y-2">
        <div className="font-semibold">Jobs with no day yet</div>
        {unplanned.length === 0 && <p className="text-sm text-muted-foreground">Every open job has a day.</p>}
        {unplanned.map((p) => {
          const suggested = hasCrews ? suggestSlot(toCapacityPacket(p), cps, cs, day) : null;
          return (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 first:border-t-0 first:pt-0">
              <div className="min-w-0 text-sm">
                <div className="font-medium">{p.title}{p.estimate_number ? ` #${p.estimate_number}` : ''}{p.customer?.name ? `, ${p.customer.name}` : ''}</div>
                <div className="text-xs text-muted-foreground">
                  {p.crew?.template ? `${crewNames[p.crew.template] ?? human(p.crew.template)}, ` : ''}{p.est_hours ?? 0} hr
                  {p.scheduling_class !== 'normal' && <Badge variant="outline" className="ml-2 capitalize">{p.scheduling_class}</Badge>}
                </div>
              </div>
              {suggested ? (
                canPlan ? (
                  <Button size="sm" variant="outline" disabled={busy === p.id}
                    onClick={async () => {
                      setBusy(p.id);
                      await act({ action: 'assign', packetId: p.id, crewLeaderId: p.crew_leader_id, plannedDate: suggested, expectedUpdatedAt: p.updated_at });
                      setBusy(null);
                    }}>
                    <CalendarCheck className="w-4 h-4 mr-1" />Plan for {dayLabel(suggested)}
                  </Button>
                ) : <span className="text-xs text-muted-foreground">Suggested: {dayLabel(suggested)}</span>
              ) : <span className="text-xs text-muted-foreground">{hasCrews ? 'No free day in the next weeks' : ''}</span>}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
