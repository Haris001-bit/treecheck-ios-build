// The owner's billing banner on every dashboard page (payments milestone, 2026-10-21), website only:
// - a renewal payment failed: update the card (Stripe's billing portal);
// - a trial with no card yet, once the plans are open: choose a plan before the trial ends;
// - a signup that left checkout before the card: finish choosing the plan to start the trial.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/hooks/useProfile';
import { useCompanyBilling } from '@/hooks/useCompanyBilling';
import { usePlansOpen } from '@/hooks/useBillingRollout';
import { openCompanyPortal } from '@/lib/billing/companyCheckout';
import { Capacitor } from '@capacitor/core';
import { isAppStoreSafeMode } from '@/lib/platform';
import { billingBannerKind } from '@/lib/billing/bannerKind';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function BillingBanner() {
  const { isTeamMember } = useAuth();
  const billing = useCompanyBilling();
  const profile = useProfile();
  const plansOpen = usePlansOpen();
  const [busy, setBusy] = useState(false);
  if (isTeamMember || Capacitor.isNativePlatform() || isAppStoreSafeMode()) return null;
  const b = billing.data?.billing as { pricing_version?: string; provider?: string; status?: string; stripe_subscription_id?: string | null; trial_ends_at?: string | null } | undefined;
  // company-billing flags a trial of the old $50 iPhone plan, which Apple converts by itself.
  const kind = billingBannerKind(b, profile.data && { ...profile.data, storeTrial: billing.data?.appleTrial === true }, plansOpen);
  if (!kind) return null;
  const trialEnd = b?.pricing_version === '2026-10' ? b.trial_ends_at : profile.data?.trial_ends_at;
  return (
    <div className={`px-4 py-3 text-sm flex flex-wrap items-center gap-3 ${kind === 'past_due' ? 'bg-destructive/10' : 'bg-primary/10'}`}>
      <span className="flex-1 min-w-[12rem]">
        {kind === 'past_due' && "Your last payment didn't go through. Update your card to keep TreeCheck running."}
        {kind === 'choose_plan' && `Your free trial ends${trialEnd ? ` on ${day(trialEnd)}` : ' soon'}. Choose a plan to keep TreeCheck.`}
        {kind === 'finish_signup' && 'Add your card to start your 14-day free trial.'}
      </span>
      {kind === 'past_due'
        ? <Button size="sm" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await openCompanyPortal('plans'); } catch (e) { toast.error(e instanceof Error ? e.message : 'Billing is unavailable'); setBusy(false); }
          }}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update card</Button>
        : <Button size="sm" asChild><Link to="/dashboard/plans">Choose a plan</Link></Button>}
    </div>
  );
}
