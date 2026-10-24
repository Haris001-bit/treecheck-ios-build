import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export interface CrewMember {
  id: string;
  owner_contractor_id: string;
  user_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  trade: string;
  hourly_rate?: number | null;
  certifications: string | null;
  equipment: string | null;
  status: string;
  rating_avg: number | null;
  rating_count?: number | null;
  jobs_completed: number;
  notes: string | null;
  created_at: string;
  insured?: string | null;
  wants_ground_work?: boolean;
  can_skid_steer?: boolean;
  mini_skid_experience?: boolean;
  can_chipper?: boolean;
  crane_certified?: boolean;
  truck_trailer_experience?: boolean;
  disposal_runs_ok?: boolean;
  owns_saws?: boolean;
  has_drivers_license?: boolean;
  tree_experience_level?: string | null;
  years_climbing?: number | null;
  first_refusal?: boolean;
  worked_together_before?: boolean;
}

export interface JobDispatch {
  id: string;
  bid_request_id: string;
  owner_contractor_id: string;
  role: string;
  slots: number;
  pay_per_worker: number | null;
  pay_rate_type: string;
  scheduled_date: string | null;
  address: string | null;
  status: string;
  first_refusal_until: string | null;
  released_at: string | null;
  created_at: string;
  bid_requests?: { title: string | null; city: string | null } | null;
}

export interface JobDispatchResponse {
  id: string;
  dispatch_id: string;
  crew_member_id: string;
  response: string;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface CrewAvailability {
  id: string;
  crew_member_id: string;
  weekly_days: number[];
  taking_work: boolean;
  unavailable_dates: string[];
  available_dates: string[];
  notes: string | null;
  updated_at: string;
}

export interface BidRequest {
  id: string;
  owner_contractor_id: string;
  capture_id: string | null;
  title: string;
  workflow_status?: string | null;
  workflow_notes?: string | null;
  description: string | null;
  city: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  photo_path: string | null;
  photo_paths?: string[] | null;
  trees?: { label: string; note?: string | null; photo_indexes: number[] }[] | null;
  status: string;
  deadline_at: string | null;
  offered_dates: string[];
  target_margin_pct: number;
  owner_cost: number;
  pricing_inputs?: Record<string, unknown> | null;
  awarded_bid_id: string | null;
  awarded_date: string | null;
  lead_id?: string | null;
  jobber_quote_id?: string | null;
  jobber_quote_number?: string | null;
  quote_status?: string | null;
  hired_at?: string | null;
  role_needed?: string;
  awarded_ground_bid_id?: string | null;
  awarded_ground_date?: string | null;
  needs_stump_grinding?: boolean;
  stump_diameter_inches?: number | null;
  ground_pay_per_worker?: number | null;
  awarded_stump_bid_id?: string | null;
  first_refusal_until?: string | null;
  first_refusal_released_at?: string | null;
  created_at: string;
}

export interface Bid {
  id: string;
  bid_request_id: string;
  crew_member_id: string;
  min_pay: number;
  ideal_pay: number;
  crew_size: number | null;
  equipment: string | null;
  est_hours: number | null;
  est_disposal_loads?: number | null;
  ground_crew_size?: number | null;
  needs_mini_skid?: boolean | null;
  mini_skid_hours?: number | null;
  available_dates: string[];
  notes: string | null;
  status: string;
  bid_role?: string;
  rate_type?: string | null;
  people_count?: number | null;
  created_at: string;
}

/** Availability rows for the crew I own (owner view), keyed by crew member id. */
export function useCrewAvailabilityMap(crewIds: string[]) {
  return useQuery({
    queryKey: ['crew-availability', crewIds.join(',')],
    enabled: crewIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crew_availability')
        .select('*')
        .in('crew_member_id', crewIds);
      if (error) throw error;
      const map: Record<string, CrewAvailability> = {};
      for (const row of (data ?? []) as unknown as CrewAvailability[]) map[row.crew_member_id] = row;
      return map;
    },
  });
}

/** My own availability row (crew view). */
export function useMyAvailability(crewIds: string[]) {
  return useQuery({
    queryKey: ['my-availability', crewIds.join(',')],
    enabled: crewIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crew_availability')
        .select('*')
        .in('crew_member_id', crewIds)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data ?? [])[0] ?? null) as unknown as CrewAvailability | null;
    },
  });
}

/** The crew network I own (as the account owner). */
export function useCompletedCrewWork() {
  const { effectiveContractorId } = useAuth();
  return useQuery({
    queryKey: ['completed-crew-work', effectiveContractorId],
    enabled: !!effectiveContractorId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('completed_crew_work');
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.crew_member_id));
    },
  });
}

export function useCrewNetwork() {
  const { effectiveContractorId } = useAuth();
  return useQuery({
    queryKey: ['crew-network', effectiveContractorId],
    enabled: !!effectiveContractorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crew_members')
        .select('*')
        .eq('owner_contractor_id', effectiveContractorId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CrewMember[];
    },
  });
}

/** Crew networks I belong to (as a contract climber). */
export function useMyCrewMemberships() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-crew-memberships', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crew_members')
        .select('*')
        .eq('user_id', user!.id);
      if (error) throw error;
      return (data ?? []) as unknown as CrewMember[];
    },
  });
}

export interface MyCrewMarket {
  company_count: number;
  /** 0 where no tree company participates nearby: membership is free. */
  monthly_price: number;
  location_label: string | null;
  /** Joined the open network, not only a company's crew. */
  network: boolean;
  /** "test" while Stripe can't take real cards: nobody is charged yet. */
  billing?: 'live' | 'test';
}

/** My local membership price, worked out on the server (crew-market-quote). */
export function useMyCrewMarket(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-crew-market', user?.id],
    enabled: enabled && !!user?.id,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('crew-market-quote', { body: { mine: true } });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not check your local price');
      return data as MyCrewMarket;
    },
  });
}

/** True when this account exists only to bid on other people's jobs. */
export function useIsCrewOnly() {
  const memberships = useMyCrewMemberships();
  const network = useCrewNetwork();
  const { user, isTeamMember } = useAuth();
  const profile = useQuery({
    queryKey: ['crew-account-type', user?.id], enabled: !!user?.id,
    queryFn: async () => (await supabase.from('profiles').select('account_type').eq('id', user?.id ?? '').maybeSingle()).data,
  });
  const loading = memberships.isLoading || network.isLoading || profile.isLoading;
  const isCrew = (memberships.data?.length ?? 0) > 0;
  const ownsNetwork = (network.data?.length ?? 0) > 0;
  const crewAccount = profile.data?.account_type === 'subcontractor';
  return { loading, isCrew: isCrew || crewAccount, isCrewOnly: !loading && (crewAccount || (!isTeamMember && isCrew && !ownsNetwork)) };
}

/** Bid requests I created (owner view). */
export function useBidRequests() {
  const { effectiveContractorId } = useAuth();
  return useQuery({
    queryKey: ['bid-requests', effectiveContractorId],
    enabled: !!effectiveContractorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bid_requests')
        .select('*')
        .eq('owner_contractor_id', effectiveContractorId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BidRequest[];
    },
  });
}

/** Bids on my own requests (sealed from other crew, visible to me). */
export function useBidsForRequests(requestIds: string[]) {
  return useQuery({
    queryKey: ['bids', requestIds.join(',')],
    enabled: requestIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bids')
        .select('*')
        .in('bid_request_id', requestIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Bid[];
    },
  });
}

/** Bid requests sent to me, plus my own offers (crew view). */
export function useCrewInbox() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['crew-inbox', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: requests, error: rErr }, { data: bids, error: bErr }] = await Promise.all([
        supabase.from('bid_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('bids').select('*'),
      ]);
      if (rErr) throw rErr;
      if (bErr) throw bErr;
      return {
        requests: (requests ?? []) as unknown as BidRequest[],
        myBids: (bids ?? []) as unknown as Bid[],
      };
    },
  });
}

/** Ground-crew call-outs on my jobs (owner) or sent to me (crew). */
export function useJobDispatches() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['job-dispatches', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [{ data: dispatches, error: dErr }, { data: responses, error: rErr }] = await Promise.all([
        supabase.from('job_dispatches').select('*, bid_requests(title, city)').order('created_at', { ascending: false }),
        supabase.from('job_dispatch_responses').select('*'),
      ]);
      if (dErr) throw dErr;
      if (rErr) throw rErr;
      return {
        dispatches: (dispatches ?? []) as unknown as JobDispatch[],
        responses: (responses ?? []) as unknown as JobDispatchResponse[],
      };
    },
  });
}

export type BidTree = { label: string; note?: string | null; photo_indexes: number[] };
export type BidPhotoSet = { cover: string | null; thumb: string | null; urls: (string | null)[]; trees: BidTree[] | null };

const photoSetCache = new Map<string, BidPhotoSet>();
let inflightBatch: Promise<unknown> | null = null;
export function getCachedBidPhotoSet(id: string): BidPhotoSet | undefined { return photoSetCache.get(id); }

async function photoSessionToken(): Promise<string | null> {
  let { data: { session } } = await supabase.auth.getSession();
  if (session && session.expires_at && session.expires_at * 1000 < Date.now() + 30_000) {
    session = (await supabase.auth.refreshSession()).data.session;
  }
  return session?.access_token ?? null;
}

export async function fetchBidPhotoSet(bidRequestId: string): Promise<BidPhotoSet> {
  const empty: BidPhotoSet = { cover: null, thumb: null, urls: [], trees: null };
  try {
    // A batch prefetch may already be fetching this photo — wait for it first.
    if (!photoSetCache.has(bidRequestId) && inflightBatch) {
      await inflightBatch.catch(() => {});
      const hit = photoSetCache.get(bidRequestId);
      if (hit) return hit;
    }
    const token = await photoSessionToken();
    if (!token) return empty;
    const { data, error } = await supabase.functions.invoke('bid-photo-url', {
      body: { bid_request_id: bidRequestId },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error || data?.error) return empty;
    const set: BidPhotoSet = {
      cover: (data?.url as string) ?? null,
      thumb: (data?.thumb as string) ?? (data?.url as string) ?? null,
      urls: Array.isArray(data?.urls) ? data.urls : [],
      trees: Array.isArray(data?.trees) ? data.trees : null,
    };
    photoSetCache.set(bidRequestId, set);
    return set;
  } catch {
    return empty;
  }
}

/** One call that warms the photo cache for many jobs at once (cover + small thumbnail). */
export async function prefetchBidPhotos(bidRequestIds: string[]): Promise<Record<string, BidPhotoSet>> {
  const missing = bidRequestIds.filter((id) => !photoSetCache.has(id)).slice(0, 60);
  if (missing.length === 0) return {};
  const run = (async () => {
  try {
    const token = await photoSessionToken();
    if (!token) return {};
    const { data, error } = await supabase.functions.invoke('bid-photo-url', {
      body: { bid_request_ids: missing },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error || data?.error || !data?.results) return {};
    const out: Record<string, BidPhotoSet> = {};
    for (const [id, r] of Object.entries(data.results as Record<string, { url: string | null; thumb: string | null }>)) {
      const set: BidPhotoSet = { cover: r.url ?? null, thumb: r.thumb ?? r.url ?? null, urls: [], trees: null };
      photoSetCache.set(id, set);
      out[id] = set;
    }
    return out;
  } catch {
    return {};
  }
  })();
  inflightBatch = run;
  try {
    return await run;
  } finally {
    if (inflightBatch === run) inflightBatch = null;
  }
}

export async function fetchBidPhotoUrl(bidRequestId: string): Promise<string | null> {
  return (await fetchBidPhotoSet(bidRequestId)).cover;
}
