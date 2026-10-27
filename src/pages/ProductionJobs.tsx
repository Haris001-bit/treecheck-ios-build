import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, Gavel, Loader2, MapPin, Phone, Play, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProductionStatus } from '@/hooks/useProductionStatus';
import { useQuery } from '@tanstack/react-query';
import { useProductionWork, useProductionCard, productionCall, type PacketRow, type WorkReply } from '@/hooks/useProductionWork';
import { useProductionReport } from '@/hooks/useProductionReport';
import { backlogWeeks, capacitySettingsOf } from '@/lib/production/capacity';
import { CapacityTab } from '@/components/production/jobs/CapacityTab';
import { ReportsTab } from '@/components/production/jobs/ReportsTab';
import { ProfileCard } from '@/components/production/jobs/ProfileCard';
import { JobberRequests } from '@/components/production/jobs/JobberRequests';
import { toCapacityPacket } from '@/components/production/jobs/reportRows';
import { useCompanySettings, usesSubs } from '@/hooks/useCompanySettings';
import { useAuth } from '@/lib/auth';
import { dollars } from '@/lib/production/answers';
import { RequestCrewBidsDialog, type RequestCrewBidsSeed } from '@/components/RequestCrewBidsDialog';
import { PhotoStrip } from '@/components/production/estimate/PhotoStrip';

const PACKET_STATUS: Record<string, string> = {
  ready: 'Ready to plan', planned: 'Planned', scheduled: 'Scheduled', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled',
};
const ESTIMATE_STATUS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', changes_requested: 'Changes requested', approved: 'Approved', lost: 'Lost', archived: 'Replaced',
};
const FULFILLMENT: Record<string, string> = { subcontractor: 'Subcontract', vendor: 'Vendor', hybrid: 'Crew and subs' };
const FACTORS = ['restricted rear access', 'bigger than estimated', 'more debris than expected', 'weather', 'equipment breakdown', 'customer delay', 'utility lines', 'hazard tree'];
const NOT_LEADING = 'none';
const human = (k: string) => k.replace(/_/g, ' ');
const day = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : null);
const message = (e: unknown) => (e instanceof Error ? e.message : 'Could not save');

type Act = (body: Record<string, unknown>) => Promise<WorkReply | null>;

/** The actual crew, hours and equipment, typed by the crew leader or the office when a job is done. */
function ActualsForm({ packet, act, onDone }: { packet: PacketRow; act: Act; onDone: () => void }) {
  const a = packet.actuals ?? {};
  const [headcount, setHeadcount] = useState(String(a.headcount ?? packet.crew?.headcount ?? ''));
  const [hours, setHours] = useState(String(a.hours ?? packet.est_hours ?? ''));
  const [manHours, setManHours] = useState(a.manHours !== undefined ? String(a.manHours) : '');
  const [equipment, setEquipment] = useState<Record<string, string>>(
    Object.fromEntries((packet.resources ?? []).map((r) => [r.key, String(a.equipment?.[r.key] ?? r.hours)])),
  );
  const [expenses, setExpenses] = useState(a.expenses !== undefined && a.expenses !== null ? String(a.expenses) : '');
  const [factors, setFactors] = useState<string[]>(a.factors ?? []);
  const [notes, setNotes] = useState(a.notes ?? '');
  const [busy, setBusy] = useState(false);
  const autoManHours = (Number(headcount) || 0) * (Number(hours) || 0);

  const save = async (done: boolean) => {
    setBusy(true);
    const ok = await act({
      action: 'actuals', packetId: packet.id, done, expectedUpdatedAt: packet.updated_at,
      actuals: {
        crewTemplate: packet.crew?.template ?? null,
        headcount: Math.max(0, Math.round(Number(headcount) || 0)),
        hours: Math.max(0, Number(hours) || 0),
        manHours: manHours === '' ? autoManHours : Math.max(0, Number(manHours) || 0),
        equipment: Object.fromEntries(Object.entries(equipment).map(([k, v]) => [k, Math.max(0, Number(v) || 0)])),
        expenses: expenses === '' ? null : Math.max(0, Number(expenses) || 0),
        factors,
        notes: notes.trim() || undefined,
      },
    });
    setBusy(false);
    if (ok) { toast.success(done ? 'Job finished' : 'Hours saved'); onDone(); }
  };

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="font-medium text-sm">Actual crew and hours</div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="space-y-1"><Label className="text-xs" htmlFor={`hc-${packet.id}`}>Crew size</Label>
          <Input id={`hc-${packet.id}`} type="number" inputMode="numeric" min={0} max={30} value={headcount} onChange={(e) => setHeadcount(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor={`h-${packet.id}`}>Hours on site</Label>
          <Input id={`h-${packet.id}`} type="number" inputMode="decimal" min={0} max={240} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor={`mh-${packet.id}`}>Man-hours</Label>
          <Input id={`mh-${packet.id}`} type="number" inputMode="decimal" min={0} max={2000} step={0.25} placeholder={String(autoManHours)} value={manHours} onChange={(e) => setManHours(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs" htmlFor={`ex-${packet.id}`}>Extra expenses</Label>
          <Input id={`ex-${packet.id}`} type="number" inputMode="decimal" min={0} placeholder="None" value={expenses} onChange={(e) => setExpenses(e.target.value)} /></div>
        {Object.keys(equipment).map((k) => (
          <div key={k} className="space-y-1"><Label className="text-xs capitalize" htmlFor={`eq-${packet.id}-${k}`}>{human(k)} hours</Label>
            <Input id={`eq-${packet.id}-${k}`} type="number" inputMode="decimal" min={0} max={240} step={0.25} value={equipment[k]} onChange={(e) => setEquipment({ ...equipment, [k]: e.target.value })} /></div>
        ))}
      </div>
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">What made it take longer or shorter</div>
        <div className="flex flex-wrap gap-1">
          {FACTORS.map((f) => (
            <Button key={f} type="button" size="sm" variant={factors.includes(f) ? 'default' : 'outline'}
              onClick={() => setFactors(factors.includes(f) ? factors.filter((x) => x !== f) : [...factors, f].slice(0, 10))}>{f}</Button>
          ))}
        </div>
      </div>
      <Textarea rows={2} maxLength={1000} placeholder="Notes for the office" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes for the office" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => save(false)}>Save hours</Button>
        {packet.status !== 'done' && <Button size="sm" disabled={busy} onClick={() => save(true)}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save and finish the job</Button>}
      </div>
    </div>
  );
}

function PacketCard({ packet, siblings, leaders, userId, dispatch, isLeader, jobber, act, onSubBids }: {
  packet: PacketRow; siblings: PacketRow[]; leaders: { id: string; email: string; name?: string | null; owner?: boolean }[]; userId: string | undefined;
  dispatch: boolean; isLeader: boolean; jobber: boolean; act: Act; onSubBids: (seed: RequestCrewBidsSeed) => void;
}) {
  const [jobs, setJobs] = useState<{ id: string; jobNumber: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const [actuals, setActuals] = useState(false);
  const [plannedDate, setPlannedDate] = useState(packet.planned_date ?? '');
  useEffect(() => setPlannedDate(packet.planned_date ?? ''), [packet.planned_date]);
  const [busy, setBusy] = useState(false);
  const canWork = dispatch || isLeader;
  const leaderName = packet.crew_leader_id === userId ? 'you'
    : (() => { const l = leaders.find((x) => x.id === packet.crew_leader_id); return l ? l.name || l.email : packet.crew_leader_id ? 'assigned' : null; })();
  const waitingOn = packet.depends_on.map((k) => siblings.find((s) => s.package_key === k)).filter((s): s is PacketRow => !!s && s.status !== 'done');
  const c = packet.customer ?? {};
  const photos = packet.scope.flatMap((s) => s.photos ?? []);
  const sign = async (path: string) => (await productionCall<{ url: string }>('production-work', { action: 'media', packetId: packet.id, path })).url;
  const run = async (body: Record<string, unknown>) => { setBusy(true); const r = await act(body); setBusy(false); return r; };
  const refreshFromJobber = async () => {
    const r = await run({ action: 'refresh', packetId: packet.id });
    if (r) { setJobs(r.jobs ?? []); toast.success(r.outcome ?? 'Read from Jobber'); }
  };

  return (
    <Card className="p-3 space-y-2">
      <button type="button" className="w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold">{packet.title}{packet.estimate_number ? ` #${packet.estimate_number}` : ''}{c.name ? `, ${c.name}` : ''}</div>
            <div className="text-xs text-muted-foreground">
              {packet.crew?.headcount ? `${packet.crew.headcount}-person crew, ` : ''}{packet.est_hours ?? 0} hr, {packet.est_man_hours ?? 0} man-hours
              {(packet.resources ?? []).length > 0 && `, ${packet.resources.map((r) => `${human(r.key)} ${r.hours} hr`).join(', ')}`}
            </div>
            <div className="text-xs text-muted-foreground">
              {packet.status === 'done' ? `Finished${day(packet.completed_at ?? null) ? ` ${day(packet.completed_at ?? null)}` : ''}`
                : day(packet.scheduled_date) ? `Scheduled ${day(packet.scheduled_date)}` : day(packet.planned_date) ? `Planned ${day(packet.planned_date)}` : 'No day yet'}
              {leaderName ? `, crew leader ${leaderName}` : ''}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge variant={packet.status === 'done' ? 'default' : 'secondary'}>{PACKET_STATUS[packet.status] ?? packet.status}</Badge>
            {FULFILLMENT[packet.fulfillment] && <Badge variant="outline">{FULFILLMENT[packet.fulfillment]}</Badge>}
            {packet.jobber_job_number && <Badge variant="outline">Jobber job #{packet.jobber_job_number}</Badge>}
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </button>
      {waitingOn.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">After {waitingOn.map((s) => s.title.toLowerCase()).join(' and ')}</p>}

      {open && (
        <div className="space-y-3 pt-1">
          <div className="text-sm space-y-1">
            {c.address && <div className="flex items-start gap-1.5"><MapPin className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" /><span>{c.address}</span></div>}
            {c.phone && <div className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-muted-foreground" /><a className="underline" href={`tel:${c.phone}`}>{c.phone}</a></div>}
            {c.gateCode && <div>Gate code: {c.gateCode}</div>}
            {c.accessNotes && <div className="text-muted-foreground">{c.accessNotes}</div>}
          </div>
          <div className="space-y-2">
            {packet.scope.map((s) => (
              <div key={s.workItemId} className="rounded-md bg-muted p-2 text-sm">
                <div className="font-medium">{s.tree ? `${s.tree}: ` : ''}{s.scope}</div>
                <div className="text-xs text-muted-foreground">
                  {[`${s.hours} hr`, s.equipment.length ? s.equipment.map(human).join(', ') : null, s.access ? `access ${human(s.access)}` : null,
                    s.utility, s.vendor, s.hazards].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
          {photos.length > 0 && <PhotoStrip scope={packet.id} paths={photos} sign={sign} />}

          {packet.tasks.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Tasks</div>
              {packet.tasks.map((t) => (
                <label key={t.key} className="flex items-start gap-2 text-sm">
                  <Checkbox checked={t.status === 'done'} disabled={!canWork || busy}
                    onCheckedChange={(v) => run({ action: 'task', packetId: packet.id, taskKey: t.key, status: v ? 'done' : 'open' })} />
                  <span className={t.status === 'done' ? 'line-through text-muted-foreground' : ''}>
                    {t.title}{t.status === 'done' ? '' : t.dueAt ? ` (by ${day(t.dueAt)})` : ' (before the job)'}
                  </span>
                </label>
              ))}
            </div>
          )}

          {dispatch && (
            <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] items-end">
              <div className="space-y-1">
                <Label className="text-xs">Crew leader</Label>
                <Select value={packet.crew_leader_id ?? NOT_LEADING} disabled={busy}
                  onValueChange={(v) => run({ action: 'assign', packetId: packet.id, crewLeaderId: v === NOT_LEADING ? null : v, expectedUpdatedAt: packet.updated_at })}>
                  <SelectTrigger aria-label="Crew leader"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOT_LEADING}>Nobody yet</SelectItem>
                    {leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.owner ? `${l.name || l.email} (owner)` : l.name || l.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`pd-${packet.id}`}>Planned day</Label>
                <Input id={`pd-${packet.id}`} type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" disabled={busy || plannedDate === (packet.planned_date ?? '')}
                onClick={() => run({ action: 'assign', packetId: packet.id, crewLeaderId: packet.crew_leader_id, plannedDate: plannedDate || null, expectedUpdatedAt: packet.updated_at })}>
                Save day
              </Button>
            </div>
          )}

          {dispatch && jobber && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={refreshFromJobber}><RefreshCw className="w-4 h-4 mr-1" />Refresh from Jobber</Button>
              {!packet.jobber_job_id && jobs.length > 0 && (
                <Select disabled={busy} onValueChange={(v) => run({ action: 'link_job', packetId: packet.id, jobId: v })}>
                  <SelectTrigger className="w-52" aria-label="Link to a Jobber job"><SelectValue placeholder="Link to a Jobber job" /></SelectTrigger>
                  <SelectContent>{jobs.map((j) => <SelectItem key={j.id} value={j.id}>Jobber job #{j.jobNumber ?? ''}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {packet.jobber_job_id && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run({ action: 'link_job', packetId: packet.id, jobId: null })}>Unlink from Jobber</Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canWork && ['ready', 'planned', 'scheduled'].includes(packet.status) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ action: 'status', packetId: packet.id, status: 'in_progress', expectedUpdatedAt: packet.updated_at })}>
                <Play className="w-4 h-4 mr-1" />Start the job
              </Button>
            )}
            {canWork && packet.status !== 'cancelled' && (
              <Button size="sm" variant={actuals ? 'secondary' : 'outline'} onClick={() => setActuals(!actuals)}>
                {packet.status === 'done' ? 'Edit actual hours' : 'Finish with actual hours'}
              </Button>
            )}
            {dispatch && packet.fulfillment !== 'internal' && packet.status !== 'done' && (
              <Button size="sm" variant="outline" onClick={() => onSubBids({
                title: `${packet.title}${packet.estimate_number ? ` #${packet.estimate_number}` : ''}`,
                description: packet.scope.map((s) => `${s.tree ? `${s.tree}: ` : ''}${s.scope}`).join('\n').slice(0, 1500),
                photoPath: photos[0] ?? null,
                hours: packet.est_hours, climber: packet.package_key !== 'stump',
                groundCount: Math.max(0, (packet.crew?.headcount ?? 1) - 1) || null,
                stump: packet.package_key === 'stump' || packet.scope.some((s) => /stump/i.test(s.service)),
                crane: (packet.resources ?? []).some((r) => /crane/i.test(r.key)),
              })}>
                <Gavel className="w-4 h-4 mr-1" />Get sub bids
              </Button>
            )}
            {dispatch && !['done', 'cancelled'].includes(packet.status) && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run({ action: 'status', packetId: packet.id, status: 'cancelled', expectedUpdatedAt: packet.updated_at })}>
                Cancel this job
              </Button>
            )}
            {dispatch && packet.status === 'cancelled' && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run({ action: 'status', packetId: packet.id, status: 'ready', expectedUpdatedAt: packet.updated_at })}>
                Bring it back
              </Button>
            )}
          </div>
          {actuals && canWork && <ActualsForm packet={packet} act={act} onDone={() => setActuals(false)} />}
          {packet.actuals && !actuals && (
            <p className="text-xs text-muted-foreground">
              Actual: {packet.actuals.headcount ?? 0}-person crew, {packet.actuals.hours ?? 0} hr, {packet.actuals.manHours ?? 0} man-hours
              {packet.actuals.factors?.length ? `, ${packet.actuals.factors.join(', ')}` : ''}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const WORK_FILTERS: [string, string, (p: PacketRow) => boolean][] = [
  ['open', 'To do', (p) => !['done', 'cancelled'].includes(p.status)],
  ['ready', 'Ready to plan', (p) => p.status === 'ready'],
  ['in_progress', 'In progress', (p) => p.status === 'in_progress'],
  ['done', 'Done', (p) => p.status === 'done'],
  ['all', 'All', () => true],
];
const ESTIMATE_FILTERS: [string, string, (s: string) => boolean][] = [
  ['open', 'Open', (s) => ['draft', 'sent', 'changes_requested'].includes(s)],
  ['approved', 'Approved', (s) => s === 'approved'],
  ['lost', 'Lost', (s) => s === 'lost'],
  ['all', 'All', (s) => s !== 'archived'],
];

/** Jobs > Crew work: crew estimates (sales and office) and the job packets each sale makes (office and crew leaders). */
export default function ProductionJobs() {
  const { user } = useAuth();
  const { status, isLoading } = useProductionStatus();
  const { data: company } = useCompanySettings();
  const can = status.can;
  const showEstimates = status.published && can.price;
  const showWork = status.published && (can.dispatch || can.field || can.price);
  const { estimates, packets, leaders, work } = useProductionWork({ estimates: showEstimates, packets: showWork, leaders: status.published && can.dispatch });
  const [tab, setTab] = useState<string | null>(null);
  const [workFilter, setWorkFilter] = useState('open');
  const [mine, setMine] = useState(false);
  const [estimateFilter, setEstimateFilter] = useState('open');
  const [subsSeed, setSubsSeed] = useState<RequestCrewBidsSeed | null>(null);
  const jobber = useQuery({
    queryKey: ['production-jobber-connected'],
    enabled: status.published && can.dispatch,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => (await productionCall<{ connected: boolean }>('production-estimate', { action: 'jobber' })).connected,
  });
  const showCapacity = status.published && (can.dispatch || can.setup);
  const showReports = status.published && (can.price || can.dispatch);
  const card = useProductionCard(status.published && (can.price || can.setup || can.dispatch));
  const def = card.data?.def ?? null;
  const settings = card.data?.settings ?? null;
  const { report, isLoading: reportLoading } = useProductionReport(status, def, packets.data ?? []);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!showEstimates && !showWork) {
    return <div className="p-4 sm:p-6 max-w-2xl mx-auto"><Card className="p-6 text-sm text-muted-foreground">Crew work opens once your company publishes its rates (Settings, Crews and pricing).</Card></div>;
  }

  const act: Act = async (body) => {
    try {
      return await work(body);
    } catch (e) {
      toast.error(message(e));
      await packets.refetch();
      return null;
    }
  };
  const current = tab ?? (showWork && (can.dispatch || can.field) ? 'work' : showEstimates ? 'estimates' : 'work');
  const all = packets.data ?? [];
  const wf = WORK_FILTERS.find((f) => f[0] === workFilter) ?? WORK_FILTERS[0];
  const shown = all.filter(wf[2]).filter((p) => !mine || p.crew_leader_id === user?.id);
  const ef = ESTIMATE_FILTERS.find((f) => f[0] === estimateFilter) ?? ESTIMATE_FILTERS[0];
  const crewNames = Object.fromEntries((def?.crews ?? []).map((c) => [c.key, c.name]));
  const estimateRows = (estimates.data ?? []).filter((e) => ef[2](e.status));

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Crew work</h1>
        <div className="flex items-center gap-3">
          {usesSubs(company) && <Link to="/dashboard/bid-board" className="text-sm text-primary underline">Sub jobs</Link>}
          {showEstimates && <Button asChild size="sm"><Link to="/dashboard/instant-estimator/crew"><Plus className="w-4 h-4 mr-1" />New crew estimate</Link></Button>}
        </div>
      </div>
      <Tabs value={current} onValueChange={setTab}>
        <TabsList>
          {showWork && <TabsTrigger value="work">Work</TabsTrigger>}
          {showEstimates && <TabsTrigger value="estimates">Estimates</TabsTrigger>}
          {showCapacity && <TabsTrigger value="capacity">Capacity</TabsTrigger>}
          {showReports && <TabsTrigger value="reports">Reports</TabsTrigger>}
        </TabsList>

        {showWork && (
          <TabsContent value="work" className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {WORK_FILTERS.map(([k, l]) => <Button key={k} size="sm" variant={workFilter === k ? 'default' : 'outline'} onClick={() => setWorkFilter(k)}>{l}</Button>)}
              {can.dispatch && can.field && <Button size="sm" variant={mine ? 'default' : 'outline'} onClick={() => setMine(!mine)}>Mine</Button>}
            </div>
            {packets.isLoading ? <div className="text-sm text-muted-foreground">Loading…</div>
              : shown.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">{all.length ? 'Nothing here.' : 'Job packets appear here when a crew estimate is approved.'}</Card>
                : shown.map((p) => (
                  <PacketCard key={p.id} packet={p} siblings={all.filter((s) => s.estimate_id === p.estimate_id && s.id !== p.id)} leaders={leaders.data ?? []} userId={user?.id}
                    dispatch={can.dispatch} isLeader={can.field && p.crew_leader_id === user?.id} jobber={jobber.data === true} act={act} onSubBids={setSubsSeed} />
                ))}
          </TabsContent>
        )}

        {showEstimates && (
          <TabsContent value="estimates" className="space-y-3">
            <JobberRequests on={status.jobber_extras} />
            <div className="flex flex-wrap gap-1">
              {ESTIMATE_FILTERS.map(([k, l]) => <Button key={k} size="sm" variant={estimateFilter === k ? 'default' : 'outline'} onClick={() => setEstimateFilter(k)}>{l}</Button>)}
            </div>
            {estimates.isLoading ? <div className="text-sm text-muted-foreground">Loading…</div>
              : estimateRows.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No crew estimates here yet.</Card>
                : estimateRows.map((e) => (
                  <Link key={e.id} to={`/dashboard/instant-estimator/crew/${e.id}`} className="block">
                    <Card className="p-3 flex items-center justify-between gap-2 hover:bg-muted/50">
                      <div className="min-w-0">
                        <div className="font-medium">#{e.number}{e.customer?.name ? `, ${e.customer.name}` : ''}</div>
                        <div className="text-xs text-muted-foreground truncate">{[e.customer?.address, day(e.created_at)].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="font-semibold">{e.totals?.total !== undefined ? dollars(e.totals.total) : ''}</span>
                        <Badge variant={e.status === 'approved' ? 'default' : 'secondary'}>{ESTIMATE_STATUS[e.status] ?? e.status}</Badge>
                      </div>
                    </Card>
                  </Link>
                ))}
          </TabsContent>
        )}
        {showCapacity && (
          <TabsContent value="capacity">
            <CapacityTab packets={all} settings={settings} crewNames={crewNames} canPlan={can.dispatch} act={act}
              profile={def && (can.setup || can.price) ? (
                <ProfileCard def={def} settings={settings} canSetup={can.setup} realizedRate={report.revenuePerManHour.overall}
                  backlogWeeks={Object.values(capacitySettingsOf(settings).crewCounts).some((n) => n > 0) ? backlogWeeks(all.map(toCapacityPacket), capacitySettingsOf(settings)) : null}
                  onChanged={() => card.refetch()} />
              ) : null} />
          </TabsContent>
        )}

        {showReports && (
          <TabsContent value="reports">
            <ReportsTab report={report} isLoading={reportLoading} can={can} def={def} />
          </TabsContent>
        )}
      </Tabs>
      <RequestCrewBidsDialog seed={subsSeed} open={!!subsSeed} onOpenChange={(o) => !o && setSubsSeed(null)} />
    </div>
  );
}
