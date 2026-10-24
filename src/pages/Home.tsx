import { useEffect } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { ArrowDownRight, ArrowUpRight, ArrowRight, Minus, Camera, Loader2 } from 'lucide-react';
import { HomeAdvertisementSample } from '@/components/home/HomeAdvertisementSample';
import type { ReactNode } from 'react';
import { PulseHomeCard } from '@/components/pulse/home/PulseHomeCard';
import { PulseWelcomeSummary } from '@/components/pulse/home/PulseWelcomeSummary';
import { BusinessSummary } from '@/components/home/BusinessSummary';
import { useIsCrewOnly } from '@/hooks/useCrew';
import { isRecentJob } from '@/hooks/useJobViews';
import { useFreePlan } from '@/hooks/useFreePlan';
import { BusinessLocationForm } from '@/components/free/BusinessLocationForm';

export const HOME_SEEN_KEY = 'home-seen-session';

const CLOSED = new Set(['job_complete', 'quote_declined', 'no_longer_needed', 'unresponsive']);

function Trend({ now, prev, suffix = '' }: { now: number; prev: number; suffix?: string }) {
  const diff = now - prev;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${diff > 0 ? 'text-primary' : diff < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
      <Icon className="h-4 w-4" />
      {diff === 0 ? 'Same as last month' : `${diff > 0 ? '+' : ''}${diff}${suffix} vs last month`}
    </span>
  );
}

function HomeSection({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <section aria-label={title} className={`min-w-0 ${className}`}>
    <h2 className="mb-2 text-sm font-normal text-muted-foreground">{title}</h2>
    {children}
  </section>;
}

function SummaryState({ loading, error }: { loading: boolean; error: boolean }) {
  return <div className="min-h-12 flex items-center" role="status">
    <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : error ? 'Summary unavailable. Please try again later.' : ''}</p>
  </div>;
}

function NewJobsCard({ uid }: { uid: string }) {
  const { data: count, isLoading, isError } = useQuery({
    queryKey: ['home-new-jobs', uid],
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86400_000).toISOString();
      const [jobs, views] = await Promise.all([
        supabase.from('bid_requests').select('id, created_at, workflow_status').gte('created_at', since),
        (supabase.from as any)('job_views').select('bid_request_id').eq('user_id', uid),
      ]);
      if (jobs.error) throw jobs.error;
      if (views.error) throw views.error;
      const seen = new Set((views.data ?? []).map((v: any) => v.bid_request_id));
      return (jobs.data ?? []).filter((j: any) => isRecentJob(j.created_at) && !CLOSED.has(j.workflow_status ?? 'open') && !seen.has(j.id)).length;
    },
  });
  return <HomeSection title="New jobs" className="home-new py-4 md:pl-6">
    <div className="flex flex-col justify-between gap-3">
      {isLoading || isError ? <SummaryState loading={isLoading} error={isError} /> : <>
        <div>
          <p className="home-number text-4xl sm:text-5xl font-black tabular-nums">{count ?? 0}</p>
          <p className="mt-1 text-sm text-muted-foreground">{count ? `Job${count === 1 ? '' : 's'} you haven't opened yet` : "You're all caught up."}</p>
        </div>
        <Button asChild className="self-start"><Link to={count ? '/dashboard/bid-board?new=1' : '/dashboard/bid-board'}>{count ? 'Open new jobs' : 'Go to Jobs'}<ArrowRight /></Link></Button>
      </>}
    </div>
  </HomeSection>;
}

function ScoutAccuracyCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['home-scout-accuracy'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('home_scout_accuracy');
      if (error) throw error;
      return (data ?? []) as { month: string; jobs: number; avg_error: number }[];
    },
  });
  const rows = data ?? [];
  const jobs = rows.reduce((s, r) => s + r.jobs, 0);
  const acc = (list: typeof rows) => {
    const n = list.reduce((s, r) => s + r.jobs, 0);
    if (!n) return null;
    const err = list.reduce((s, r) => s + Number(r.avg_error) * r.jobs, 0) / n;
    return Math.max(0, Math.round(100 - err * 100));
  };
  const d = new Date();
  const ym = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const thisKey = ym(d.getFullYear(), d.getMonth());
  const lastD = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const lastKey = ym(lastD.getFullYear(), lastD.getMonth());
  const thisAcc = acc(rows.filter((r) => r.month.startsWith(thisKey)));
  const lastAcc = acc(rows.filter((r) => r.month.startsWith(lastKey)));
  return <HomeSection title="Scout™ accuracy" className="py-4 pr-3 md:pr-6">
    <div className="space-y-2">
      {isLoading || isError ? <SummaryState loading={isLoading} error={isError} /> : jobs < 5 ? <>
        <p className="text-lg font-light">Scout is learning</p>
        <p className="text-sm text-muted-foreground">{jobs} job{jobs === 1 ? '' : 's'} compared so far.</p>
      </> : <>
        <p className="home-number text-3xl font-black tabular-nums">{acc(rows)}<span className="ml-1 text-lg font-light text-muted-foreground">%</span></p>
        <p className="text-sm text-muted-foreground">AI price vs sold price · {jobs} jobs</p>
        {thisAcc != null && lastAcc != null && <Trend now={thisAcc} prev={lastAcc} suffix=" pts" />}
      </>}
    </div>
  </HomeSection>;
}

function BookedSoldCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['home-booked-sold'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bid_requests')
        .select('id, workflow_status, quote_pick, completed_at');
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const SOLD = new Set(['quote_accepted', 'job_scheduled', 'job_complete']);
      let sold = 0, soldCount = 0, booked = 0, bookedCount = 0;
      for (const r of rows) {
        const amt = Number(r.quote_pick?.amount ?? 0);
        if (!amt || !SOLD.has(r.workflow_status ?? '')) continue;
        const pickedAt = r.quote_pick?.picked_at ? new Date(r.quote_pick.picked_at) : null;
        if (!pickedAt || pickedAt < monthStart) continue;
        sold += amt; soldCount++;
        if (r.workflow_status !== 'job_complete' && !r.completed_at) { booked += amt; bookedCount++; }
      }
      return { sold, soldCount, booked, bookedCount };
    },
  });
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return <HomeSection title="Booked vs sold · month to date" className="home-booked py-4">
    <div className="home-booked-content">
      {isLoading || isError ? <SummaryState loading={isLoading} error={isError} /> : !data || (!data.soldCount && !data.bookedCount) ? <>
        <p className="home-number text-4xl sm:text-5xl font-black tabular-nums">$0</p>
        <p className="mt-1 text-sm text-muted-foreground">Booked work</p>
        <p className="mt-2 text-sm text-muted-foreground">Quotes accepted this month will appear here.</p>
        <Button asChild variant="link" className="mt-1 h-auto px-0"><Link to="/dashboard/bid-board">Open Jobs<ArrowRight /></Link></Button>
      </> : <>
        <p className="home-number text-4xl sm:text-5xl font-black tabular-nums text-primary">{money(data.booked)}</p>
        <p className="mt-1 text-sm text-muted-foreground">Booked · {data.bookedCount} job{data.bookedCount === 1 ? '' : 's'} still to do</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs text-muted-foreground">Sold</p>
            <p className="mt-1 text-lg font-light tabular-nums">{money(data.sold)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{data.soldCount} job{data.soldCount === 1 ? '' : 's'} accepted this month</p>
          </div>
          <Button asChild variant="link" className="h-auto px-0"><Link to="/dashboard/bid-board">Open Jobs<ArrowRight /></Link></Button>
        </div>
      </>}
    </div>
  </HomeSection>;
}

function DmaCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['home-dma-counts'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('home_dma_counts');
      if (error) throw error;
      return (data?.[0] ?? { this_month: 0, last_month: 0, total: 0 }) as { this_month: number; last_month: number; total: number };
    },
  });
  return <HomeSection title="Marketing posts" className="py-4 pl-3 md:pl-6">
    <div className="space-y-2">
      {isLoading || isError ? <SummaryState loading={isLoading} error={isError} /> : !data?.total ? <>
        <p className="text-lg font-light">Your next job.<br />Your next post.</p>
        <Button asChild variant="link" className="h-auto px-0"><Link to="/dashboard/dma">Start posting<ArrowRight /></Link></Button>
      </> : <>
        <p className="home-number text-3xl font-black tabular-nums">{data.this_month}<span className="ml-2 text-xs font-normal text-muted-foreground">this month</span></p>
        <Trend now={data.this_month} prev={data.last_month} />
        <div className="flex flex-wrap items-center justify-between gap-1">
          <p className="text-sm text-muted-foreground">{data.total} posts total</p>
          <Button asChild variant="link" className="h-auto px-0"><Link to="/dashboard/dma">New post<ArrowRight /></Link></Button>
        </div>
      </>}
    </div>
  </HomeSection>;
}

/** Asked once of company owners who haven't said where the business is based (decides Free-plan eligibility). */
function AskBusinessLocation() {
  const free = useFreePlan();
  const s = free.data;
  if (!s || s.plan === 'none' || !s.is_owner || s.location_set) return null;
  return <section className="border-b border-border py-4"><BusinessLocationForm /></section>;
}

export default function Home() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { isCrewOnly, loading } = useIsCrewOnly();
  useEffect(() => {
    if (loading || isCrewOnly || !user) return;
    try { sessionStorage.setItem(HOME_SEEN_KEY, '1'); } catch { /* ignore */ }
  }, [loading, isCrewOnly, user]);
  if (loading) return <div className="flex justify-center p-8" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (isCrewOnly) return <Navigate to="/dashboard/crew-bids" replace />;
  if (!user) return null;
  if (searchParams.get('sample') === '1') return <HomeAdvertisementSample />;
  const today = new Date();
  return (
    <div className="home-workspace min-h-[calc(100svh-4rem)] bg-background text-foreground font-normal">
      <div className="mx-auto max-w-5xl px-5 sm:px-9 lg:px-12 pb-4">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-4 pt-4 sm:pt-6">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-normal text-primary">TREECHECK</p>
            <h1 className="text-2xl font-light">Welcome back.</h1>
            <PulseWelcomeSummary otherwise={<BusinessSummary uid={user.id} />} />
          </div>
          <div className="flex items-center gap-1">
            <time dateTime={today.toISOString()} className="pb-1 text-sm text-muted-foreground">{today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</time>
            <Button asChild variant="ghost" size="icon" title="Advertisement sample"><Link to="?sample=1" aria-label="Advertisement sample"><Camera className="h-4 w-4" /></Link></Button>
          </div>
        </header>
        <AskBusinessLocation />
        <div className="grid divide-y divide-border">
          <BookedSoldCard />
          <NewJobsCard uid={user.id} />
        </div>
        <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
          <ScoutAccuracyCard />
          <DmaCard />
        </div>
        <PulseHomeCard />
      </div>
    </div>
  );
}
