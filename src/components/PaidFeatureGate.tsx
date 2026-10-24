import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useMyCrewMarket, useMyCrewMemberships } from '@/hooks/useCrew';
import { functionFailure } from '@/lib/functionFailure';
import { toast } from 'sonner';
import { canUseStorePlans, isNativeStoreBilling } from '@/lib/platform';
import { useCompanyBilling } from '@/hooks/useCompanyBilling';
import { useCompanyPermission } from '@/hooks/useCompanyPermission';
import { useFreePlan } from '@/hooks/useFreePlan';
import { BusinessLocationForm } from '@/components/free/BusinessLocationForm';
import { usePlansOpen } from '@/hooks/useBillingRollout';
import { PlanPrompt } from '@/components/billing/PlanPrompt';
import { StorePlanPrompt } from '@/components/billing/StorePlanPrompt';

/** Founder company (Timber Edmond) — exempt from Bid Board / sub-network billing. */
export const BILLING_EXEMPT_OWNER_IDS = ['705cecc2-5926-48c1-a728-b3ebd6b920a2'];

/** What iPhone shows instead of a paywall: no price, no button, no link to an outside checkout. */
function NotActive({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-lg mx-auto py-10">
      <Card>
        <CardContent className="p-6 space-y-3 text-center">
          <Lock className="w-8 h-8 mx-auto text-primary" />
          <h2 className="text-xl font-black">{title}</h2>
          <p className="text-muted-foreground">{body}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Paywall({ title, body, price, note, fn, trialUsed = false }: { title: string; body: string; price: string; note?: string; fn: string; trialUsed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke(fn);
    const failure = await functionFailure(error, data);
    if (!failure && data?.free) {
      // Nothing to pay where they work (the price changed since this screen loaded).
      window.location.reload();
      return;
    }
    if (failure || !data?.url) {
      toast.error(failure?.message || 'Could not start checkout');
      setBusy(false);
      return;
    }
    window.location.href = data.url;
  };
  return (
    <div className="max-w-lg mx-auto py-10">
      <Card>
        <CardContent className="p-6 space-y-4 text-center">
          <Lock className="w-8 h-8 mx-auto text-primary" />
          <h2 className="text-xl font-black">{title}</h2>
          <p>{body}</p>
          <p className="font-bold">{price}</p>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
          <Button onClick={start} disabled={busy} className="w-full">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {trialUsed ? 'Subscribe' : 'Start 14-day free trial'}
          </Button>
          <p className="text-xs text-muted-foreground">{trialUsed ? 'Your company has already had its free trial. Cancel anytime.' : "Card required. Cancel anytime before the trial ends and you won't be charged."}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Back from Stripe (?membership=active) before stripe-webhook has written the membership: wait for it instead of
 * showing the paywall again. Checks every 2 seconds for a minute.
 */
function ActivatingMembership() {
  const qc = useQueryClient();
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (waited >= 60) return;
    const t = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ['product-entitlements'] });
      setWaited((w) => w + 2);
    }, 2000);
    return () => clearTimeout(t);
  }, [waited, qc]);
  return (
    <div className="max-w-lg mx-auto py-10">
      <Card>
        <CardContent className="p-6 space-y-3 text-center">
          <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin" />
          <h2 className="text-xl font-black">Starting your membership</h2>
          <p className="text-muted-foreground">
            {waited >= 60
              ? "This is taking longer than usual. Refresh this page in a minute. You won't be charged twice."
              : 'This takes a few seconds.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Where a locked owner who never said where the business is can say so (it may open Free for Oklahoma). */
function LocationFirst({ children }: { children: ReactNode }) {
  const free = useFreePlan();
  const s = free.data;
  if (!s || s.plan !== 'locked' || !s.is_owner || s.location_set) return <>{children}</>;
  return (
    <div className="max-w-lg mx-auto pt-10 px-4 space-y-4">
      <Card><CardContent className="p-6"><BusinessLocationForm title="Confirm your business location" /></CardContent></Card>
      {children}
    </div>
  );
}

/**
 * Owners: Bid Board & My Subs require Scout. With allowFree, Oklahoma owners on the Free plan get in too
 * (the server enforces their monthly job limit).
 */
export function ScoutRequiredGate({ children, allowFree = false }: { children: ReactNode; allowFree?: boolean }) {
  const { effectiveContractorId, isAdmin, isTeamMember } = useAuth();
  // Once the company plans are open on the website, a locked owner goes to the plan picker (payments milestone).
  const plansOpen = usePlansOpen();
  const { hasProduct, isLoading } = useEntitlements();
  const companyBilling = useCompanyBilling();
  const companyPermission = useCompanyPermission('manageJobsSubs');
  const free = useFreePlan();
  if (companyBilling.isLoading) return null;
  if (allowFree) {
    if (free.isLoading) return null;
    if (free.data?.plan === 'free') return <>{children}</>;
  }
  if (companyBilling.data?.billing?.pricing_version === '2026-10') {
    if (companyPermission.isLoading) return null;
    if (companyPermission.data) return <>{children}</>;
    // The phone apps sell the plans through the App Store or Google Play (payments milestone, Part B).
    if (canUseStorePlans() && !isTeamMember) return <LocationFirst><StorePlanPrompt title="Your TreeCheck plan isn't active" body="Choose a plan to get Jobs, Subs and Scout back. Your jobs and settings are kept." /></LocationFirst>;
    if (plansOpen && !isTeamMember) return <LocationFirst><PlanPrompt title="Your TreeCheck plan isn't active" body="Choose a plan to get Jobs, Subs and Scout back. Your jobs and settings are kept." /></LocationFirst>;
    return <LocationFirst><div className="p-6 text-muted-foreground">Company Jobs and Subs access is not active.</div></LocationFirst>;
  }
  if (isAdmin || (effectiveContractorId && BILLING_EXEMPT_OWNER_IDS.includes(effectiveContractorId))) return <>{children}</>;
  if (isLoading) return null;
  if (hasProduct('scout')) return <>{children}</>;
  // Phone apps: no Stripe price, button or link to an outside checkout (Apple 3.1.1 / 3.1.3(b), Google Play's payments
  // policy). An owner gets the phone plan screen where the apps sell the plans.
  if (isNativeStoreBilling()) {
    return (
      <LocationFirst>
        {canUseStorePlans() && !isTeamMember
          ? <StorePlanPrompt title="The Bid Board is part of TreeCheck's plans" body="Get bids from subcontract climbers, ground crews and stump grinders, send quotes, and fill your schedule." />
          : <NotActive title="Scout isn't active on this account" body="The Bid Board and your subs are part of Scout." />}
      </LocationFirst>
    );
  }
  if (plansOpen && !isTeamMember) return <LocationFirst><PlanPrompt title="The Bid Board is part of TreeCheck's plans" body="Get bids from subcontract climbers, ground crews and stump grinders, send quotes, and fill your schedule." /></LocationFirst>;
  return (
    <LocationFirst>
      <Paywall
        fn="create-scout-checkout"
        title="The Bid Board is part of Scout"
        body="Get bids from subcontract climbers, ground crews and stump grinders, send quotes, and fill your schedule. It's all included with Scout."
        price="$50/month + $35/month per extra team member"
        trialUsed={free.data?.trial_used === true}
      />
    </LocationFirst>
  );
}

/**
 * Subcontractors: a local membership ($10, $25 or $35 a month by how many tree companies are within 30 miles,
 * free where none are), unless they work for an exempt company. Someone still waiting for a company's approval
 * sees that, not a paywall.
 */
export function CrewMembershipGate({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const { activeProducts, isLoading } = useEntitlements();
  const memberships = useMyCrewMemberships();
  const rows = memberships.data ?? [];
  const exempt = rows.some((m) => m.status === 'active' && BILLING_EXEMPT_OWNER_IDS.includes(m.owner_contractor_id));
  const covered = isAdmin || exempt || activeProducts.has('crew_membership');
  const ready = !isLoading && !memberships.isLoading;
  const market = useMyCrewMarket(ready && !covered);
  if (isAdmin) return <>{children}</>;
  // The marketing sample shows only fictional jobs, so any signed-in owner can open it.
  if (new URLSearchParams(window.location.search).get('sample') === '1') return <>{children}</>;
  if (!ready) return null;
  if (covered) return <>{children}</>;
  if (new URLSearchParams(window.location.search).get('membership') === 'active') return <ActivatingMembership />;
  if (market.isLoading) return null;
  const waiting = !rows.some((m) => m.status === 'active') && rows.some((m) => m.status === 'pending') && !market.data?.network;
  if (waiting) {
    return (
      <div className="max-w-lg mx-auto py-10">
        <Card>
          <CardContent className="p-6 space-y-3 text-center">
            <Clock className="w-8 h-8 mx-auto text-primary" />
            <h2 className="text-xl font-black">Waiting for the company to approve you</h2>
            <p className="text-muted-foreground">
              You asked to join a tree company's crew. As soon as they approve you, you can see their jobs, send your
              bids and pick your days here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  // Free where no company participates, and for everyone while Stripe can't take real cards (test mode).
  if (market.data?.monthly_price === 0 || market.data?.billing === 'test') return <>{children}</>;
  // Phone apps: no prices, buttons or links to outside checkout (Apple 3.1.1 / 3.1.3(b), Google Play's payments policy).
  if (isNativeStoreBilling()) return <NotActive title="Your membership isn't active" body="Contact the company that invited you." />;
  const local = market.data;
  return (
    <Paywall
      fn="create-crew-checkout"
      title="Start getting job offers"
      body="Get alerts for new tree jobs, send your bids, and pick your dates, all from your phone."
      price={local ? `$${local.monthly_price}/month after 14 days free` : '14 days free, then your local monthly price'}
      note={local
        ? `Based on ${local.company_count} participating tree ${local.company_count === 1 ? 'company' : 'companies'} within 30 miles${local.location_label ? ` of ${local.location_label}` : ''}.`
        : undefined}
    />
  );
}
