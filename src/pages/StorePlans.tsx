// The phone plan screen (payments milestone, Part B): an owner chooses a company plan in the App Store or Google Play,
// or sees and manages the one they have. Shown right after signup in the apps, and from the locked screens and
// Settings. The website sells the same plans through Stripe at /dashboard/plans.
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Browser } from '@capacitor/browser';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import treecheckLogo from '@/assets/treecheck-white-login.png';
import { useAuth } from '@/lib/auth';
import { canUseStorePlans, isNativeAndroid, storeName } from '@/lib/platform';
import { companyBillingAction } from '@/hooks/useCompanyBilling';
import { useBuyStorePlan, useIapCustomerInfo, useIapRestore, useStorePlanPackages } from '@/hooks/useRevenueCat';
import { storePlanPackage } from '@/lib/revenueCat';
import { STORE_PLAN_ENTITLEMENT, STORE_PLANS, type StorePlanKey } from '@/lib/iapProducts';
import { freeTrialDays, storePlanScreen, type StorePlanBilling, type StoreProviderId } from '@/lib/billing/storePlanState';

const ORDER: StorePlanKey[] = ['core_scout_monthly', 'core_monthly', 'core_yearly'];
const CORE_INCLUDES = ['Jobs, Subs and Pulse', 'Jobber and the other integrations', 'You plus two Field users'];
const SCOUT_INCLUDES = 'Scout photo-to-price estimates for you';
const MANAGE_URLS: Record<StoreProviderId, string> = {
  app_store: 'https://apps.apple.com/account/subscriptions',
  play_store: 'https://play.google.com/store/account/subscriptions?package=com.treecheck.app',
};
const STORE_NAMES: Record<StoreProviderId, string> = { app_store: 'the App Store', play_store: 'Google Play' };

type Row = StorePlanBilling & { billing_interval?: string; capacity?: { ownerScout?: boolean } | null; pending_renewal?: { cancellation?: boolean } | null };
type StatusResponse = { billing?: Row; storeBlocker?: string | null };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openUrl(url: string) {
  try {
    await Browser.open({ url });
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export default function StorePlans() {
  const { user, isTeamMember } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const deviceStore: StoreProviderId = isNativeAndroid() ? 'play_store' : 'app_store';
  const available = canUseStorePlans();
  const status = useQuery({
    queryKey: ['store-plan-status', user?.id],
    enabled: available && !!user && !isTeamMember,
    queryFn: async () => (await companyBillingAction({ action: 'status', storeCheck: true })) as StatusResponse,
    staleTime: 10_000,
  });
  const packages = useStorePlanPackages();
  const customer = useIapCustomerInfo();
  const buy = useBuyStorePlan();
  const restore = useIapRestore();
  const [waiting, setWaiting] = useState(false);

  if (!available) return <Navigate to="/dashboard/plans" replace />;

  const screen = storePlanScreen({
    isTeamMember, billing: status.data?.billing, storeBlocker: status.data?.storeBlocker, deviceStore, now: Date.now(),
  });
  const busy = buy.isPending || restore.isPending || waiting;

  // After the store's sheet: the webhook writes the plan within seconds, so wait for the server to show it.
  const choose = async (plan: StorePlanKey) => {
    try {
      await buy.mutateAsync(plan);
    } catch {
      return; // cancelled, or the hook already said what went wrong
    }
    setWaiting(true);
    for (let i = 0; i < 15; i++) {
      const fresh = (await companyBillingAction({ action: 'status', storeCheck: true }).catch(() => null)) as StatusResponse | null;
      if (fresh && storePlanScreen({ isTeamMember, billing: fresh.billing, storeBlocker: fresh.storeBlocker, deviceStore, now: Date.now() }).kind === 'current') {
        await qc.invalidateQueries();
        toast.success('Your plan is active');
        navigate('/dashboard/start', { replace: true });
        return;
      }
      await sleep(2000);
    }
    setWaiting(false);
    toast.message('Your purchase went through. Your plan shows here within a minute.');
    void status.refetch();
  };

  const manage = (provider: StoreProviderId) => openUrl(customer.data?.managementURL ?? MANAGE_URLS[provider]);
  const restoreButton = (
    <Button variant="ghost" size="sm" disabled={busy} onClick={async () => { await restore.mutateAsync().catch(() => null); void status.refetch(); }}>
      Restore Purchases
    </Button>
  );
  const legal = (
    <p className="text-xs text-muted-foreground text-center">
      <Link to="/terms" className="underline">Terms of Use</Link> · <Link to="/privacy" className="underline">Privacy Policy</Link>
    </p>
  );

  const page = (title: string, children: React.ReactNode) => (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-lg py-6 space-y-4">
        <div className="flex items-center justify-between">
          <img src={treecheckLogo} alt="TreeCheck" className="h-8" />
          <Link to="/dashboard" className="text-sm text-primary underline">Back to TreeCheck</Link>
        </div>
        <h1 className="text-2xl font-black">{title}</h1>
        {children}
      </div>
    </div>
  );

  if (screen.kind === 'team') return page('TreeCheck plan', <p>Your company owner chooses TreeCheck's plan. Ask them to choose one.</p>);
  if (status.isLoading) return page('Choose your plan', <Loader2 className="h-6 w-6 animate-spin text-primary" />);
  if (status.isError) return page('Choose your plan', <p>We couldn't load your plan. Check your connection and try again.</p>);
  if (screen.kind === 'complimentary') return page('Your plan', <p>Your company has complimentary access to TreeCheck.</p>);
  if (screen.kind === 'web') return page('Your plan', <p>You're subscribed on the website, so there's nothing to buy here.</p>);
  if (screen.kind === 'blocked') return page('Your plan', <p>{screen.reason}</p>);

  if (screen.kind === 'current') {
    const b = status.data?.billing;
    const title = b?.capacity?.ownerScout ? STORE_PLANS.core_scout_monthly.title : b?.billing_interval === 'year' ? STORE_PLANS.core_yearly.title : STORE_PLANS.core_monthly.title;
    const billingIssue = !!customer.data?.entitlements?.active?.[STORE_PLAN_ENTITLEMENT]?.billingIssueDetectedAt;
    return page('Your plan', (
      <Card>
        <CardContent className="p-6 space-y-3">
          <p className="font-semibold">{title}, billed through {STORE_NAMES[screen.provider]}</p>
          {billingIssue && <p className="text-destructive font-medium">There's a problem with your payment. Update it in {storeName()} to keep TreeCheck running.</p>}
          {b?.status === 'trialing' && b.trial_ends_at && <p>Free trial until {day(b.trial_ends_at)}. It then renews automatically unless you cancel.</p>}
          {b?.status === 'active' && b.current_period_end && <p>{b.pending_renewal?.cancellation ? `Ends on ${day(b.current_period_end)}. It won't renew.` : `Renews on ${day(b.current_period_end)}.`}</p>}
          {screen.here
            ? <div className="flex flex-wrap gap-2"><Button onClick={() => manage(screen.provider)}>Manage subscription</Button>{restoreButton}</div>
            : <p className="text-sm text-muted-foreground">Manage it on the phone you subscribed with.</p>}
          {legal}
        </CardContent>
      </Card>
    ));
  }

  const list = packages.data ?? [];
  return page('Choose your plan', (
    <>
      <p className="text-sm text-muted-foreground">Pay through {storeName()}. New subscribers get the free trial shown, and you can cancel any time in your subscription settings.</p>
      {packages.isLoading && <Loader2 className="h-6 w-6 animate-spin text-primary" />}
      {!packages.isLoading && list.length === 0 && <p>The plans couldn't be loaded from {storeName()}. Check your connection and try again.</p>}
      {ORDER.map((key) => {
        const plan = STORE_PLANS[key];
        const pkg = storePlanPackage(list, key);
        if (!pkg) return null;
        const period = plan.interval === 'year' ? 'year' : 'month';
        const trial = freeTrialDays(pkg.product as Parameters<typeof freeTrialDays>[0]);
        const price = `${pkg.product.priceString}/${period}`;
        return (
          <Card key={key} className={key === 'core_scout_monthly' ? 'border-2 border-primary' : undefined}>
            <CardContent className="p-5 space-y-3">
              <div>
                <p className="text-lg font-bold">{plan.title}</p>
                <p className="font-semibold">{trial ? `${trial} days free, then ${price}` : price}</p>
                <p className="text-xs text-muted-foreground">Renews automatically until you cancel.</p>
              </div>
              <ul className="space-y-1 text-sm">
                {[...CORE_INCLUDES, ...(plan.ownerScout ? [SCOUT_INCLUDES] : [])].map((f) => (
                  <li key={f} className="flex gap-2"><Check className="h-4 w-4 text-primary mt-0.5 shrink-0" /><span>{f}</span></li>
                ))}
              </ul>
              <Button className="w-full" disabled={busy} onClick={() => choose(key)}>
                {busy && buy.variables === key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {trial ? `Start ${trial}-day free trial` : 'Subscribe'}
              </Button>
            </CardContent>
          </Card>
        );
      })}
      {waiting && <p className="text-sm text-muted-foreground">Confirming your plan…</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {restoreButton}
        <Button variant="ghost" size="sm" onClick={() => manage(deviceStore)}>Manage subscription</Button>
      </div>
      {legal}
    </>
  ));
}
