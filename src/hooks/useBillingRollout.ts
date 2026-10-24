// The company plans switch (payments milestone, 2026-10-21). billing_rollout_status() says whether the new plans, the
// card at signup and the plan picker are open on the website: for everyone (web_live), or for a listed test owner.
// The phone apps never show them; they sell through the App Store and Google Play.
import { useQuery } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { isAppStoreSafeMode } from '@/lib/platform';

export type BillingRolloutStatus = { webLive: boolean; testOwner: boolean };
const CLOSED: BillingRolloutStatus = { webLive: false, testOwner: false };

export function useBillingRollout() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['billing-rollout', user?.id ?? null],
    queryFn: async (): Promise<BillingRolloutStatus> => {
      const { data, error } = await supabase.rpc('billing_rollout_status');
      if (error || !data || typeof data !== 'object') return CLOSED;
      const status = data as { web_live?: unknown; test_owner?: unknown };
      return { webLive: status.web_live === true, testOwner: status.test_owner === true };
    },
    staleTime: 60_000,
  });
}

/** True on the website when this person may choose and pay for a company plan; never in the phone apps. */
export function plansOpenOnWeb(status: BillingRolloutStatus | undefined, native = Capacitor.isNativePlatform()): boolean {
  return !native && !isAppStoreSafeMode() && !!status && (status.webLive || status.testOwner);
}

export function usePlansOpen(): boolean {
  return plansOpenOnWeb(useBillingRollout().data);
}
