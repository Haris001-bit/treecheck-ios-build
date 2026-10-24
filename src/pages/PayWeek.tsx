import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Download, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { money } from '@/lib/bidPricing';
import { addDays, groundPay, weekStartChicago } from '@/lib/payroll';

type Line = {
  jobId: string; job: string; customer: string | null; completed: string;
  role: 'Climber' | 'Ground' | 'Stump'; crewId: string; name: string;
  amount: number | null; hours?: number | null; note?: string; bidId?: string; hoursId?: string;
  rate?: number | null; rateType?: string | null; workerRate?: number | null; paid: boolean;
};

const nice = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
const chicagoStartUtc = (ymd: string) => `${ymd}T06:00:00Z`;

export default function PayWeek() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [week, setWeek] = useState(() => addDays(weekStartChicago(new Date()), -7));
  const weekEnd = addDays(week, 7);

  const { data: ownerId } = useQuery({
    queryKey: ['pay-owner', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('parent_contractor_id').eq('id', user!.id).maybeSingle();
      return ((data as any)?.parent_contractor_id as string) || user!.id;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['pay-week', ownerId, week],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data: jobs } = await supabase.from('bid_requests')
        .select('id, title, city, customer_name, completed_at, paid_at, awarded_bid_id, awarded_stump_bid_id')
        .eq('owner_contractor_id', ownerId!).eq('workflow_status', 'job_complete')
        .lt('completed_at', chicagoStartUtc(weekEnd))
        .or(`completed_at.gte.${chicagoStartUtc(week)},paid_at.is.null`)
        .order('completed_at');
      const list = (jobs ?? []) as any[];
      const ids = list.map((j) => j.id);
      if (!ids.length) return { lines: [] as Line[], jobs: list };
      const bidIds = list.flatMap((j) => [j.awarded_bid_id, j.awarded_stump_bid_id]).filter(Boolean);
      const [bidsR, hrsR, dispR] = await Promise.all([
        bidIds.length ? supabase.from('bids').select('id, crew_member_id, bid_role, min_pay, ideal_pay, agreed_pay').in('id', bidIds) : Promise.resolve({ data: [] }),
        supabase.from('job_ground_hours').select('*').in('bid_request_id', ids),
        supabase.from('job_dispatches').select('bid_request_id, hired_crew_member_ids, pay_per_worker, pay_rate_type').in('bid_request_id', ids).eq('role', 'ground'),
      ]);
      const bids = (bidsR.data ?? []) as any[];
      const hrs = (hrsR.data ?? []) as any[];
      const disp = (dispR.data ?? []) as any[];
      const crewIds = new Set<string>([...bids.map((b) => b.crew_member_id), ...hrs.map((h) => h.crew_member_id), ...disp.flatMap((d) => d.hired_crew_member_ids ?? [])]);
      const { data: crews } = crewIds.size
        ? await supabase.from('crew_members').select('id, full_name, hourly_rate, user_id').in('id', [...crewIds]) : { data: [] };
      const ownRates = new Map<string, number | null>();
      const uids = ((crews ?? []) as any[]).filter((c) => c.hourly_rate == null && c.user_id).map((c) => c.user_id);
      if (uids.length) {
        const { data: cps } = await (supabase as any).from('crew_profiles').select('user_id, hourly_rate').in('user_id', uids);
        for (const r of (cps ?? []) as any[]) ownRates.set(r.user_id, r.hourly_rate);
      }
      const rateOf = (id: string) => { const c = ((crews ?? []) as any[]).find((x) => x.id === id); return c?.hourly_rate ?? (c?.user_id ? ownRates.get(c.user_id) ?? null : null); };
      const nameOf = (id: string) => ((crews ?? []) as any[]).find((c) => c.id === id)?.full_name ?? 'Unknown';
      const lines: Line[] = [];
      for (const j of list) {
        const job = `${j.city ?? ''} ${String(j.title ?? 'Job').split(' — ')[0]}`.trim();
        const base = { jobId: j.id, job, customer: j.customer_name, completed: j.completed_at, paid: !!j.paid_at };
        const climb = bids.find((b) => b.id === j.awarded_bid_id);
        if (climb) lines.push({ ...base, role: 'Climber', crewId: climb.crew_member_id, name: nameOf(climb.crew_member_id),
          amount: climb.agreed_pay != null ? Number(climb.agreed_pay) : null, bidId: climb.id,
          note: `offer ${money(climb.min_pay)} min / ${money(climb.ideal_pay)} ideal` });
        const stump = bids.find((b) => b.id === j.awarded_stump_bid_id);
        if (stump) lines.push({ ...base, role: 'Stump', crewId: stump.crew_member_id, name: nameOf(stump.crew_member_id), amount: Number(stump.min_pay) });
        const d = disp.find((x) => x.bid_request_id === j.id);
        const ground = new Set<string>([...hrs.filter((h) => h.bid_request_id === j.id).map((h) => h.crew_member_id), ...disp.filter((x) => x.bid_request_id === j.id).flatMap((x) => x.hired_crew_member_ids ?? [])]);
        for (const g of ground) {
          const h = hrs.find((x) => x.bid_request_id === j.id && x.crew_member_id === g);
          lines.push({ ...base, role: 'Ground', crewId: g, name: nameOf(g), hours: h?.hours ?? null,
            amount: h?.hours != null ? Number(h.pay) : null, hoursId: h?.id, rate: d?.pay_per_worker ?? null, rateType: d?.pay_rate_type ?? null, workerRate: rateOf(g) });
        }
      }
      return { lines, jobs: list };
    },
  });

  const lines = data?.lines ?? [];
  const people = useMemo(() => {
    const m = new Map<string, { name: string; role: string; total: number; missing: number; jobs: number }>();
    for (const l of lines) {
      const k = `${l.crewId}|${l.role}`;
      const p = m.get(k) ?? { name: l.name, role: l.role, total: 0, missing: 0, jobs: 0 };
      p.jobs++;
      if (l.amount == null) p.missing++; else p.total += l.amount;
      m.set(k, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [lines]);
  const total = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const unpaidIds = [...new Set(lines.filter((l) => !l.paid).map((l) => l.jobId))];
  const refresh = () => qc.invalidateQueries({ queryKey: ['pay-week'] });

  const saveClimber = async (l: Line, v: number) => {
    const { error } = await supabase.from('bids').update({ agreed_pay: v } as any).eq('id', l.bidId!);
    if (error) return toast.error('Could not save');
    toast.success('Climber pay saved'); refresh();
  };
  const saveHours = async (l: Line, h: number) => {
    const pay = groundPay(h, l.rate, l.rateType, l.workerRate);
    const row = { bid_request_id: l.jobId, owner_contractor_id: ownerId!, crew_member_id: l.crewId, hours: h, pay, entered_by: user!.id, entered_at: new Date().toISOString() };
    const { error } = await supabase.from('job_ground_hours').upsert(row as any, { onConflict: 'bid_request_id,crew_member_id' });
    if (error) return toast.error('Could not save');
    toast.success(`Saved — ${money(pay)}`); refresh();
  };
  const markPaid = async () => {
    if (!unpaidIds.length) return;
    if (lines.some((l) => !l.paid && l.amount == null) && !confirm('Some amounts are still missing. Mark these jobs paid anyway?')) return;
    const { error } = await supabase.from('bid_requests').update({ paid_at: new Date().toISOString(), paid_by: user!.id } as any).in('id', unpaidIds);
    if (error) return toast.error('Could not mark paid');
    toast.success('Marked paid'); refresh();
  };
  const download = () => {
    const rows = [['Person', 'Role', 'Job', 'Customer', 'Completed', 'Hours', 'Amount', 'Paid']];
    for (const l of lines) rows.push([l.name, l.role, l.job, l.customer ?? '', nice(l.completed), l.hours != null ? String(l.hours) : '', l.amount != null ? String(l.amount) : 'MISSING', l.paid ? 'yes' : 'no']);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `pay-week-${week}.csv`; a.click();
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">Pay</h1>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></Button>
          <div className="text-sm px-2 min-w-[150px] text-center">{nice(chicagoStartUtc(week))} – {nice(chicagoStartUtc(addDays(week, 6)))}</div>
          <Button size="icon" variant="outline" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week"><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Jobs marked complete this week, plus any earlier finished jobs not yet paid.</p>

      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : lines.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No finished jobs with crew for this week.</Card>
      ) : (
        <>
          <Card className="p-4 space-y-2">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <div className="font-semibold">Total {money(total)}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={download}><Download className="w-4 h-4 mr-1" />Download</Button>
                <Button size="sm" onClick={markPaid} disabled={!unpaidIds.length}><CheckCircle2 className="w-4 h-4 mr-1" />Mark week paid</Button>
              </div>
            </div>
            <div className="divide-y">
              {people.map((p) => (
                <div key={p.name + p.role} className="flex justify-between py-1.5 text-sm">
                  <span>{p.name} <span className="text-muted-foreground">· {p.role} · {p.jobs} job{p.jobs === 1 ? '' : 's'}</span></span>
                  <span className="font-medium">{money(p.total)}{p.missing > 0 && <Badge variant="destructive" className="ml-2 text-[10px]">{p.missing} missing</Badge>}</span>
                </div>
              ))}
            </div>
          </Card>

          {(data?.jobs ?? []).map((j: any) => {
            const jl = lines.filter((l) => l.jobId === j.id);
            if (!jl.length) return null;
            return (
              <Card key={j.id} className="p-4 space-y-2">
                <div className="flex justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-semibold">{j.customer_name ?? 'Customer'} — {jl[0].job}</div>
                    <div className="text-xs text-muted-foreground">Completed {nice(j.completed_at)}</div>
                  </div>
                  {j.paid_at ? <Badge variant="secondary">Paid {nice(j.paid_at)}</Badge> : <Badge variant="outline">Unpaid</Badge>}
                </div>
                {jl.map((l) => <PayRow key={l.role + l.crewId} l={l} onClimber={saveClimber} onHours={saveHours} />)}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

function PayRow({ l, onClimber, onHours }: { l: Line; onClimber: (l: Line, v: number) => void; onHours: (l: Line, h: number) => void }) {
  const [v, setV] = useState('');
  const n = Number(v);
  const ok = v.trim() !== '' && Number.isFinite(n) && n > 0;
  return (
    <div className="flex items-center justify-between gap-2 text-sm flex-wrap border-t pt-2">
      <div>
        <span className="font-medium">{l.name}</span> <span className="text-muted-foreground">· {l.role}</span>
        {l.role === 'Ground' && l.hours != null && <span className="text-muted-foreground"> · {l.hours} hr</span>}
        {l.note && <div className="text-xs text-muted-foreground">{l.note}</div>}
      </div>
      <div className="flex items-center gap-2">
        {l.amount != null ? <span className="font-semibold">{money(l.amount)}</span>
          : <Badge variant="destructive" className="text-[10px]">{l.role === 'Ground' ? 'Hours missing' : 'Pay amount needed'}</Badge>}
        {!l.paid && l.role !== 'Stump' && (
          <>
            <Input className="h-8 w-24" inputMode="decimal" placeholder={l.role === 'Ground' ? 'hours' : '$'} value={v} onChange={(e) => setV(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!ok} onClick={() => { l.role === 'Ground' ? onHours(l, n) : onClimber(l, Math.round(n)); setV(''); }}>
              {l.amount != null ? 'Change' : 'Save'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
