import { useEffect, useState } from 'react';
import { JobsCalendar } from '@/components/JobsCalendar';
import { CrewBidsAdvertisementSample } from '@/components/crew/CrewBidsAdvertisementSample';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RateJobDialog, RatingBadge } from '@/components/Reviews';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import {
  useCrewInbox, useMyCrewMemberships, useMyAvailability, useJobDispatches,
  fetchBidPhotoUrl, type BidRequest,
} from '@/hooks/useCrew';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PhotoZoomDialog } from '@/components/PhotoZoomDialog';
import { TreePhotoGallery } from '@/components/TreePhotoGallery';
import { JobChat } from '@/components/JobChat';
import { ConfirmClimberDates, isPassed } from '@/components/ConfirmClimberDates';
import { useJobberFreeDays } from '@/hooks/useJobberFreeDays';
import { blockedNote } from '@/lib/jobberFreeDays';
import { money } from '@/lib/bidPricing';
import { requestTab, dispatchTab, type CrewTab } from '@/lib/crewJobTabs';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Gavel, Loader2, CheckCircle2, MapPin, Image as ImageIcon, CalendarIcon, Phone, User } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';

/** Sentinel date meaning "I want to see the tree in person before committing to a day". */
const VISIT_FIRST = 'wants-site-visit';

/** Strip any dollar figures out of Scout notes — pricing is owner/office only. */
function stripPrices(text: string): string {
  return text
    .replace(/\$\s?[\d,]+(?:\.\d{1,2})?(?:\s?[-–—to]{1,3}\s?\$?\s?[\d,]+(?:\.\d{1,2})?)?/gi, '')
    .replace(/\b[\d,]+(?:\.\d{1,2})?\s?(?:dollars|usd)\b/gi, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim())
    // Drop lines that were only about price.
    .filter((line) => line !== '' && !/^(?:estimated\s+)?(?:price|cost|estimate|range|bid|quote)\b[\s:–—-]*$/i.test(line))
    .join('\n');
}


// ?sample=1 shows the fictional marketing sample instead of real jobs.
export default function CrewBidsRoute() {
  const [sp] = useSearchParams();
  return sp.get('sample') === '1' ? <CrewBidsAdvertisementSample /> : <CrewBids />;
}

function CrewBids() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useCrewInbox();
  const { data: memberships } = useMyCrewMemberships();
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  // Days the open job's climber can't pick: booked in Jobber or closed. Greyed out in both pickers.
  const { data: blockedDays } = useJobberFreeDays(openId);
  useEffect(() => {
    if (!blockedDays?.size) return;
    setForm((f) => ({ ...f, dates: f.dates.filter((d) => !blockedDays.has(d)) }));
  }, [blockedDays]);
  const [zoomPhoto, setZoomPhoto] = useState<{ src: string; alt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    minPay: '', idealPay: '', crewSize: '', equipment: '', hours: '', notes: '',
    disposalLoads: '', groundCrew: '', miniSkid: '' as '' | 'yes' | 'no', skidHours: '',
    dates: [] as string[], role: 'climber', rateType: 'day', visitFirst: false,
  });

  const requests = data?.requests ?? [];
  const myBids = data?.myBids ?? [];
  const myCrewId = memberships?.[0]?.id ?? null;
  const myTrade = memberships?.[0]?.trade ?? 'climber';
  // Ground-only workers never bid; they only pick days on won jobs.
  const groundOnly = (memberships ?? []).length > 0 && (memberships ?? []).every((m) => m.trade === 'ground');
  const visibleRequests = groundOnly ? [] : requests;
  const { data: myAvailability } = useMyAvailability((memberships ?? []).map((m) => m.id));
  const [searchParams] = useSearchParams();
  const [focusJob, setFocusJob] = useState<string | null>(searchParams.get('job'));
  const [focusDispatch] = useState<string | null>(searchParams.get('dispatch'));
  const [tab, setTab] = useState<CrewTab>(((['open', 'mine', 'past', 'archived'] as const).find((t) => t === searchParams.get('tab'))) ?? 'open');
  const today = format(new Date(), 'yyyy-MM-dd');
  const [editDays, setEditDays] = useState<string | null>(null);
  const goTo = (elId: string, then?: () => void) => {
    then?.();
    document.getElementById(elId)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  };
  const needsDays = visibleRequests.filter((r) => {
    const b = myBids.find((x) => x.bid_request_id === r.id);
    return b?.status === 'won' && r.awarded_bid_id === b.id && (r as any).climber_dates_status === 'requested';
  });
  // Scout observations for jobs I've been sent — notes only, no pricing.
  const { data: scoutNotes } = useQuery({
    queryKey: ['crew-scout-notes', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('crew_scout_notes');
      if (error) throw error;
      return Object.fromEntries(
        (data ?? []).map((row: any) => [row.bid_request_id, {
          notes: stripPrices(row.notes ?? ''),
          difficulty: row.difficulty as string | null,
          risk: row.risk as string | null,
        }]),
      ) as Record<string, { notes: string; difficulty: string | null; risk: string | null }>;
    },
  });

  const { data: dispatchData } = useJobDispatches();
  const myMemberIds = new Set((memberships ?? []).map((m) => m.id));
  const dispatches = dispatchData?.dispatches ?? [];
  const dispatchResponses = dispatchData?.responses ?? [];
  /** Days with ground crew already hired — the climber can't drop these himself. */
  const lockedFor = (requestId: string) =>
    dispatches.filter((d) => d.bid_request_id === requestId && d.status === 'filled' && (d as any).awarded_date)
      .map((d) => (d as any).awarded_date as string);
  // Opened from a text link: scroll to that job once it has loaded.
  // Wait for both lists so the linked job is really on the page before jumping to it.
  const listsReady = !!data && !!dispatchData;
  const [claiming, setClaiming] = useState<string | null>(null);
  // A review alert opens the review straight away instead of scrolling the job list.
  const [rateId, setRateId] = useState<string | null>(null);
  const reviewParam = searchParams.get('review');
  // Wait for sign-in so the review loads on the first try.
  useEffect(() => { if (reviewParam && user?.id) setRateId(reviewParam); }, [reviewParam, user?.id]);
  useEffect(() => {
    if (searchParams.get('review')) return;
    const el = focusJob ? `job-${focusJob}` : focusDispatch ? `dispatch-${focusDispatch}` : null;
    if (!el || !listsReady) return;
    // Older review texts linked to ?job= on a finished job: open the review there too.
    const target = focusJob ? requests.find((r) => r.id === focusJob) : null;
    if (target && (target as any).workflow_status === 'job_complete') { setRateId(target.id); return; }
    // Linked jobs open on the tab they belong to.
    if (target) setTab(requestTab(target as any, bidFor(target.id), today));
    const dTarget = focusDispatch ? dispatches.find((d) => d.id === focusDispatch) : null;
    if (dTarget) setTab(dispatchTab(dTarget as any, myClaim(dTarget.id) as any, today));
    // Jump without animation; photo spaces are reserved so the page doesn't shift afterwards.
    const t = setTimeout(() => document.getElementById(el)?.scrollIntoView({ behavior: 'auto', block: 'start' }), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listsReady]);
  const { data: connections } = useQuery({
    queryKey: ['crew-connections', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('network-connect', { body: { action: 'list_requests' } });
      return (data?.items ?? []) as any[];
    },
  });
  const companies: Record<string, { company: string; rating_avg: number | null; rating_count: number }> =
    Object.fromEntries((connections ?? []).map((c) => [c.owner_contractor_id, c]));
  const [dayPicks, setDayPicks] = useState<Record<string, string[]>>({});
  const saveDays = async (dispatchId: string, dates: string[]) => {
    setClaiming(dispatchId);
    try {
      const { data: res, error } = await supabase.functions.invoke('job-dispatch-availability', {
        body: { dispatch_id: dispatchId, dates },
      });
      if (error || res?.error) {
        let msg = res?.error as string | undefined;
        if (!msg && error && 'context' in error) {
          try { msg = (await (error as any).context.json())?.error; } catch { /* ignore */ }
        }
        throw new Error(msg || 'Could not save your days');
      }
      toast.success(res?.filled ? (res?.hired ? `You're hired for ${res.date}!` : 'This job just filled.') : (res?.message ?? 'Saved'));
      qc.invalidateQueries({ queryKey: ['job-dispatches'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save your days');
    } finally {
      setClaiming(null);
    }
  };

  const myClaim = (dispatchId: string) =>
    dispatchResponses.find((x) => x.dispatch_id === dispatchId && myMemberIds.has(x.crew_member_id)) ?? null;

  const claimSpot = async (dispatchId: string) => {
    setClaiming(dispatchId);
    try {
      const { data: res, error } = await supabase.functions.invoke('job-dispatch-respond', {
        body: { dispatch_id: dispatchId },
      });
      if (error) throw new Error(error.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      toast.success((res as any)?.message || "You're on the job.");
      qc.invalidateQueries({ queryKey: ['job-dispatches'] });
    } catch (e: any) {
      toast.error(e?.message || 'Could not claim that spot');
    } finally {
      setClaiming(null);
    }
  };

  /** Which role I'd be bidding as on this job. */
  const roleFor = (r: BidRequest) => {
    if (myTrade === 'stump') return 'stump';
    if (myTrade === 'crane') return 'crane';
    const need = (r as any).role_needed ?? 'climber';
    if (need === 'ground') return 'ground';
    if (need === 'climber') return 'climber';
    return myTrade === 'ground' ? 'ground' : 'climber';
  };

  /** Days I've already told them I work, so the checkboxes start pre-ticked. */
  const suggestedDates = (r: BidRequest) => {
    const a = myAvailability;
    if (!a) return [];
    const off = new Set(a.unavailable_dates ?? []);
    const weekly = new Set(a.weekly_days ?? []);
    return (r.offered_dates ?? []).filter((d) => {
      if (off.has(d)) return false;
      const day = new Date(`${d}T12:00:00`).getDay();
      return weekly.size === 0 || weekly.has(day);
    });
  };

  useEffect(() => {
    (async () => {
      for (const r of requests) {
        if (r.photo_path && photos[r.id] === undefined) {
          const url = await fetchBidPhotoUrl(r.id);
          setPhotos((p) => ({ ...p, [r.id]: url }));
        }
      }
      for (const d of dispatches) {
        if (photos[d.bid_request_id] === undefined) {
          const url = await fetchBidPhotoUrl(d.bid_request_id);
          setPhotos((p) => ({ ...p, [d.bid_request_id]: url }));
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests.length, dispatches.length]);

  const bidFor = (requestId: string) => myBids.find((b) => b.bid_request_id === requestId) ?? null;

  const startBid = (r: BidRequest) => {
    const existing = bidFor(r.id);
    setOpenId(r.id);
    setForm({
      minPay: existing ? String(existing.min_pay) : '',
      idealPay: existing ? String(existing.ideal_pay) : '',
      crewSize: existing?.crew_size != null
        ? String(existing.crew_size)
        : (existing as any)?.people_count != null ? String((existing as any).people_count) : '',
      equipment: existing?.equipment ?? '',
      hours: existing?.est_hours != null ? String(existing.est_hours) : '',
      notes: existing?.notes ?? '',
      dates: existing?.available_dates ?? suggestedDates(r),
      role: (existing as any)?.bid_role ?? roleFor(r),
      rateType: (existing as any)?.rate_type ?? 'day',
      disposalLoads: (existing as any)?.est_disposal_loads != null ? String((existing as any).est_disposal_loads) : '',
      groundCrew: (existing as any)?.ground_crew_size != null ? String((existing as any).ground_crew_size) : '',
      miniSkid: (existing as any)?.needs_mini_skid == null ? '' : ((existing as any).needs_mini_skid ? 'yes' : 'no'),
      skidHours: (existing as any)?.mini_skid_hours != null ? String((existing as any).mini_skid_hours) : '',
      visitFirst: (existing?.available_dates ?? []).includes(VISIT_FIRST),
    });
  };

  const missing = (r: BidRequest) => {
    const need: string[] = [];
    if (form.role === 'crane') {
      if (!form.minPay) need.push('your price for the crane work');
      return need;
    }
    if (form.role === 'stump') {
      if (!form.minPay) need.push('your price for the stump');
      return need;
    }
    const ground = form.role === 'ground';
    if (!form.minPay) need.push('your minimum');
    if (!form.idealPay) need.push('your ideal amount');
    if (ground && !form.crewSize) need.push('how many of you are coming');
    if (!form.hours) need.push(ground ? 'total crew hours' : 'job length in hours');
    if (!form.equipment.trim()) need.push(ground ? 'what you can run' : 'equipment');
    if (ground && !form.rateType) need.push('day rate or hourly');
    if (!ground && form.disposalLoads === '') need.push('estimated disposal loads (0 if none)');
    if (!ground && form.groundCrew === '') need.push('ground crew needed (0 if none)');
    if (!ground && !form.miniSkid) need.push('mini skid steer needed (yes or no)');
    if ((r.offered_dates ?? []).length > 0 && form.dates.length === 0 && !form.visitFirst) {
      need.push('at least one date (or ask to look at the tree first)');
    }
    return need;
  };

  const submit = async (r: BidRequest) => {
    if (!myCrewId) { toast.error('Your crew profile is still pending approval'); return; }
    const need = missing(r);
    if (need.length) { toast.error(`Still need: ${need.join(', ')}`); return; }
    setSaving(true);
    try {
      const ground = form.role === 'ground';
      const stump = form.role === 'stump' || form.role === 'crane';
      const { data: res, error } = await supabase.functions.invoke('bid-submit', {
        body: {
          bid_request_id: r.id,
          bid_role: form.role,
          min_pay: Number(form.minPay),
          ideal_pay: stump ? Number(form.minPay) : Number(form.idealPay),
          crew_size: ground ? Number(form.crewSize) : null,
          people_count: ground ? Number(form.crewSize) : null,
          rate_type: ground ? form.rateType : null,
          est_hours: Number(form.hours),
          equipment: form.equipment,
          est_disposal_loads: ground ? null : Number(form.disposalLoads),
          ground_crew_size: ground ? null : Number(form.groundCrew),
          needs_mini_skid: ground ? null : form.miniSkid === 'yes',
          mini_skid_hours: !ground && form.miniSkid === 'yes' ? Number(form.hours) || null : null,
          available_dates: form.visitFirst
            ? [...new Set([...form.dates, VISIT_FIRST])]
            : form.dates.filter((d) => d !== VISIT_FIRST),
          notes: form.visitFirst
            ? `I'd like to look at this tree first.${form.notes ? ' ' + form.notes : ''}`
            : form.notes || null,
        },
      });
      if (error) {
        // Surface the real reason instead of "Edge Function returned a non-2xx status code".
        let detail = '';
        try {
          const ctx: any = (error as any)?.context;
          if (ctx && typeof ctx.json === 'function') detail = (await ctx.json())?.error ?? '';
          else if (ctx && typeof ctx.text === 'function') detail = await ctx.text();
        } catch { /* ignore */ }
        throw new Error(detail || error.message);
      }
      if ((res as any)?.error) throw new Error((res as any).error);
      toast.success((res as any)?.message || "Thanks — we'll let you know if you're hired.");
      setOpenId(null);
      qc.invalidateQueries({ queryKey: ['crew-inbox'] });
    } catch (e: any) {
      toast.error(e?.message || 'Could not send your offer');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading jobs…
      </div>
    );
  }

  const pendingApproval = (memberships ?? []).length > 0 && !(memberships ?? []).some((m) => m.status === 'active');

  const needsTrade = (memberships ?? []).some((m) => m.trade === 'pending');
  if (needsTrade) {
    const pickTrade = async (trade: string) => {
      const ids = (memberships ?? []).filter((m) => m.trade === 'pending').map((m) => m.id);
      const { error } = await supabase.from('crew_members').update({ trade } as any).in('id', ids);
      if (error) { toast.error('Could not save. Please try again.'); return; }
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['my-crew-memberships'] });
    };
    const options = [
      { v: 'climber', label: 'Climber', hint: 'I climb and bid on tree jobs.' },
      { v: 'ground', label: 'Ground crew', hint: 'I work the ground. I pick days and get paid the set rate.' },
      { v: 'both', label: 'Climber + ground', hint: 'I climb, and I also want ground work.' },
      { v: 'stump', label: 'Stump grinder', hint: 'I grind stumps.' },
      { v: 'crane', label: 'Crane operator', hint: 'I run a crane on tree jobs.' },
    ];
    return (
      <div className="p-4 sm:p-6 max-w-md mx-auto">
        <h1 className="text-2xl font-bold mb-2">What kind of work do you do?</h1>
        <p className="text-muted-foreground mb-4">Pick one so we send you the right jobs. You can ask the office to change it later.</p>
        <div className="space-y-3">
          {options.map((o) => (
            <Button key={o.v} variant="outline" className="w-full h-auto py-4 flex-col items-start text-left" onClick={() => pickTrade(o.v)}>
              <span className="font-bold text-base">{o.label}</span>
              <span className="text-sm text-muted-foreground whitespace-normal">{o.hint}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  const reqTabs = visibleRequests.map((r) => requestTab(r as any, bidFor(r.id), today));
  const dispTabs = dispatches.map((d) => dispatchTab(d as any, myClaim(d.id) as any, today));
  const shownRequests = visibleRequests.filter((_, i) => reqTabs[i] === tab);
  const shownDispatches = dispatches.filter((_, i) => dispTabs[i] === tab);
  const countFor = (t: CrewTab) => reqTabs.filter((x) => x === t).length + dispTabs.filter((x) => x === t).length;
  const emptyText: Record<CrewTab, [string, string]> = {
    open: ['Nothing open right now', groundOnly ? "We'll text you when a job needs ground crew so you can pick your days." : "We'll text you the moment a job goes out for bids."],
    mine: ['No upcoming jobs', 'Jobs you win or get hired for show up here.'],
    past: ['No past work yet', "Jobs you've finished show up here, with your reviews."],
    archived: ['Nothing archived', "Jobs that are no longer available show up here."],
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <RateJobDialog bidRequestId={rateId} open={!!rateId} onOpenChange={(o) => !o && setRateId(null)} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gavel className="w-6 h-6 text-primary" />
          {groundOnly ? 'Ground crew jobs' : 'Jobs open for bids'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {groundOnly
            ? "When we win a job and need ground help, you'll get a text. Tap the days you can work — the first workers to pick the same day get the job, at the pay rate set by the company."
            : "New potential job. Look at the tree, then tell us the minimum you'd be happy with and the ideal amount you'd like to make, the crew and hours you need, and the days you can work. Nobody else sees your numbers."}
        </p>
        <div className="mt-3">
          <JobsCalendar withSearch onPick={(id) => goTo(`job-${id}`, () => setFocusJob(id))} />
        </div>
      </div>

      {pendingApproval && (
        <Card className="p-4 mb-4 border-primary/40 bg-primary/5 text-sm">
          Your profile is waiting for the company owner to approve it. You'll get a text when jobs open up.
        </Card>
      )}

      {needsDays.length > 0 && (
        <Card className="p-4 mb-4 border-2 border-primary bg-primary/5 space-y-2">
          <div className="font-semibold">Needs your action: pick your days</div>
          {needsDays.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{r.title}{r.city ? ` (${r.city})` : ''}</span>
              <Button size="sm" onClick={() => goTo(`job-${r.id}`, () => setFocusJob(r.id))}>Pick days</Button>
            </div>
          ))}
        </Card>
      )}



      <Tabs value={tab} onValueChange={(v) => setTab(v as CrewTab)} className="mb-4">
        <TabsList className="grid grid-cols-4 w-full h-auto">
          {([['open', 'Open'], ['mine', 'My jobs'], ['past', 'Past work'], ['archived', 'Archived']] as const).map(([v, label]) => (
            <TabsTrigger key={v} value={v} className="text-xs sm:text-sm px-1 py-1.5">
              {label} <span className="ml-1 text-muted-foreground">({countFor(v)})</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {shownDispatches.length > 0 && (
        <div className="space-y-3 mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ground crew needed
          </div>
          {shownDispatches.map((d) => {
            const claimed = myClaim(d.id);
            const taken = dispatchResponses.filter((x) => x.dispatch_id === d.id).length;
            const left = Math.max(0, Number(d.slots) - taken);
            const photo = photos[d.bid_request_id];
            return (
              <Card key={d.id} id={`dispatch-${d.id}`}
                className={`overflow-hidden border-primary/40 scroll-mt-4 ${focusDispatch === d.id ? 'ring-2 ring-primary' : ''}`}>
                {photo && (
                  <button
                    type="button"
                    className="relative w-full group cursor-zoom-in"
                    onClick={() => setZoomPhoto({ src: photo, alt: 'Job photo' })}
                    aria-label="Tap to zoom the photo"
                  >
                    <img src={photo} alt="Job" className="w-full max-h-72 object-contain bg-muted" />
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/60 text-white text-[10px] px-2 py-1">
                      Tap to zoom
                    </span>
                  </button>
                )}
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{(d as any).bid_requests?.title || 'Ground work'}</span>
                    {claimed && <Badge className="text-[10px]">You're on it</Badge>}
                    {!claimed && d.status !== 'open' && (
                      <Badge variant="outline" className="text-[10px]">All spots filled</Badge>
                    )}
                  </div>
                  {(d as any).bid_requests?.city && (
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-4 h-4" />{(d as any).bid_requests.city}
                    </div>
                  )}
                  {d.scheduled_date && (
                    <div className="text-sm">Scheduled for <strong>{d.scheduled_date}</strong></div>
                  )}
                  {d.pay_per_worker != null && (
                    <div className="text-sm">
                      {d.pay_rate_type === 'hourly'
                        ? `Pay ${money(d.pay_per_worker)} per hour`
                        : `Estimated pay ${money(d.pay_per_worker)} for about ${Math.round((Number(d.pay_per_worker) / 25) * 10) / 10} hours`}
                    </div>
                  )}
                  {!((d as any).offered_dates?.length) && <div className="text-xs text-muted-foreground">
                    {left} of {d.slots} spot{Number(d.slots) === 1 ? '' : 's'} still open
                  </div>}
                  {((d as any).offered_dates?.length ?? 0) > 0 && d.status === 'open' && (
                    <div className="text-xs text-muted-foreground">
                      Needs {d.slots} ground worker{Number(d.slots) === 1 ? '' : 's'}. The first {d.slots} to pick the same day get the job.
                    </div>
                  )}
                  {((d as any).offered_dates?.length ?? 0) > 0 ? (() => {
                    const offered: string[] = (d as any).offered_dates;
                    const saved: string[] = (claimed as any)?.available_dates ?? [];
                    const picks = dayPicks[d.id] ?? saved;
                    const hiredMe = d.status === 'filled' && (claimed as any)?.status === 'confirmed';
                    if (d.status !== 'open') {
                      return (
                        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                          {hiredMe
                            ? <>You're hired for <strong>{(d as any).awarded_date}</strong>. The office will follow up with start time.</>
                            : 'This job is now full. Thanks — watch for the next one.'}
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        <div className="text-sm font-medium">Which days can you work? Tap all that fit.</div>
                        <div className="grid grid-cols-2 gap-2">
                          {offered.map((day) => {
                            const on = picks.includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => setDayPicks((p) => ({
                                  ...p,
                                  [d.id]: on ? picks.filter((x) => x !== day) : [...picks, day],
                                }))}
                                className={`rounded-md border px-3 py-2 text-sm text-left ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
                              >
                                {format(new Date(day + 'T12:00:00'), 'EEE, MMM d')}
                              </button>
                            );
                          })}
                        </div>
                        <Button className="w-full" disabled={claiming === d.id} onClick={() => saveDays(d.id, picks)}>
                          {claiming === d.id ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Applying…</> : 'Apply for This Job'}
                        </Button>
                        {saved.length > 0 && (
                          <div className="text-xs text-muted-foreground">Saved: {saved.join(', ')}. We'll text you the moment the crew is set.</div>
                        )}
                      </div>
                    );
                  })() : claimed ? (
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                      You've got a spot. The office will be in touch with the details.
                    </div>
                  ) : (
                    d.status === 'open' && (
                      <Button className="w-full" disabled={claiming === d.id} onClick={() => claimSpot(d.id)}>
                        {claiming === d.id
                          ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Claiming…</>
                          : 'Claim this spot'}
                      </Button>
                    )
                  )}
                  {claimed && (
                    <JobChat
                      bidRequestId={d.bid_request_id}
                      crewMemberId={(claimed as any).crew_member_id}
                      side="crew"
                      otherName="The office"
                      jobTitle={(d as any).bid_requests?.title || 'Ground work'}
                    />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {shownRequests.length === 0 && shownDispatches.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Gavel className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <div className="font-medium text-foreground">{emptyText[tab][0]}</div>
          <div className="text-sm mt-1">{emptyText[tab][1]}</div>
        </Card>
      ) : (
        <div className="space-y-4">
          {shownRequests.map((r) => {
            const mine = bidFor(r.id);
            const editing = openId === r.id;
            const closed = r.status !== 'open';
            const iWon = mine?.status === 'won' && r.awarded_bid_id === mine.id;
            const datesStatus = (r as any).climber_dates_status as string | null;
            const futureConfirmed = ((r as any).confirmed_dates ?? []).filter((x: string) => !isPassed(x));
            const lockedDays = lockedFor(r.id);
            return (
              <Card key={r.id} id={`job-${r.id}`}
                className={`overflow-hidden scroll-mt-4 ${focusJob === r.id ? 'ring-2 ring-primary' : ''}`}>
                {iWon && datesStatus === 'requested' && (
                  <div className="border-b-2 border-primary bg-primary/5 p-3 text-sm space-y-2">
                    <div className="font-semibold">You've got this job. Pick the days you can do it.</div>
                    <div className="text-xs text-muted-foreground">Tap every day that works. We'll line up the ground crew on those days.</div>
                    <ConfirmClimberDates requestId={r.id} locked={lockedDays}
                      suggested={[...futureConfirmed, ...(mine!.available_dates ?? []).filter((d: string) => !isPassed(d))]} />
                  </div>
                )}
                {iWon && datesStatus === 'confirmed' && (
                  <div className="border-b p-3 text-sm space-y-2">
                    <div>
                      {futureConfirmed.length
                        ? <>Your days: <strong>{futureConfirmed.join(', ')}</strong>.</>
                        : <>All your confirmed days have passed.</>}
                    </div>
                    {editDays === r.id ? (
                      <ConfirmClimberDates requestId={r.id} locked={lockedDays} cta="Save my days"
                        suggested={futureConfirmed} onDone={() => setEditDays(null)} />
                    ) : (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => setEditDays(r.id)}>
                        <CalendarIcon className="w-4 h-4 mr-1.5" />Change my days
                      </Button>
                    )}
                  </div>
                )}
                 {r.photo_path && (
                   photos[r.id] ? (
                     <button
                       type="button"
                       className="relative w-full group cursor-zoom-in"
                       onClick={() => setZoomPhoto({ src: photos[r.id]!, alt: r.title })}
                       aria-label="Tap to zoom the photo"
                     >
                       <img src={photos[r.id]!} alt={r.title} className="w-full h-72 object-contain bg-muted" />
                       <span className="absolute bottom-2 right-2 rounded-full bg-black/60 text-white text-[10px] px-2 py-1 opacity-90 group-hover:opacity-100">
                         Tap to zoom
                       </span>
                     </button>
                   ) : (
                     <div className="h-72 bg-muted flex items-center justify-center text-xs text-muted-foreground">
                       <ImageIcon className="w-4 h-4 mr-1.5" />Loading photo…
                     </div>
                   )
                 )}
                <TreePhotoGallery requestId={r.id} trees={r.trees} onZoom={(src, alt) => setZoomPhoto({ src, alt })} />
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{r.title}</span>
                        {(r as any).needs_stump_grinding && <Badge variant="outline" className="text-[10px]">Tree Removal + Stump Grinding</Badge>}
                        {mine?.status === 'hired' && <Badge className="text-[10px]">You're hired</Badge>}
                        {mine?.status === 'won' && <Badge className="text-[10px]">You're being considered</Badge>}
                        {mine?.status === 'lost' && <Badge variant="outline" className="text-[10px]">No longer available</Badge>}
                        {!mine && !closed && <Badge className="text-[10px]">Open for your bid</Badge>}
                      </div>
                      {companies[r.owner_contractor_id] && (
                        <div className="text-xs mt-0.5">
                          {companies[r.owner_contractor_id].company} · <RatingBadge avg={companies[r.owner_contractor_id].rating_avg} count={companies[r.owner_contractor_id].rating_count} />
                        </div>
                      )}
                      {(r as any).pay_mode === 'fixed' && (r as any).fixed_pay && (
                        <Badge className="text-[10px] mt-1">Pay offered: ${Number((r as any).fixed_pay).toLocaleString()}{(r as any).fixed_pay_type === 'hourly' ? '/hr' : ' for the job'}. Enter it as your bid to accept.</Badge>
                      )}
                      {((r as any).equipment_needed ?? []).length > 0 && (
                        <div className="text-xs mt-0.5">Bring: {((r as any).equipment_needed as string[]).map((e) => e.replace('_', ' ')).join(', ')}</div>
                      )}
                      {r.workflow_status === 'job_complete' && mine?.status === 'hired' && (
                        <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => setRateId(r.id)}>★ Rate this company</Button>
                      )}
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </div>
                    </div>
                    {r.city && (
                      <div className="text-sm flex items-center gap-1 text-muted-foreground">
                        <MapPin className="w-4 h-4" />{r.city}
                      </div>
                    )}
                  </div>

                  {r.description && <p className="text-sm whitespace-pre-wrap">{r.description}</p>}

                  {scoutNotes?.[r.id]?.notes && (
                    <div className="rounded-md border bg-muted/40 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide">Scout observations</div>
                      {(scoutNotes[r.id].difficulty || scoutNotes[r.id].risk) && (
                        <div className="text-xs mt-1">
                          {scoutNotes[r.id].difficulty && <>Difficulty: <strong>{scoutNotes[r.id].difficulty}</strong> </>}
                          {scoutNotes[r.id].risk && <>· Risk: <strong>{scoutNotes[r.id].risk}</strong></>}
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap mt-1.5">{scoutNotes[r.id].notes}</p>
                    </div>
                  )}



                  {mine?.status === 'hired' && (
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                      <div className="font-semibold">You're hired for this job.</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        The office will send you the job details and start time.
                      </div>
                    </div>
                  )}

                  {mine && !editing && (
                    <div className="rounded-md bg-muted/50 p-3 text-sm">
                      <div className="font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-primary" />Your offer
                      </div>
                      <div className="mt-1">
                        Minimum {money(mine.min_pay)} · Ideal {money(mine.ideal_pay)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {(mine as any).people_count != null && <>crew of {(mine as any).people_count} · </>}
                        {mine.est_hours != null && <>{mine.est_hours} hrs · </>}
                        {(mine.available_dates ?? []).join(', ') || 'no dates picked'}
                      </div>
                    </div>
                  )}

                  {editing ? (
                    <div className="space-y-3">
                      {false && (
                        <div>
                          <Label>Are you bidding to climb or to work the ground?</Label>
                          <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="climber">Climbing</SelectItem>
                              <SelectItem value="ground">Ground work</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {form.role === 'crane' && (
                        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
                          <div className="text-sm font-semibold">Crane work</div>
                          <div>
                            <Label htmlFor={`crane-${r.id}`}>Your price for the crane work $ *</Label>
                            <Input id={`crane-${r.id}`} type="number" inputMode="decimal"
                              value={form.minPay} onChange={(e) => setForm({ ...form, minPay: e.target.value })} />
                          </div>
                          <div>
                            <Label htmlFor={`crane-hrs-${r.id}`}>Hours on site (optional)</Label>
                            <Input id={`crane-hrs-${r.id}`} type="number" inputMode="decimal"
                              value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
                          </div>
                        </div>
                      )}
                      {form.role === 'stump' && (
                        <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
                          <div className="text-sm font-semibold">Stump grinding</div>
                          {(r as any).stump_diameter_inches != null && (
                            <div className="text-xs text-muted-foreground">
                              About {(r as any).stump_diameter_inches}" across.
                            </div>
                          )}
                          <div>
                            <Label htmlFor={`stump-${r.id}`}>Your price for the stump $ *</Label>
                            <Input id={`stump-${r.id}`} type="number" inputMode="decimal"
                              value={form.minPay} onChange={(e) => setForm({ ...form, minPay: e.target.value })} />
                          </div>
                        </div>
                      )}
                      {form.role === 'ground' && (
                        <div>
                          <Label>Is that a day rate or hourly? *</Label>
                          <Select value={form.rateType} onValueChange={(v) => setForm({ ...form, rateType: v })}>
                            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="day">Day rate</SelectItem>
                              <SelectItem value="hourly">Hourly</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {!['stump','crane'].includes(form.role) && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor={`min-${r.id}`}>Your minimum $ *</Label>
                          <Input id={`min-${r.id}`} type="number" inputMode="decimal"
                            value={form.minPay} onChange={(e) => setForm({ ...form, minPay: e.target.value })} />
                        </div>
                        <div>
                          <Label htmlFor={`ideal-${r.id}`}>Your ideal $ *</Label>
                          <Input id={`ideal-${r.id}`} type="number" inputMode="decimal"
                            value={form.idealPay} onChange={(e) => setForm({ ...form, idealPay: e.target.value })} />
                        </div>
                      </div>
                      )}
                      {!['stump','crane'].includes(form.role) && (
                      <div className="grid grid-cols-2 gap-3">
                        {form.role === 'ground' && <div>
                          <Label htmlFor={`crew-${r.id}`}>
                            {form.role === 'ground' ? 'How many of you are coming? *' : 'People needed *'}
                          </Label>
                          <Input id={`crew-${r.id}`} type="number" inputMode="numeric"
                            value={form.crewSize} onChange={(e) => setForm({ ...form, crewSize: e.target.value })} />
                        </div>}
                        <div>
                          <Label htmlFor={`hrs-${r.id}`}>{form.role === 'ground' ? 'Total crew hours *' : 'Job length (hours) *'}</Label>
                          <Input id={`hrs-${r.id}`} type="number" inputMode="decimal"
                            value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
                        </div>
                      </div>
                      )}
                      {form.role === 'climber' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor={`disp-${r.id}`}>Estimated disposal loads *</Label>
                            <Input id={`disp-${r.id}`} type="number" inputMode="numeric" min={0}
                              placeholder="0 if none"
                              value={form.disposalLoads} onChange={(e) => setForm({ ...form, disposalLoads: e.target.value })} />
                          </div>
                          <div>
                            <Label htmlFor={`gc-${r.id}`}>Ground crew needed *</Label>
                            <Input id={`gc-${r.id}`} type="number" inputMode="numeric" min={0}
                              placeholder="0 if none"
                              value={form.groundCrew} onChange={(e) => setForm({ ...form, groundCrew: e.target.value })} />
                          </div>
                          <div>
                            <Label>Mini skid steer needed? *</Label>
                            <div className="flex gap-2 mt-1.5">
                              {(['yes', 'no'] as const).map((v) => (
                                <Button key={v} type="button" size="sm" className="flex-1"
                                  variant={form.miniSkid === v ? 'default' : 'outline'}
                                  onClick={() => setForm({ ...form, miniSkid: v, skidHours: '' })}>
                                  {v === 'yes' ? 'Yes' : 'No'}
                                </Button>
                              ))}
                            </div>
                          </div>
                          {form.miniSkid === 'yes' && (
                            <p className="text-xs text-muted-foreground">
                              We'll bill the mini skid for the job length above.
                            </p>
                          )}
                        </div>
                      )}
                      {!['stump','crane'].includes(form.role) && (
                      <div>
                        <Label htmlFor={`eq-${r.id}`}>
                          {form.role === 'ground' ? 'What can you run or bring? *' : 'Equipment request *'}
                        </Label>
                        <Textarea id={`eq-${r.id}`} rows={2} value={form.equipment}
                          onChange={(e) => setForm({ ...form, equipment: e.target.value })}
                          placeholder={form.role === 'ground'
                            ? 'Type here, e.g. skid steer, chipper, truck and trailer'
                            : 'Type here, e.g. bucket truck, chipper, mini skid (or "none")'} />
                      </div>
                      )}
                      {!['stump','crane'].includes(form.role) && (r.offered_dates ?? []).length > 0 && (
                        <div>
                          <Label>Which of these days can you work? *</Label>
                          <div className="space-y-2 mt-1.5">
                            {r.offered_dates.map((d) => {
                              const why = blockedDays?.get(d);
                              return (
                                <label key={d} className={`flex items-center gap-2 text-sm${why ? ' opacity-50' : ''}`}>
                                  <Checkbox
                                    checked={!why && form.dates.includes(d)}
                                    disabled={!!why}
                                    onCheckedChange={(v) =>
                                      setForm((f) => ({
                                        ...f,
                                        dates: v ? [...f.dates, d] : f.dates.filter((x) => x !== d),
                                      }))
                                    }
                                  />
                                  <span className={why ? 'line-through' : undefined}>{d}</span>
                                  {why && <span className="text-xs text-muted-foreground">({blockedNote(why)})</span>}
                                </label>
                              );
                            })}
                            {form.dates.filter((d) => d !== VISIT_FIRST && !(r.offered_dates ?? []).includes(d)).map((d) => (
                              <label key={d} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked
                                  onCheckedChange={(v) =>
                                    !v && setForm((f) => ({ ...f, dates: f.dates.filter((x) => x !== d) }))
                                  }
                                />
                                <span>{d} <span className="text-xs text-muted-foreground">(your pick)</span></span>
                              </label>
                            ))}
                          </div>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                className="mt-3 w-full h-11 text-sm font-semibold shadow-md border-2 border-dashed border-primary/60 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                              >
                                <CalendarIcon className="w-4 h-4 mr-1.5" />
                                None of these work? Pick your own days
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="multiple"
                                selected={form.dates
                                  .filter((d) => d !== VISIT_FIRST && !(r.offered_dates ?? []).includes(d))
                                  .map((d) => new Date(d + 'T12:00:00'))}
                                disabled={(date) =>
                                  date < new Date(new Date().setHours(0, 0, 0, 0)) || !!blockedDays?.has(format(date, 'yyyy-MM-dd'))}
                                modifiers={{ blocked: (date) => !!blockedDays?.has(format(date, 'yyyy-MM-dd')) }}
                                modifiersClassNames={{ blocked: 'line-through opacity-40' }}
                                onSelect={(days) => {
                                  const custom = (days ?? []).map((d) => format(d, 'yyyy-MM-dd'));
                                  setForm((f) => {
                                    const offered = (r.offered_dates ?? []).filter((d) => f.dates.includes(d));
                                    return { ...f, dates: [...new Set([...offered, ...custom])] };
                                  });
                                }}
                                initialFocus
                                className="p-3 pointer-events-auto"
                              />
                              {!!blockedDays?.size && (
                                <p className="px-3 pb-3 text-xs text-muted-foreground max-w-[18rem]">
                                  Crossed-out days are already booked in Jobber, or the company is closed.
                                </p>
                              )}
                            </PopoverContent>
                          </Popover>
                          <label className="mt-3 flex items-start gap-2.5 rounded-md border-2 border-dashed border-primary/60 bg-primary/5 p-3 text-sm font-semibold text-primary cursor-pointer">
                            <Checkbox
                              className="mt-0.5"
                              checked={form.visitFirst}
                              onCheckedChange={(v) => setForm((f) => ({ ...f, visitFirst: !!v }))}
                            />
                            <span>
                              I'd like to look at this tree first
                              <span className="block text-xs font-normal text-muted-foreground">
                                We'll set up a time for you to see it before you lock in a day.
                              </span>
                            </span>
                          </label>
                        </div>
                      )}
                      <div>
                        <Label htmlFor={`notes-${r.id}`}>Anything else</Label>
                        <Textarea id={`notes-${r.id}`} rows={2} value={form.notes}
                          onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                      </div>
                      {missing(r).length > 0 && (
                        <p className="text-sm font-medium text-destructive">
                          Still need: {missing(r).join(', ')}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button onClick={() => submit(r)} disabled={saving}>
                          {saving
                            ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</>
                            : mine ? 'Update my offer' : 'Send my offer'}
                        </Button>
                        <Button variant="outline" onClick={() => setOpenId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap items-center">
                      {!closed && (!mine || mine.status === 'submitted') && (
                        <>
                          <Button size="sm" variant={mine ? 'outline' : 'default'} onClick={() => startBid(r)}>
                            {mine ? 'Change my offer' : 'Send my offer'}
                          </Button>
                          {mine && (
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                              if (!window.confirm('Withdraw your offer on this job?')) return;
                              const { error, count } = await supabase.from('bids').delete({ count: 'exact' }).eq('id', mine.id);
                              if (error || !count) return toast.error("Couldn't withdraw — it may already be accepted.");
                              toast.success('Offer withdrawn');
                              qc.invalidateQueries();
                            }}>Withdraw offer</Button>
                          )}
                        </>
                      )}
                      {mine && (
                        <JobChat
                          bidRequestId={r.id}
                          crewMemberId={mine.crew_member_id}
                          side="crew"
                          otherName="The office"
                          jobTitle={r.title}
                        />
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <PhotoZoomDialog
        src={zoomPhoto?.src ?? null}
        alt={zoomPhoto?.alt ?? 'Job photo'}
        open={zoomPhoto !== null}
        onOpenChange={(open) => { if (!open) setZoomPhoto(null); }}
      />
    </div>
  );
}
