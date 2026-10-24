// The plan picker (payments milestone, 2026-10-21): where an owner chooses a company plan and pays on the website, or
// manages the one they have. Reached from the trial banner, the locked screens, the reminders and Profile. Website
// only: the phone apps sell through the App Store and Google Play.
import { useEffect, useState } from 'react';
import { Navigate, Link, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CompanyCatalog } from '@/components/CompanyCatalog';
import { planPrice, type PlanChoice } from '@/lib/pricing/planChoice';
import { useAuth } from '@/lib/auth';
import { canUseStorePlans, isAppStoreSafeMode } from '@/lib/platform';
import { formatCents } from '@/lib/pricing/catalog';
import { useCompanyBilling } from '@/hooks/useCompanyBilling';
import { useBillingRollout, plansOpenOnWeb } from '@/hooks/useBillingRollout';
import { openCompanyPortal, startCompanyCheckout } from '@/lib/billing/companyCheckout';
import { planIsRunning } from '@/lib/billing/storePlanState';

// The company billing row as company-billing's status action returns it.
type BillingRow = {
  pricing_version?: string; provider?: string; status?: string; billing_interval?: string; stripe_subscription_id?: string | null;
  trial_ends_at?: string | null; current_period_end?: string | null; capacity?: { ownerScout?: boolean };
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function Plans() {
  const { isTeamMember } = useAuth();
  const rollout = useBillingRollout();
  const billing = useCompanyBilling();
  const qc = useQueryClient();
  const location = useLocation();
  const returned = new URLSearchParams(location.search).get('checkout') === 'returned';
  const [choice, setChoice] = useState<PlanChoice>({ ownerScout: true, interval: 'month' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (returned) void qc.invalidateQueries({ queryKey: ['company-billing'] });
  }, [returned, qc]);

  // The phone apps sell the plans through the App Store or Google Play on their own plan screen.
  if (Capacitor.isNativePlatform() || isAppStoreSafeMode()) return <Navigate to={canUseStorePlans() ? '/plan' : '/dashboard'} replace />;
  if (rollout.isLoading || billing.isLoading) return <div className="p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const b = billing.data?.billing as BillingRow | undefined;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); setBusy(false); }
  };

  const box = (children: React.ReactNode) => (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto"><Card><CardContent className="p-6 space-y-4">{children}</CardContent></Card></div>
  );

  if (isTeamMember) return box(<p>Your company owner manages TreeCheck's plan and billing.</p>);

  // A phone plan is changed or cancelled in the store it was bought from; the website sells nothing on top of it.
  const store = b?.provider === 'app_store' ? 'the App Store' : b?.provider === 'play_store' ? 'Google Play' : null;
  if (store && planIsRunning(b, Date.now())) {
    return box(<>
      <h1 className="text-2xl font-bold">Your plan</h1>
      <p>{b?.capacity?.ownerScout ? 'Core with one Scout license' : 'Core'}, billed through {store}.</p>
      {b?.status === 'trialing' && b.trial_ends_at && <p>Free trial until {day(b.trial_ends_at)}.</p>}
      {b?.status === 'active' && b.current_period_end && <p>Renews on {day(b.current_period_end)}.</p>}
      <p className="text-sm text-muted-foreground">Change or cancel it in the subscription settings of the phone you subscribed with.</p>
    </>);
  }

  // A plan already running: show it and offer the card portal; seats are changed from Team.
  if (b?.pricing_version === '2026-10' && b.stripe_subscription_id && !store) {
    const interval = b.billing_interval === 'year' ? 'year' : 'month';
    return box(<>
      <h1 className="text-2xl font-bold">Your plan</h1>
      {returned && <p className="text-sm text-primary">Thanks, your plan is confirmed.</p>}
      <p>{b.capacity?.ownerScout ? 'Core with one Scout license' : 'Core'}, billed {interval === 'year' ? 'yearly' : 'monthly'}.</p>
      {b.status === 'trialing' && b.trial_ends_at && <p>Free trial until {day(b.trial_ends_at)}. Your card is charged after that unless you cancel.</p>}
      {b.status === 'active' && b.current_period_end && <p>Renews on {day(b.current_period_end)}.</p>}
      {b.status === 'past_due' && <p className="text-destructive font-medium">Your last payment didn't go through. Update your card to keep TreeCheck running.</p>}
      {['canceled', 'unpaid', 'incomplete_expired'].includes(b.status ?? '') && <p>This plan has ended.</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(() => openCompanyPortal('plans'))}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update card, invoices or cancel
        </Button>
        <Button asChild variant="outline"><Link to="/dashboard/team">Seats and team</Link></Button>
      </div>
    </>);
  }

  if (!plansOpenOnWeb(rollout.data)) {
    return box(<p>The new TreeCheck plans open for payment in the next few days. Nothing is charged until then.</p>);
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-4">
      {returned && <p className="text-sm text-muted-foreground">Back from checkout. If you finished paying, your plan shows here within a minute.</p>}
      <CompanyCatalog selected={choice} onSelect={setChoice} />
      <Card>
        <CardContent className="p-6 space-y-3">
          <p className="font-semibold">
            {choice.ownerScout ? 'Core with one Scout license' : 'Core'}: {formatCents(planPrice(choice))}/{choice.interval === 'year' ? 'year' : 'month'}
          </p>
          <p className="text-sm text-muted-foreground">
            If your free trial is still running, it carries on and your card is charged when it ends. If your company hasn't had
            a trial yet, the first 14 days are free. Cancel any time before then and you won't be charged.
          </p>
          <Button className="w-full sm:w-auto" disabled={busy} onClick={() => run(() => startCompanyCheckout(choice, 'plans'))}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Continue to secure checkout
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
