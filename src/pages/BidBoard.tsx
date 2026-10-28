import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import ScoutInbox from '@/pages/ScoutInbox';
import { supabase } from '@/integrations/supabase/client';
import {
  useBidRequests, useBidsForRequests, useCrewNetwork, useJobDispatches, fetchBidPhotoUrl, prefetchBidPhotos,
  type Bid, type BidRequest,
} from '@/hooks/useCrew';
import { calculatePricing, money } from '@/lib/bidPricing';
import { climberPayFromQuote } from '@/lib/payroll';
import { toPricingInput, withBidExtras, type StoredPricingInputs } from '@/lib/bidPricingInputs';
import { JobCostsPanel } from '@/components/JobCostsPanel';
import { BidPriceCard, aiMidpoint, aiRangeText, quoteOptionLabel, type QuoteOption } from '@/components/BidPriceCard';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { PhotoZoomDialog } from '@/components/PhotoZoomDialog';
import { TreePhotoGallery } from '@/components/TreePhotoGallery';
import { JobThumb } from '@/components/JobThumb';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { JobsCalendar, jobMatches } from '@/components/JobsCalendar';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RequestCrewBidsDialog } from '@/components/RequestCrewBidsDialog';
import { RateJobDialog } from '@/components/Reviews';
import { Bot, Inbox, Gavel, Loader2, Star, Trophy, Plus, Pencil, Image as ImageIcon, MapPin, Phone, ChevronLeft, ChevronRight, X, MessageSquare, Check } from 'lucide-react';
import { EditBidDialog } from '@/components/EditBidDialog';
import { EditJobInfoDialog } from '@/components/EditJobInfoDialog';
import { ConfirmClimberDates, isPassed } from '@/components/ConfirmClimberDates';
import { JobChat } from '@/components/JobChat';
import { DispatchActions } from '@/components/DispatchActions';
import { VisitTextDialog } from '@/components/VisitTextDialog';
import { format, formatDistanceToNow } from 'date-fns';
import { useJobActivity } from '@/hooks/useJobActivity';
import { useJobViews, isRecentJob } from '@/hooks/useJobViews';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { FreeUsageNote } from '@/components/free/FreeUsageNote';
import { useProductionStatus } from '@/hooks/useProductionStatus';

const WORKFLOW_LABELS: Record<string, string> = {
  open: 'Open',
  assessment_scheduled: 'Assessment scheduled',
  quote_sent: 'Quote sent',
  quote_accepted: 'Quote accepted',
  job_scheduled: 'Job scheduled',
  job_complete: 'Job complete',
  quote_declined: 'Quote declined',
  no_longer_needed: 'No longer needed',
  unresponsive: 'Unresponsive',
};

const CLOSED_STATUSES = new Set(['job_complete', 'quote_declined', 'no_longer_needed', 'unresponsive']);

export default function BidBoard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Large-company setup: once the company publishes its crew rates, its own crews' work sits beside the sub jobs.
  const { status: production } = useProductionStatus();
  const { data: ownerProfile } = useProfile();
  const ownerLabel = (ownerProfile?.company_name || '').trim() || 'You';
  const { data: requests, isLoading } = useBidRequests();
  const ids = useMemo(() => (requests ?? []).map((r) => r.id), [requests]);
  const { data: bids } = useBidsForRequests(ids);
  const { data: crew } = useCrewNetwork();
  const { data: dispatchData } = useJobDispatches();
  const [newOpen, setNewOpen] = useState(false);
  const [editJob, setEditJob] = useState<any>(null);
  // Remember the open job so switching browser tabs (or a page reload) brings you back to it.
  const [openId, setOpenIdState] = useState<string | null>(() => {
    try { return sessionStorage.getItem('jobs-open-id'); } catch { return null; }
  });
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    try { id ? sessionStorage.setItem('jobs-open-id', id) : sessionStorage.removeItem('jobs-open-id'); } catch { /* ignore */ }
  };
  const restoredRef = useRef(false);
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [zoomPhoto, setZoomPhoto] = useState<{ src: string; alt: string } | null>(null);
  const [awarding, setAwarding] = useState<string | null>(null);
  const [hiring, setHiring] = useState<string | null>(null);
  const [awardDates, setAwardDates] = useState<Record<string, string>>({});
  const [editBid, setEditBid] = useState<Bid | null>(null);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'review' ? 'review' : params.get('tab') === 'archived' ? 'archived' : params.get('tab') === 'completed' ? 'completed' : 'active';
  const showArchived = tab === 'archived';
  const setTab = (t: string) => setParams(t === 'active' ? {} : { tab: t }, { replace: true });
  const captureIds = useMemo(() => Array.from(new Set((requests ?? []).map((r: any) => r.capture_id).filter(Boolean))) as string[], [requests]);
  const { data: captures } = useQuery({
    queryKey: ['bid-captures', captureIds],
    enabled: captureIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('scout_captures')
        .select('id, ai_notes, ai_difficulty, ai_risk, ai_price_min, ai_price_max, final_notes, final_price_min, final_price_max, ai_service')
        .in('id', captureIds);
      return Object.fromEntries((data ?? []).map((c: any) => [c.id, c])) as Record<string, any>;
    },
  });
  // Website jobs: the AI ballpark the lead came in with, shown next to each crew offer like Scout's price.
  const leadIds = useMemo(() => Array.from(new Set((requests ?? []).map((r: any) => r.lead_id).filter(Boolean))) as string[], [requests]);
  const { data: leadEstimates } = useQuery({
    queryKey: ['bid-lead-estimates', leadIds],
    enabled: leadIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('leads').select('id, estimated_cost_min, estimated_cost_max').in('id', leadIds);
      return Object.fromEntries((data ?? []).map((l: any) => [l.id, l])) as Record<string, any>;
    },
  });
  const { data: reviewCount } = useQuery({
    queryKey: ['scout-review-count', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { count } = await supabase.from('scout_captures').select('id', { count: 'exact', head: true })
        .eq('owner_id', user!.id).eq('status', 'awaiting_review');
      return count ?? 0;
    },
  });
  const [rateId, setRateId] = useState<string | null>(null);
  const isCompletedJob = (r: any) => (r.workflow_status ?? 'open') === 'job_complete';
  const completedCount = (requests ?? []).filter(isCompletedJob).length;
  const archivedCount = (requests ?? []).filter((r) => CLOSED_STATUSES.has(r.workflow_status ?? 'open') && !isCompletedJob(r)).length;
  const [visitJob, setVisitJob] = useState<any>(null);
  const visitsOnly = params.get('visits') === '1';
  const needsVisit = (r: any) => !!r.needs_site_visit && ['open', 'assessment_scheduled'].includes(r.workflow_status ?? 'open');
  const visitCount = (requests ?? []).filter(needsVisit).length;
  const activityFlags = useJobActivity(user?.id, openId);
  const viewedJobs = useJobViews(user?.id, openId);
  const [jobSearch, setJobSearch] = useState('');
  const newOnly = params.get('new') === '1';
  // Freeze the "new" list on arrival so opening a job doesn't make it vanish mid-look.
  const newIdsRef = useRef<Set<string> | null>(null);
  if (newOnly && !newIdsRef.current && viewedJobs && requests) {
    newIdsRef.current = new Set(requests.filter((r: any) => isRecentJob(r.created_at) && !viewedJobs.has(r.id)).map((r) => r.id));
  }
  const searching = jobSearch.trim().length > 0;
  const shown = (requests ?? [])
    // A search looks across all tabs, so a match is never hidden by the current tab.
    .filter((r) => searching || (tab === 'completed' ? isCompletedJob(r) : tab === 'archived' ? CLOSED_STATUSES.has(r.workflow_status ?? 'open') && !isCompletedJob(r) : !CLOSED_STATUSES.has(r.workflow_status ?? 'open')))
    .filter((r: any) => !searching || jobMatches(jobSearch, r.customer_name, r.customer_address, r.city, r.title))
    .filter((r) => searching || !visitsOnly || needsVisit(r))
    .filter((r) => searching || !newOnly || !!newIdsRef.current?.has(r.id))
    // Activity badges update live, but reading one must never move its job.
    .sort((a, b) => Number(needsVisit(b)) - Number(needsVisit(a))
      || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const hasAiPrice = (r: any) => {
    const c = r.capture_id ? captures?.[r.capture_id] : null;
    return !!c && (c.final_price_min ?? c.final_price_max ?? c.ai_price_min ?? c.ai_price_max) != null;
  };
  const markVisitDone = async (id: string) => {
    const { data, error } = await supabase.functions.invoke('job-visit-text', { body: { action: 'done', bid_request_id: id } });
    if (error || data?.error) return toast.error("Couldn't update the job");
    toast.success('Site visit marked done');
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
  };

  const crewName = (id: string) => {
    const c = (crew ?? []).find((x) => x.id === id);
    return c?.full_name || c?.email || 'Crew member';
  };
  const crewRating = (id: string) => (crew ?? []).find((x) => x.id === id)?.rating_avg ?? null;
  const crewJobs = (id: string) => (crew ?? []).find((x) => x.id === id)?.jobs_completed ?? 0;

  const bidsFor = (requestId: string) => (bids ?? []).filter((b) => b.bid_request_id === requestId);

  // Unread job messages, so the list can flag jobs with new notes from subs.
  const uid = user?.id;
  const [unreadByJob, setUnreadByJob] = useState<Record<string, number>>({});
  const [latestUnreadCrew, setLatestUnreadCrew] = useState<Record<string, string>>({});
  const loadUnread = useCallback(async () => {
    if (!uid) return;
    const [msgRes, readRes] = await Promise.all([
      supabase.from('job_messages')
        .select('bid_request_id, crew_member_id, sender_user_id, sender_side, created_at'),
      supabase.from('job_message_reads')
        .select('bid_request_id, crew_member_id, last_read_at')
        .eq('user_id', uid),
    ]);
    if (msgRes.error || readRes.error) return;
    const reads = new Map<string, string>();
    for (const r of (readRes.data ?? []) as any[]) {
      reads.set(`${r.bid_request_id}|${r.crew_member_id}`, r.last_read_at);
    }
    const counts: Record<string, number> = {};
    const latest: Record<string, { crew: string; at: string }> = {};
    for (const m of (msgRes.data ?? []) as any[]) {
      if (m.sender_side === 'office' || m.sender_user_id === uid) continue;
      const last = reads.get(`${m.bid_request_id}|${m.crew_member_id}`);
      if (last && m.created_at <= last) continue;
      counts[m.bid_request_id] = (counts[m.bid_request_id] ?? 0) + 1;
      if (!latest[m.bid_request_id] || m.created_at > latest[m.bid_request_id].at) {
        latest[m.bid_request_id] = { crew: m.crew_member_id, at: m.created_at };
      }
    }
    setUnreadByJob(counts);
    setLatestUnreadCrew(Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v.crew])));
  }, [uid]);

  useEffect(() => { loadUnread(); }, [loadUnread]);

  // Live: any new job message refreshes the badges.
  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel('job-unread-badges')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_messages' }, () => { loadUnread(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, loadUnread]);

  // Opening or closing a job may mark messages read — refresh a beat later.
  useEffect(() => {
    if (!openId) return;
    const t = setTimeout(loadUnread, 1200);
    return () => clearTimeout(t);
  }, [openId, loadUnread]);


  const pickQuote = async (r: BidRequest, b: Bid, option: QuoteOption, amount: number, priced?: { minimumSaleFloor: number | null; baseSale: number | null }) => {
    const cur = (r as any).quote_pick;
    const same = cur?.bid_id === b.id && cur?.option === option;
    // Climber pay follows the quote: min quote → his min, ideal quote or more → his ideal, in between → proportional.
    const climberPay = same ? null : climberPayFromQuote(
      priced?.minimumSaleFloor ?? null, priced?.baseSale ?? null, amount, Number(b.min_pay), Number(b.ideal_pay),
    );
    const pick = same ? null : {
      bid_id: b.id, option, amount, climber_pay: climberPay,
      picked_by_name: ((user?.user_metadata as any)?.full_name || user?.email || '').split(/[ @]/)[0] || null,
      picked_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('bid_requests').update({ quote_pick: pick } as any).eq('id', r.id);
    if (error) return toast.error('Could not save your pick');
    await supabase.from('bids').update({ agreed_pay: climberPay } as any).eq('id', b.id);
    toast.success(same ? 'Pick cleared' : `Picked ${quoteOptionLabel(option)} — ${money(amount)}. Climber pay ${money(climberPay)}. Team alerted.`);
    if (!same) supabase.functions.invoke('quote-pick-alert', { body: { bid_request_id: r.id } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
    qc.invalidateQueries({ queryKey: ['bids'] });
  };

  // The AI's middle price picked for the whole job, before or without a crew offer (bid_id stays null).
  const pickJobAi = async (r: BidRequest, amount: number) => {
    const cur = (r as any).quote_pick;
    const same = !!cur && !cur.bid_id && cur.option === 'ai';
    const pick = same ? null : {
      bid_id: null, option: 'ai', amount, climber_pay: null,
      picked_by_name: ((user?.user_metadata as any)?.full_name || user?.email || '').split(/[ @]/)[0] || null,
      picked_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('bid_requests').update({ quote_pick: pick } as any).eq('id', r.id);
    if (error) return toast.error('Could not save your pick');
    toast.success(same ? 'Pick cleared' : `Picked the AI price — ${money(amount)}. Team alerted.`);
    if (!same) supabase.functions.invoke('quote-pick-alert', { body: { bid_request_id: r.id } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
  };

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const onThumbLoaded = useCallback((id: string, url: string | null) => {
    setPhotos((p) => (p[id] !== undefined ? p : { ...p, [id]: url }));
  }, []);

  // Fetch every job's photo in one batch as soon as the list loads, so the
  // small thumbnails appear together instead of one server call per card.
  useEffect(() => {
    if (!requests) return;
    const ids = requests.filter((r: any) => r.photo_path).map((r: any) => r.id as string);
    if (ids.length === 0) return;
    let alive = true;
    prefetchBidPhotos(ids).then((sets) => {
      if (!alive) return;
      setPhotos((p) => {
        const next = { ...p };
        for (const [id, set] of Object.entries(sets)) {
          if (next[id] === undefined) next[id] = set.cover;
        }
        return next;
      });
    });
    return () => { alive = false; };
  }, [requests]);

  const openJob = async (r: BidRequest) => {
    setOpenId(r.id);
    requestAnimationFrame(() => {
      // An animated scroll can keep fighting a wheel/touch gesture after opening.
      cardRefs.current[r.id]?.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    if (r.photo_path && photos[r.id] === undefined) {
      const url = await fetchBidPhotoUrl(r.id);
      setPhotos((p) => ({ ...p, [r.id]: url }));
    }
  };

  const toggle = async (r: BidRequest) => {
    if (openId === r.id) { setOpenId(null); return; }
    await openJob(r);
  };

  // After a reload, reopen the remembered job once the list has loaded.
  useEffect(() => {
    if (restoredRef.current || !requests) return;
    restoredRef.current = true;
    const linked = params.get('job');
    const target = linked ?? openId;
    if (!target) return;
    const r = requests.find((x) => x.id === target);
    if (!r) { setOpenId(null); return; }
    setTimeout(() => openJob(r), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests]);

  const openIndex = openId ? shown.findIndex((x) => x.id === openId) : -1;
  const goTo = (delta: number) => {
    const target = shown[openIndex + delta];
    if (target) openJob(target);
  };
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // Arrow keys move between jobs while one is open.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"]'))) return;
      if (e.key === 'ArrowRight') goToRef.current(1);
      else if (e.key === 'ArrowLeft') goToRef.current(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId]);

  // Swipe left/right on an open job.
  const touchStart = useRef<{ x: number; y: number; ignore: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.target as HTMLElement;
    const ignore = e.touches.length > 1 || !!t.closest('input, textarea, select, [role="combobox"], [role="slider"], .overflow-x-auto');
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ignore };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s0 = touchStart.current;
    touchStart.current = null;
    if (!s0 || s0.ignore || zoomPhoto) return;
    const dx = e.changedTouches[0].clientX - s0.x;
    const dy = e.changedTouches[0].clientY - s0.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    goToRef.current(dx < 0 ? 1 : -1);
  };

  const saveNumbers = async (r: BidRequest, patch: Partial<BidRequest>) => {
    const { error } = await supabase.from('bid_requests').update(patch as any).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
  };

  const savePricing = async (r: BidRequest, next: StoredPricingInputs) => {
    const { error } = await supabase
      .from('bid_requests')
      .update({ pricing_inputs: next as any })
      .eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Job costs saved');
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
  };

  const updateStumpGrinding = async (r: BidRequest, enabled: boolean, diameter?: number | null) => {
    const { data, error } = await supabase.functions.invoke('update-job-stump', {
      body: {
        bid_request_id: r.id,
        needs_stump_grinding: enabled,
        stump_diameter_inches: diameter === undefined ? r.stump_diameter_inches ?? null : diameter,
      },
    });
    const message = error?.message || (data as any)?.error;
    if (message) return toast.error(message);
    const notified = Number((data as any)?.notified ?? 0);
    toast.success(
      enabled
        ? notified > 0
          ? `Stump grinding added — ${notified} stump grinder${notified === 1 ? '' : 's'} alerted`
          : 'Stump grinding added — no eligible stump grinder to alert yet'
        : 'Stump grinding removed',
    );
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
  };

  const useStumpPrice = async (r: BidRequest, bid: Bid) => {
    const pricing = { ...((r.pricing_inputs ?? {}) as Record<string, unknown>), stumpCost: Number(bid.min_pay) };
    const { error } = await supabase
      .from('bid_requests')
      .update({ awarded_stump_bid_id: bid.id, pricing_inputs: pricing } as any)
      .eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('That stump price is now in the quote');
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
  };

  const releaseHold = async (r: BidRequest) => {
    const { data, error } = await supabase.functions.invoke('crew-release-holds', {
      body: { bid_request_id: r.id },
    });
    if (error || (data as any)?.error) {
      toast.error(error?.message || (data as any)?.error || 'Could not open it up');
      return;
    }
    toast.success('Opened up to the rest of your subs');
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
  };

  const award = async (r: BidRequest, bid: Bid, role: 'climber' | 'ground' = 'climber') => {
    setAwarding(bid.id);
    try {
      const date =
        awardDates[bid.id] ??
        (bid.available_dates ?? []).filter((d) => d !== 'wants-site-visit')[0] ??
        null;
      const groundOnTop = role === 'ground' && !!r.awarded_bid_id;
      const { data, error } = await supabase.functions.invoke('bid-award', {
        body: groundOnTop
          ? { bid_id: r.awarded_bid_id, awarded_date: r.awarded_date, ground_bid_id: bid.id, ground_awarded_date: date }
          : { bid_id: bid.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(
        data?.quote_status === 'not_created'
          ? `${crewName(bid.crew_member_id)} picked — build the quote in Jobber`
          : `${crewName(bid.crew_member_id)} picked and the customer quote is on its way`,
      );
      qc.invalidateQueries({ queryKey: ['bid-requests'] });
      qc.invalidateQueries({ queryKey: ['bids'] });
    } catch (e: any) {
      toast.error(e?.message || 'Could not award the bid');
    } finally {
      setAwarding(null);
    }
  };

  const confirmHire = async (r: BidRequest) => {
    setHiring(r.id);
    try {
      const { data, error } = await supabase.functions.invoke('bid-hire', {
        body: { bid_request_id: r.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`${data?.crew ?? 'Your crew'} has been told they're hired`);
      qc.invalidateQueries({ queryKey: ['bid-requests'] });
      qc.invalidateQueries({ queryKey: ['bids'] });
    } catch (e: any) {
      toast.error(e?.message || 'Could not confirm the hire');
    } finally {
      setHiring(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading bid board…
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gavel className="w-6 h-6 text-primary" />
            Jobs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sealed offers from your crew, with the quote to send and what you keep on every option.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {production.published && <Button asChild variant="outline"><Link to="/dashboard/bid-board/crew">Crew work</Link></Button>}
          <Button onClick={() => setNewOpen(true)}><Plus className="w-4 h-4 mr-1.5" />New bid request</Button>
        </div>
      </div>
      <FreeUsageNote kind="jobs" className="mb-4" />

      <div className="mb-3 flex gap-2 items-center">
        <Input className="flex-1 min-w-0" placeholder="Search name, street or city" value={jobSearch}
          onChange={(e) => setJobSearch(e.target.value)} aria-label="Search jobs" />
        <JobsCalendar onPick={(id) => {
          const job = (requests ?? []).find((x) => x.id === id);
          if (job && isCompletedJob(job)) setTab('completed');
          else if (job && CLOSED_STATUSES.has(job.workflow_status ?? 'open')) setTab('archived');
          else setTab('active');
          setJobSearch('');
          setOpenId(id);
        }} />
      </div>
      <div className="mb-4 flex gap-2 flex-wrap">
        <Button size="sm" variant={tab === 'review' ? 'default' : 'outline'} onClick={() => setTab('review')}>
          <Inbox className="w-4 h-4 mr-1" />Needs review{reviewCount ? ` (${reviewCount})` : ''}
        </Button>
        <Button size="sm" variant={tab === 'active' ? 'default' : 'outline'} onClick={() => setTab('active')}>Active</Button>
        <Button size="sm" variant={tab === 'completed' ? 'default' : 'outline'} onClick={() => setTab('completed')}>Completed ({completedCount})</Button>
        <Button size="sm" variant={tab === 'archived' ? 'default' : 'outline'} onClick={() => setTab('archived')}>Archived ({archivedCount})</Button>
        {tab === 'active' && (
          <Button size="sm" variant={visitsOnly ? 'default' : 'outline'} onClick={() => setParams(visitsOnly ? {} : { visits: '1' }, { replace: true })}>
            Site visits ({visitCount})
          </Button>
        )}
        {newOnly && (
          <Button size="sm" variant="default" onClick={() => setParams({}, { replace: true })}>
            New jobs only ✕
          </Button>
        )}
      </div>

      {tab === 'review' && !searching && <ScoutInbox embedded />}

      {(requests ?? []).length > 0 && shown.length === 0 && (searching || tab !== 'review') ? (
        <Card className="p-10 text-center text-muted-foreground">
          {searching ? 'No jobs match your search.' : tab === 'completed' ? 'No completed jobs yet.' : showArchived ? 'No archived jobs yet.' : 'No active jobs. Closed jobs are under Archived or Completed.'}
        </Card>
      ) : tab === 'review' && !searching ? null : (requests ?? []).length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Gavel className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <div className="font-medium text-foreground">No bid requests yet</div>
          <div className="text-sm mt-1">
            Start one here, or tap <strong>Request crew bids</strong> on a Scout capture.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {openIndex >= 0 && (() => {
            const cur = shown[openIndex];
            return (
              <div className="sticky top-16 lg:top-0 z-30 -mx-1 rounded-lg border bg-background/95 backdrop-blur shadow-sm p-2 flex items-center gap-2">
                <JobThumb requestId={cur.id} hasPhoto={!!cur.photo_path} known={photos[cur.id]} onLoaded={onThumbLoaded} className="w-10 h-10" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{cur.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{cur.customer_name ? `${cur.customer_name} · ` : ''}Job {openIndex + 1} of {shown.length}{cur.city ? ` · ${cur.city}` : ''}</div>
                </div>
                <Button size="sm" variant="outline" className="h-9 px-2" disabled={openIndex === 0} onClick={() => goTo(-1)} aria-label="Previous job">
                  <ChevronLeft className="w-4 h-4" /><span className="hidden sm:inline ml-1">Previous</span>
                </Button>
                <Button size="sm" variant="outline" className="h-9 px-2" disabled={openIndex >= shown.length - 1} onClick={() => goTo(1)} aria-label="Next job">
                  <span className="hidden sm:inline mr-1">Next</span><ChevronRight className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-9 px-2" onClick={() => setOpenId(null)} aria-label="Close job">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            );
          })()}
          {shown.map((r) => {
            const list = bidsFor(r.id);
            const isOpen = openId === r.id;
            return (
              <Card
                key={r.id}
                ref={(el) => { cardRefs.current[r.id] = el; }}
                className={`overflow-hidden scroll-mt-36 lg:scroll-mt-20 ${isOpen ? 'ring-2 ring-primary' : ''}`}
                onTouchStart={isOpen ? onTouchStart : undefined}
                onTouchEnd={isOpen ? onTouchEnd : undefined}
              >
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  className="w-full text-left p-4 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <JobThumb
                      requestId={r.id}
                      hasPhoto={!!r.photo_path}
                      known={photos[r.id]}
                      onLoaded={onThumbLoaded}
                      treeCount={Array.isArray(r.trees) ? r.trees.length : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{r.title}</span>
                        <span onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={r.workflow_status ?? 'open'}
                            onValueChange={async (v) => {
                              const { error } = await supabase
                                .from('bid_requests')
                                .update({ workflow_status: v } as any)
                                .eq('id', r.id);
                              if (error) toast.error('Could not update status');
                              else {
                                toast.success(`Status: ${WORKFLOW_LABELS[v]}`);
                                qc.invalidateQueries({ queryKey: ['bid-requests'] });
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs w-auto gap-1 px-2">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(WORKFLOW_LABELS).map(([k, label]) => (
                                <SelectItem key={k} value={k}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </span>
                        {r.customer_name && <span className="text-xs text-muted-foreground">{r.customer_name}</span>}
                        {(unreadByJob[r.id] ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const crewId = latestUnreadCrew[r.id];
                              if (openId !== r.id) openJob(r);
                              const next = new URLSearchParams(params);
                              next.set('job', r.id);
                              if (crewId) next.set('chat', crewId);
                              setParams(next, { replace: true });
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-destructive text-destructive-foreground text-[10px] px-2 py-0.5"
                            title="Open the new message"
                          >
                            <MessageSquare className="w-3 h-3" />
                            {unreadByJob[r.id]} new
                          </button>
                        )}
                        {activityFlags[r.id] && (
                          <Badge className="text-[10px] bg-primary text-primary-foreground font-bold" title={formatDistanceToNow(new Date(activityFlags[r.id].at), { addSuffix: true })}>
                            {activityFlags[r.id].summary}{activityFlags[r.id].count > 1 ? ` +${activityFlags[r.id].count - 1} more` : ''}
                          </Badge>
                        )}
                        {r.needs_stump_grinding && (
                          <Badge variant="outline" className="text-[10px]">
                            {(r.capture_id && captures?.[r.capture_id]?.ai_service) || 'Tree Removal'} + Stump Grinding
                          </Badge>
                        )}
                        {r.city && <Badge variant="outline" className="text-[10px]">{r.city}</Badge>}
                        {r.workflow_status === 'quote_sent' && (r as any).discount_quote_sent_at ? (
                          <Badge variant="outline" className="text-[10px]">
                            Discount quote sent · {format(new Date((r as any).discount_quote_sent_at), 'MMM d')}
                          </Badge>
                        ) : r.workflow_status === 'quote_sent' && (r as any).quote_sent_at &&
                          Date.now() - new Date((r as any).quote_sent_at).getTime() >= 12 * 3600_000 && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button type="button" className="inline-flex items-center gap-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold px-2 py-0.5" title="Quote sent 12+ hours ago and not accepted yet">
                                  Send discount quote <ChevronDown className="w-3 h-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={async () => {
                                  const { error } = await supabase.from('bid_requests')
                                    .update({ discount_quote_sent_at: new Date().toISOString() } as any).eq('id', r.id);
                                  if (error) return toast.error('Could not save');
                                  toast.success('Marked: discount quote sent');
                                  qc.invalidateQueries({ queryKey: ['bid-requests'] });
                                }}>
                                  Mark discount quote sent
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </span>
                        )}
                        {needsVisit(r) && (
                          <Badge className="text-[10px] bg-accent text-accent-foreground font-bold" title="The owner needs to see this job in person">
                            Needs site visit
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </div>
                      <span onClick={(e) => e.stopPropagation()}>
                        <WorkflowNote
                          key={`wn-${r.id}`}
                          initial={r.workflow_notes ?? ''}
                          onSave={async (text) => {
                            const { error } = await supabase.from('bid_requests').update({ workflow_notes: text.trim() || null } as any).eq('id', r.id);
                            if (error) return toast.error('Could not save note');
                            toast.success('Note saved');
                            qc.invalidateQueries({ queryKey: ['bid-requests'] });
                          }}
                        />
                      </span>
                      {!CLOSED_STATUSES.has(r.workflow_status ?? 'open') && (
                        <span onClick={(e) => e.stopPropagation()} className="mt-2 flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setVisitJob(r)}>
                            {(r as any).visit_text_sent_at ? 'Resend visit text' : 'Schedule visit'}
                          </Button>
                          {needsVisit(r) && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => markVisitDone(r.id)}>Visit done</Button>
                          )}
                          {(r as any).visit_text_sent_at && (
                            <span className="text-[11px] text-muted-foreground">
                              Visit text sent {formatDistanceToNow(new Date((r as any).visit_text_sent_at), { addSuffix: true })}
                            </span>
                          )}
                        </span>
                      )}
                      {r.workflow_status === 'job_complete' && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => setRateId(r.id)}>
                            ★ Rate your subs
                          </Button>
                        </span>
                      )}
                      <span onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" className="mt-2 h-7 text-xs text-destructive" onClick={async () => {
                          if (!window.confirm(`Delete "${r.title}"? This removes the job and all its offers and cannot be undone.`)) return;
                          const { error, count } = await supabase.from('bid_requests').delete({ count: 'exact' }).eq('id', r.id);
                          if (error || !count) return toast.error("Couldn't delete this job");
                          toast.success('Job deleted');
                          qc.invalidateQueries({ queryKey: ['bid-requests'] });
                        }}>Delete job</Button>
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-primary">{list.length}</div>
                      <div className="text-xs text-muted-foreground">
                        {list.length === 1 ? 'offer' : 'offers'}
                      </div>
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t p-4 space-y-4">
                    {(r as any).capture_id && captures?.[(r as any).capture_id] && (() => {
                      const c = captures[(r as any).capture_id];
                      const notes = c.final_notes || c.ai_notes;
                      return (
                        <details open className="rounded-md border bg-muted/40 p-3 text-sm">
                          <summary className="cursor-pointer font-semibold flex items-center gap-1.5">
                            <Bot className="w-4 h-4 text-primary" />Scout AI — {c.ai_price_min == null && c.ai_price_max == null ? 'No AI price' : <>{money(c.ai_price_min)}{c.ai_price_max != null && c.ai_price_max !== c.ai_price_min ? ` – ${money(c.ai_price_max)}` : ''}</>}
                          </summary>
                          <div className="mt-2 space-y-1">
                            {(c.ai_difficulty || c.ai_risk) && (
                              <div className="text-xs">{c.ai_difficulty && <>Difficulty: <strong>{c.ai_difficulty}</strong> </>}{c.ai_risk && <>· Risk: <strong>{c.ai_risk}</strong></>}</div>
                            )}
                            {notes ? <div className="whitespace-pre-wrap">{notes}</div> : <div className="text-muted-foreground">No notes from Scout.</div>}
                            <div className="text-[11px] text-muted-foreground">These notes are added to the Jobber quote when you award.</div>
                          </div>
                        </details>
                      );
                    })()}
                     <div className="space-y-1 text-sm">
                         {r.customer_address && (
                           <a
                             href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.customer_address)}`}
                             target="_blank" rel="noopener noreferrer"
                             className="flex items-center gap-1.5 text-primary underline underline-offset-2"
                           >
                             <MapPin className="w-4 h-4 shrink-0" />{r.customer_address}
                           </a>
                         )}
                         {r.customer_name && <div className="text-foreground">{r.customer_name}</div>}
                         {r.customer_phone && (
                           <a href={`tel:${r.customer_phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 text-primary underline underline-offset-2">
                             <Phone className="w-4 h-4 shrink-0" />{r.customer_phone}
                           </a>
                         )}
                         <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditJob(r)}>
                           <Pencil className="w-3 h-3 mr-1" />Edit name, address &amp; phone
                         </Button>
                       </div>
                     {r.photo_path && (() => {
                       const src = photos[r.id];
                       return src ? (
                         <Button
                           type="button"
                           variant="ghost"
                           className="relative w-full h-64 p-0 group cursor-zoom-in bg-muted rounded-md"
                           onClick={() => setZoomPhoto({ src, alt: r.title })}
                           aria-label="Tap to zoom the photo"
                         >
                           <img src={src} alt={r.title} className="w-full h-full object-contain rounded-md" />
                           <span className="absolute bottom-2 right-2 rounded-full bg-foreground/70 text-background text-[10px] px-2 py-1 opacity-90 group-hover:opacity-100">
                             Tap to zoom
                           </span>
                         </Button>
                       ) : (
                         <div className="h-64 rounded-md bg-muted text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                            <ImageIcon className="w-4 h-4" />Loading photo…
                         </div>
                       );
                     })()}
                    <TreePhotoGallery requestId={r.id} trees={r.trees} onZoom={(src, alt) => setZoomPhoto({ src, alt })} />
                    {r.description && <p className="text-sm whitespace-pre-wrap">{r.description}</p>}

                    {r.status === 'awarded' && (
                      <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
                        <div className="font-medium">Climber picked.</div>
                        {(r as any).climber_dates_status === 'requested' ? (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-primary">
                              Waiting on {crewName((bids ?? []).find((x) => x.id === r.awarded_bid_id)?.crew_member_id ?? '')} to confirm days.
                              The ground crew call-out goes out as soon as they do.
                            </p>
                            <details className="text-xs">
                              <summary className="cursor-pointer underline">Confirm dates for the climber</summary>
                              <div className="pt-2">
                                <ConfirmClimberDates requestId={r.id} cta="Confirm and send call-out"
                                  suggested={((bids ?? []).find((x) => x.id === r.awarded_bid_id)?.available_dates ?? []).filter((d) => !isPassed(d))} />
                              </div>
                            </details>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {((r as any).confirmed_dates ?? []).length > 0 && <>Climber confirmed {((r as any).confirmed_dates as string[]).join(', ')}. </>}
                            Ground workers have been texted to pick their days — you'll get a text when the crew is complete.
                          </p>
                        )}
                        {(r as any).climber_dates_status && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => {
                            if (!window.confirm('Ask the climber to pick a new set of dates? Any ground workers already lined up will be told the job is being rescheduled, and a fresh call-out goes out once the climber picks.')) return;
                            const { data, error } = await supabase.functions.invoke('bid-climber-dates', { body: { bid_request_id: r.id, action: 'rerequest' } });
                            if (error || data?.error) return toast.error(data?.error ?? 'Something went wrong');
                            toast.success(`Climber asked for new dates${data.told ? `; ${data.told} ground worker${data.told === 1 ? '' : 's'} told` : ''}.`);
                            qc.invalidateQueries({ queryKey: ['bid-requests'] });
                            qc.invalidateQueries({ queryKey: ['job-dispatches'] });
                          }}>Ask climber for new dates</Button>
                        )}
                        <p className="text-xs text-muted-foreground">
                          The climber isn't told they're hired yet. When your customer accepts the quote, that happens automatically.
                          With Jobber off, tap below to tell the climber yourself.
                        </p>
                        <Button size="sm" onClick={() => confirmHire(r)} disabled={hiring === r.id}>
                          {hiring === r.id
                            ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Notifying…</>
                            : 'Tell the climber they are hired'}
                        </Button>
                      </div>
                    )}

                    {r.status === 'hired' && (
                      <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
                        Crew hired and notified{r.awarded_date ? ` for ${r.awarded_date}` : ''}.
                      </div>
                    )}


                    {r.first_refusal_until && !r.first_refusal_released_at && (
                      <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm space-y-2">
                        <div className="font-medium">
                          Held for your first-pick subs until{' '}
                          {new Date(r.first_refusal_until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Nobody else has been told about this job yet. If you don't want their offer, open it up now.
                        </p>
                        <Button size="sm" variant="outline" onClick={() => releaseHold(r)}>
                          Open it up to everyone
                        </Button>
                      </div>
                    )}

                    <div className="rounded-md border p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">Needs stump grinding</div>
                          <div className="text-xs text-muted-foreground">
                            12in and up goes to your stump grinders. Under 12in stays with you.
                          </div>
                        </div>
                        <Switch
                          checked={r.needs_stump_grinding === true}
                          onCheckedChange={(v) => updateStumpGrinding(r, v)}
                        />
                      </div>
                      {r.needs_stump_grinding && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Stump diameter (inches)</Label>
                            <Input
                              type="number" inputMode="decimal" className="h-9"
                              defaultValue={r.stump_diameter_inches ?? ''}
                              onBlur={(e) => updateStumpGrinding(
                                r,
                                true,
                                e.target.value === '' ? null : Number(e.target.value),
                              )}
                            />
                          </div>
                          <div className="flex items-end text-xs text-muted-foreground">
                            {r.stump_diameter_inches != null && Number(r.stump_diameter_inches) < 12
                              ? "Under 12in — you've got this one."
                              : 'Your stump grinders are quoting this.'}
                          </div>
                        </div>
                      )}
                      <div>
                        <Label className="text-xs">Ground worker pay (each)</Label>
                        <Input
                          type="number" inputMode="decimal" className="h-9"
                          placeholder="Day rate per ground worker"
                          defaultValue={r.ground_pay_per_worker ?? ''}
                          onBlur={(e) => saveNumbers(r, {
                            ground_pay_per_worker: e.target.value === '' ? null : Number(e.target.value),
                          } as any)}
                        />
                        <div className="text-xs text-muted-foreground mt-1">
                          Shown to ground workers when the job is won.
                        </div>
                      </div>
                    </div>

                    {(dispatchData?.dispatches ?? []).filter((d) => d.bid_request_id === r.id).map((d) => {
                      const claims = (dispatchData?.responses ?? []).filter((x) => x.dispatch_id === d.id);
                      return (
                        <div key={d.id} className="rounded-md border p-3 space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Ground crew call-out
                          </div>
                          <div className="text-sm">
                            {claims.length} of {d.slots} spot{Number(d.slots) === 1 ? '' : 's'} claimed
                            {d.pay_per_worker != null && <> · {money(d.pay_per_worker)} each</>}
                            {d.scheduled_date && <> · {d.scheduled_date}</>}
                          </div>
                          {((d as any).offered_dates?.length ?? 0) > 0 ? (
                            <div className="space-y-1">
                              {((d as any).offered_dates as string[]).map((day) => {
                                const who = claims.filter((c) => ((c as any).available_dates ?? []).includes(day));
                                const won = (d as any).awarded_date === day;
                                return (
                                  <div key={day} className={`text-xs flex justify-between gap-2 ${won ? 'font-semibold text-primary' : ''}`}>
                                    <span>{day}: {who.length} of {d.slots}{won ? ' — filled' : ''}</span>
                                    <span className="text-muted-foreground truncate">{who.map((c) => crewName(c.crew_member_id)).join(', ')}</span>
                                  </div>
                                );
                              })}
                              {d.status === 'filled' && (
                                <div className="text-xs pt-1">
                                  Hired: {((d as any).hired_crew_member_ids ?? []).map((id: string) => crewName(id)).join(', ')}
                                  {' · '}Jobber: {(d as any).jobber_status === 'scheduled' ? 'scheduled' : ((d as any).jobber_error ?? 'not booked')}
                                </div>
                              )}
                              {d.status === 'filled' && (d as any).jobber_status !== 'scheduled' && (
                                <Button size="sm" variant="outline" onClick={async () => {
                                  const { data: res } = await supabase.functions.invoke('job-dispatch-availability', { body: { dispatch_id: d.id, action: 'schedule' } });
                                  if (res?.success) toast.success('Scheduled in Jobber'); else toast.error(res?.reason ?? res?.error ?? 'Jobber booking failed');
                                  qc.invalidateQueries({ queryKey: ['job-dispatches'] });
                                }}>Schedule in Jobber</Button>
                              )}
                            </div>
                          ) : claims.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {claims.map((c) => crewName(c.crew_member_id)).join(', ')}
                            </div>
                          )}
                          {claims.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {Array.from(new Set(claims.map((c) => c.crew_member_id))).map((id) => (
                                <JobChat
                                  key={id}
                                  bidRequestId={r.id}
                                  crewMemberId={id}
                                  side="office"
                                  otherName={crewName(id)}
                                  jobTitle={r.title}
                                  label={`Message ${crewName(id)}`}
                                />
                              ))}
                            </div>
                          )}
                          <DispatchActions dispatch={d} />
                        </div>
                      );
                    })}

                    <JobCostsPanel
                      value={(r.pricing_inputs ?? null) as StoredPricingInputs | null}
                      onSave={(next) => savePricing(r, next)}
                    />

                    <OfficeNotes
                      key={`notes-${r.id}`}
                      initial={(r as any).owner_notes ?? ''}
                      onSave={async (text) => {
                        const { error } = await supabase.from('bid_requests').update({ owner_notes: text.trim() || null } as any).eq('id', r.id);
                        if (error) return toast.error('Could not save notes');
                        toast.success('Notes saved');
                        qc.invalidateQueries({ queryKey: ['bid-requests'] });
                      }}
                    />

                    {(() => {
                      // Website jobs: the full range the customer was texted (Scout jobs show theirs above).
                      const l = !(r as any).capture_id && (r as any).lead_id ? leadEstimates?.[(r as any).lead_id] : null;
                      const range = l ? aiRangeText(l.estimated_cost_min, l.estimated_cost_max) : null;
                      const mid = l ? aiMidpoint(l.estimated_cost_min, l.estimated_cost_max) : null;
                      const jobPick = (r as any).quote_pick;
                      const picked = !!jobPick && !jobPick.bid_id && jobPick.option === 'ai';
                      return range ? (
                        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">AI estimate sent to the customer</div>
                            <div className="text-lg font-bold text-primary">{range}</div>
                          </div>
                          {mid != null && (
                            <Button type="button" size="sm" variant={picked ? 'default' : 'outline'} onClick={() => pickJobAi(r, mid)}>
                              {picked && <Check className="mr-1 h-4 w-4" />}
                              {picked ? `Picked: AI middle price ${money(mid)}` : `Pick AI middle price ${money(mid)}`}
                            </Button>
                          )}
                          {picked && <div className="text-xs text-muted-foreground">{jobPick.picked_by_name || 'The owner'} picked this to quote the customer. Tap again to clear it.</div>}
                        </div>
                      ) : null;
                    })()}

                    {list.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No offers in yet.</div>
                    ) : (
                      <div className="space-y-5">
                        {(['climber', 'ground', 'stump', 'crane'] as const).map((role) => {
                        const roleList = list.filter((b) => ((b as any).bid_role ?? 'climber') === role);
                        if (roleList.length === 0) return null;
                        // The other role's agreed pay is part of the cost of the job.
                        const otherAwardedId = role === 'climber' ? r.awarded_ground_bid_id : r.awarded_bid_id;
                        const otherPay = Number(
                          list.find((x) => x.id === otherAwardedId)?.ideal_pay ?? 0,
                        );
                        return (
                        <details key={role} className="group rounded-md border">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 [&::-webkit-details-marker]:hidden">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {role === 'climber' ? 'Climber offers' : role === 'ground' ? 'Ground crew offers' : role === 'crane' ? 'Crane prices' : 'Stump grinding prices'} ({roleList.length})
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              {roleList.some((b) => (b as any).id === r.awarded_bid_id || (b as any).id === r.awarded_ground_bid_id) ? 'Picked · ' : ''}
                              from ${Math.round(Math.min(...roleList.map((b) => Number(b.ideal_pay) || 0))).toLocaleString()}
                              <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
                            </span>
                          </summary>
                        <div className="space-y-3 px-3 pb-3">
                        {(() => {
                          const pickedIds = [r.awarded_bid_id, r.awarded_ground_bid_id, r.awarded_stump_bid_id].filter(Boolean);
                          const isPicked = (b: any) => pickedIds.includes(b.id) || b.status === 'won';
                          const hasPick = roleList.some(isPicked);
                          const sorted = roleList.slice().sort((a, b) => Number(a.ideal_pay) - Number(b.ideal_pay));
                          const main = hasPick ? sorted.filter(isPicked) : sorted;
                          const rest = hasPick ? sorted.filter((b) => !isPicked(b)) : [];
                          return [main, rest];
                        })().map((group, gi) => gi === 1 && group.length === 0 ? null : (
                          <details key={gi} open={gi === 0} className={gi === 1 ? 'group/rest rounded-md border border-dashed' : ''}>
                          {gi === 1 && (
                            <summary className="cursor-pointer list-none p-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                              Show {group.length} other offer{group.length === 1 ? '' : 's'} (not picked)
                            </summary>
                          )}
                          <div className={gi === 1 ? 'space-y-3 p-2' : 'space-y-3'}>
                        {group
                          .map((b, idx) => {
                            const storedIn = (r.pricing_inputs ?? {}) as StoredPricingInputs;
                            const eqLabels: string[] = [];
                            const pretty = (key: string) => (
                              { crane: 'Crane', chipper: 'Chipper', mini_skid: 'Mini skid', saws: 'Own saws', truck_trailer: 'Truck + trailer' }[key] ?? key.replace('_', ' ')
                            );
                            for (const key of ((r as any).equipment_needed ?? []) as string[]) {
                              const label = pretty(key);
                              if (!eqLabels.some((x) => x.toLowerCase().startsWith(label.toLowerCase()))) eqLabels.push(label);
                            }
                            if ((b as any).needs_mini_skid) {
                              const hrs = Number((b as any).mini_skid_hours ?? b.est_hours) || 0;
                              eqLabels.push(hrs > 0 ? `Mini skid ${hrs} hr` : 'Mini skid');
                            }
                            const priced = calculatePricing(
                              toPricingInput(
                                withBidExtras(storedIn, b as any),
                                {
                                crewMinimum: Number(b.min_pay),
                                crewIdeal: Number(b.ideal_pay),
                                committedCrewPay: otherPay,
                                legacyOwnerCost: Number(r.owner_cost) || 0,
                              }),
                            );
                            const rating = crewRating(b.crew_member_id);
                            const won = b.status === 'won';
                            return (
                              <div
                                key={b.id}
                                className={`rounded-lg border p-3 space-y-2 ${won ? 'border-primary bg-primary/5' : ''}`}
                              >
                                <div className="flex items-start justify-between gap-2 flex-wrap">
                                  <div>
                                    <div className="font-semibold flex items-center gap-2 flex-wrap">
                                      {crewName(b.crew_member_id)}
                                      {won && (
                                        <Badge className="text-[10px]">
                                          <Trophy className="w-3 h-3 mr-1" />Won
                                        </Badge>
                                      )}
                                      {b.status === 'lost' && (
                                        <Badge variant="outline" className="text-[10px]">Passed over</Badge>
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                                      <span className="flex items-center gap-1">
                                        <Star className="w-3.5 h-3.5 text-primary" />
                                        {rating != null ? Number(rating).toFixed(1) : 'no rating'}
                                      </span>
                                      <span>· {crewJobs(b.crew_member_id)} rated jobs</span>
                                    </div>
                                  </div>
                                  <div className="text-right text-sm">
                                    <div>min <strong>{money(b.min_pay)}</strong></div>
                                    <div>ideal <strong>{money(b.ideal_pay)}</strong></div>
                                    <Button size="sm" variant="outline" className="mt-1 h-7" onClick={() => setEditBid(b)}>
                                      <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                                    </Button>
                                  </div>
                                </div>

                                {role !== 'ground' && role !== 'stump' && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <span className="rounded-md border bg-muted/40 px-2.5 py-1">
                                      Ground crew needed: <strong className="text-base">{(b as any).ground_crew_size ?? 'not answered'}</strong>
                                    </span>
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground">
                                  {(b as any).people_count != null && (
                                    <>crew of {(b as any).people_count} · </>
                                  )}
                                  {b.est_hours != null && <>{b.est_hours} hrs · </>}
                                  {(b as any).rate_type && (
                                    <>{(b as any).rate_type === 'day' ? 'day rate' : 'hourly'} · </>
                                  )}
                                  {(b as any).est_disposal_loads != null && (
                                    <>{(b as any).est_disposal_loads} disposal load{(b as any).est_disposal_loads === 1 ? '' : 's'} · </>
                                  )}
                                  {(b as any).needs_mini_skid === true && (
                                    <>mini skid {(b as any).mini_skid_hours ?? b.est_hours ?? '?'} hr (+${(Number((b as any).mini_skid_hours ?? b.est_hours) || 0) * (Number(storedIn.miniSkidRate) || 100)}) · </>
                                  )}
                                  {(b as any).needs_mini_skid === false && <>no mini skid · </>}
                                  {b.equipment ? `Equipment they bring: ${b.equipment}` : 'no equipment listed'}
                                </div>
                                {b.notes && <div className="text-sm">{b.notes}</div>}
                                <JobChat
                                  bidRequestId={r.id}
                                  crewMemberId={b.crew_member_id}
                                  side="office"
                                  otherName={crewName(b.crew_member_id)}
                                  jobTitle={r.title}
                                />

                                {role === 'crane' ? (
                                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                                    Crane price <strong>{money(b.min_pay)}</strong>
                                    {Number(b.est_hours) > 0 && <span className="text-muted-foreground"> · {b.est_hours} hr on site</span>}
                                  </div>
                                ) : role === 'stump' ? (
                                  <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
                                    <div>
                                      Stump price <strong>{money(b.min_pay)}</strong>
                                      {r.stump_diameter_inches != null && (
                                        <span className="text-muted-foreground"> · about {r.stump_diameter_inches}" across</span>
                                      )}
                                    </div>
                                    {r.awarded_stump_bid_id === b.id ? (
                                      <Badge className="text-[10px]">In the homeowner quote</Badge>
                                    ) : (
                                      <Button size="sm" variant="outline" onClick={() => useStumpPrice(r, b)}>
                                        Use this price instead
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  <BidPriceCard
                                    result={priced}
                                    pick={(r as any).quote_pick && ((r as any).quote_pick.bid_id === b.id || !(r as any).quote_pick.bid_id) ? (r as any).quote_pick : null}
                                    onPick={(option, amount) => pickQuote(r, b, option, amount, priced)}
                                    equipmentNeeded={eqLabels.length ? eqLabels.join(', ') : null}
                                    groundLabel={(() => {
                                      const n = (b as any).ground_crew_size;
                                      if (n == null) return null;
                                      const hrs = Number(b.est_hours) || 0;
                                      return `${n} worker${Number(n) === 1 ? '' : 's'}${hrs ? ` × ${hrs} hr` : ''}`;
                                    })()}

                                    ownerLabel={ownerLabel}
                                    aiMin={(r as any).capture_id ? captures?.[(r as any).capture_id]?.ai_price_min ?? null
                                      : (r as any).lead_id ? leadEstimates?.[(r as any).lead_id]?.estimated_cost_min ?? null : null}
                                    aiMax={(r as any).capture_id ? captures?.[(r as any).capture_id]?.ai_price_max ?? null
                                      : (r as any).lead_id ? leadEstimates?.[(r as any).lead_id]?.estimated_cost_max ?? null : null}
                                    aiLabel={!(r as any).capture_id && (r as any).lead_id ? 'AI estimate' : undefined}
                                    crewShare={Number(((r as any).pricing_inputs ?? {}).crewShare) || undefined}
                                  />
                                )}

                                {role !== 'stump' && role !== 'crane' && (b.available_dates ?? []).includes('wants-site-visit') && (
                                  <div className="text-sm font-semibold text-primary">
                                    Wants to look at the tree in person first
                                  </div>
                                )}
                                {role !== 'stump' && role !== 'crane' && (b.available_dates ?? []).filter((d) => d !== 'wants-site-visit').length > 0 && (
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Available when they bid: </span>
                                    {b.available_dates.filter((d) => d !== 'wants-site-visit').map((d, i) => (
                                      <span key={d} className={isPassed(d) ? 'line-through text-muted-foreground' : 'font-medium'}>
                                        {i > 0 && ', '}{d}{isPassed(d) && ' (passed)'}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {role !== 'stump' && role !== 'crane' && (r.status === 'open' ||
                                  (role === 'ground' && r.status === 'awarded' && !r.awarded_ground_bid_id)) && (
                                  <Button
                                    size="sm"
                                    className="w-full"
                                    disabled={awarding === b.id}
                                    onClick={() => award(r, b, role)}
                                  >
                                    {awarding === b.id
                                      ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Awarding…</>
                                      : <><Trophy className="w-4 h-4 mr-1.5" />Award this crew</>}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                          </div>
                          </details>
                        ))}
                        </div>
                        </details>
                        );
                        })}
                       </div>
                     )}
                   </div>
                 )}

              </Card>
            );
          })}
        </div>
      )}

      <RequestCrewBidsDialog seed={{}} open={newOpen} onOpenChange={setNewOpen} />
      <RateJobDialog bidRequestId={rateId} open={!!rateId} onOpenChange={(o) => !o && setRateId(null)} />
      <EditBidDialog
        bid={editBid}
        crewName={editBid ? crewName(editBid.crew_member_id) : ''}
        open={editBid !== null}
        onOpenChange={(o) => { if (!o) setEditBid(null); }}
      />
      <EditJobInfoDialog job={editJob} open={!!editJob} onOpenChange={(o) => { if (!o) setEditJob(null); }} />
      <VisitTextDialog job={visitJob} hasAiPrice={visitJob ? hasAiPrice(visitJob) : false} open={!!visitJob} onOpenChange={(o) => { if (!o) setVisitJob(null); }} />
      <PhotoZoomDialog
        src={zoomPhoto?.src ?? null}
        alt={zoomPhoto?.alt ?? 'Job photo'}
        open={zoomPhoto !== null}
        onOpenChange={(open) => { if (!open) setZoomPhoto(null); }}
      />
    </div>
  );
}

function WorkflowNote({ initial, onSave }: { initial: string; onSave: (text: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  if (!editing) {
    return (
      <div className="text-xs text-foreground mt-1 italic flex items-center gap-2">
        <span>{initial ? `Note: ${initial}` : <span className="text-muted-foreground">No note yet</span>}</span>
        <button
          type="button"
          className="not-italic text-primary underline underline-offset-2"
          onClick={() => { setText(initial); setEditing(true); }}
        >
          {initial ? 'Edit' : 'Add note'}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-1.5">
      <textarea
        className="w-full min-h-[50px] rounded-md border border-input bg-background px-2 py-1.5 text-xs not-italic"
        placeholder="Note for this job…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={async () => {
          setSaving(true);
          await onSave(text);
          setSaving(false);
          setEditing(false);
        }}>
          {saving ? 'Saving…' : 'Save note'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function OfficeNotes({ initial, onSave }: { initial: string; onSave: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = text !== initial;
  return (
    <div className="space-y-1.5 rounded-md border border-border p-3">
      <Label className="text-sm font-semibold">Owner Notes</Label>
      <textarea
        className="w-full min-h-[70px] rounded-md border border-input bg-background px-3 py-2 text-sm"
        placeholder="Anything LesLee should know before sending the quote…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {dirty && (
        <Button size="sm" disabled={saving} onClick={async () => { setSaving(true); await onSave(text); setSaving(false); }}>
          {saving ? 'Saving…' : 'Save notes'}
        </Button>
      )}
    </div>
  );
}
