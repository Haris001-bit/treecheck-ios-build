import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { functionFailure } from '@/lib/functionFailure';
import type { FreePlanStatus } from '@/lib/freePlan';
import { plansOpenOnWeb } from '@/hooks/useBillingRollout';

/** The signed-in company's plan (paid / trialing / free / locked) and its Free monthly use. */
export function useFreePlan() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['free-plan', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<FreePlanStatus> => {
      const { data, error } = await supabase.rpc('free_plan_status');
      if (error) throw error;
      return (data ?? { plan: 'none' }) as unknown as FreePlanStatus;
    },
  });
  // Previews made on Free unlock as soon as the company has a trial or a paid plan.
  const unlocking = useRef(false);
  const s = query.data;
  useEffect(() => {
    if (!s || unlocking.current || !(s.locked_previews && s.locked_previews > 0)) return;
    if (s.plan !== 'trialing' && s.plan !== 'paid') return;
    unlocking.current = true;
    void supabase.rpc('free_preview_unlock').then(({ data }) => {
      unlocking.current = false;
      if (Number(data) > 0) {
        toast.success('Your Scout and DMA previews are unlocked.');
        void qc.invalidateQueries();
      }
    });
  }, [s, qc]);
  return query;
}

/** Starts the one 14-day trial with no card, or, once the company plans are open, sends the owner to the plan picker. */
export function useStartTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('company-start-trial', { body: {} });
      const failure = await functionFailure(error, data);
      if (failure) throw new Error(failure.message);
      // The plans are open on the website: the 14 days run in Stripe Checkout with the card (payments milestone).
      if (data?.plan_picker) {
        window.location.assign('/dashboard/plans');
        return 'redirect';
      }
      await supabase.rpc('free_preview_unlock');
      return 'started';
    },
    onSuccess: (result) => {
      if (result === 'started') {
        toast.success('Your 14-day trial has started.');
        void qc.invalidateQueries();
      }
    },
    onError: (e: Error) => toast.error(e.message || 'Could not start your trial'),
  });
}

/** Paid access for owners who already had their trial: the plan picker once the company plans are open, otherwise the existing Scout checkout (same tab). */
export function useUpgradeCheckout() {
  return useMutation({
    mutationFn: async () => {
      const { data: rollout } = await supabase.rpc('billing_rollout_status');
      const status = (rollout ?? {}) as { web_live?: unknown; test_owner?: unknown };
      if (plansOpenOnWeb({ webLive: status.web_live === true, testOwner: status.test_owner === true })) {
        window.location.assign('/dashboard/plans');
        return;
      }
      const { data, error } = await supabase.functions.invoke('create-scout-checkout');
      const failure = await functionFailure(error, data);
      if (failure || !data?.url) throw new Error(failure?.message || 'Could not start checkout');
      window.location.href = data.url;
    },
    onError: (e: Error) => toast.error(e.message || 'Could not start checkout'),
  });
}
