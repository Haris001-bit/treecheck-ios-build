import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { canUseAppleIAP, canUseStorePlans } from '@/lib/platform';
import {
  configureRevenueCat,
  getCustomerInfo,
  getOfferings,
  getStorePlanPackages,
  loginRevenueCatUser,
  logoutRevenueCatUser,
  purchaseCredits250,
  purchaseCredits500,
  purchaseDma,
  purchaseLeadUnlockTier,
  purchaseMarketing,
  purchaseStorePlan,
  restorePurchases,
} from '@/lib/revenueCat';
import { pickLeadUnlockTier, formatUsd, type StorePlanKey } from '@/lib/iapProducts';
import { supabase } from '@/integrations/supabase/client';

export function useRevenueCatIdentity() {
  const { user } = useAuth();

  useEffect(() => {
    // The store's purchases belong to the TreeCheck login, on iPhone and on Android.
    if (!canUseStorePlans()) return;
    let cancelled = false;

    (async () => {
      try {
        await configureRevenueCat();
        if (cancelled) return;
        if (user?.id) {
          await loginRevenueCatUser(user.id);
        } else {
          await logoutRevenueCatUser();
        }
      } catch (e) {
        console.error('[RevenueCat] identity error', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);
}

export function useIapOfferings() {
  return useQuery({
    queryKey: ['iap-offerings'],
    queryFn: async () => getOfferings(),
    enabled: canUseAppleIAP(),
    staleTime: 1000 * 60 * 5,
  });
}

export function useIapCustomerInfo() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['iap-customer-info', user?.id],
    queryFn: async () => getCustomerInfo(),
    enabled: canUseStorePlans() && !!user,
    staleTime: 1000 * 30,
  });
}

/** The company plans' packages, with the store's own prices (payments milestone). */
export function useStorePlanPackages() {
  return useQuery({
    queryKey: ['store-plan-packages'],
    queryFn: async () => getStorePlanPackages(),
    enabled: canUseStorePlans(),
    staleTime: 1000 * 60 * 5,
  });
}

function useInvalidateAfterPurchase() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['subscription'] });
    queryClient.invalidateQueries({ queryKey: ['iap-customer-info'] });
    queryClient.invalidateQueries({ queryKey: ['marketing-subscription'] });
    queryClient.invalidateQueries({ queryKey: ['dma-subscription'] });
    queryClient.invalidateQueries({ queryKey: ['mobile-entitlements'] });
    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['purchased-leads'] });
    queryClient.invalidateQueries({ queryKey: ['has-purchased'] });
    queryClient.invalidateQueries({ queryKey: ['company-billing'] });
    queryClient.invalidateQueries({ queryKey: ['company-permission'] });
    queryClient.invalidateQueries({ queryKey: ['free-plan'] });
  };
}

export function useIapBuyCredits250() {
  const invalidate = useInvalidateAfterPurchase();
  return useMutation({
    mutationFn: async () => purchaseCredits250(),
    onSuccess: () => {
      invalidate();
      toast.success('Credits purchased. Balance updates in a moment.');
    },
    onError: (e: Error) => toast.error(e.message || 'Purchase cancelled or failed'),
  });
}

export function useIapBuyCredits500() {
  const invalidate = useInvalidateAfterPurchase();
  return useMutation({
    mutationFn: async () => purchaseCredits500(),
    onSuccess: () => {
      invalidate();
      toast.success('Premium credits purchased. Balance updates in a moment.');
    },
    onError: (e: Error) => toast.error(e.message || 'Purchase cancelled or failed'),
  });
}

export function useIapSubscribeMarketing() {
  const invalidate = useInvalidateAfterPurchase();
  return useMutation({
    mutationFn: async () => purchaseMarketing(),
    onSuccess: () => {
      invalidate();
      toast.success('Marketing subscription started.');
    },
    onError: (e: Error) => toast.error(e.message || 'Purchase cancelled or failed'),
  });
}

export function useIapSubscribeDma() {
  const invalidate = useInvalidateAfterPurchase();
  return useMutation({
    mutationFn: async () => purchaseDma(),
    onSuccess: () => {
      invalidate();
      toast.success('DMA subscription started.');
    },
    onError: (e: Error) => toast.error(e.message || 'Purchase cancelled or failed'),
  });
}

/** Buys a company plan in the App Store or Google Play; the plan screen waits for the server to show it. */
export function useBuyStorePlan() {
  const invalidate = useInvalidateAfterPurchase();
  return useMutation({
    mutationFn: async (plan: StorePlanKey) => purchaseStorePlan(plan),
    onSuccess: () => invalidate(),
    onError: (e: Error) => {
      if (/cancel/i.test(e.message)) return;
      toast.error(e.message || 'Purchase failed');
    },
  });
}

export function useIapRestore() {
  const invalidate = useInvalidateAfterPurchase();
  return useMutation({
    mutationFn: async () => restorePurchases(),
    onSuccess: () => {
      invalidate();
      toast.success('Purchases restored.');
    },
    onError: (e: Error) => toast.error(e.message || 'Restore failed'),
  });
}

/** Unlock lead: prefer wallet credits; otherwise purchase nearest IAP tier then grant. */
export function useIapUnlockLead() {
  const invalidate = useInvalidateAfterPurchase();

  return useMutation({
    mutationFn: async ({
      leadId,
      leadPriceUsd,
      creditBalance,
      useDiscount,
    }: {
      leadId: string;
      leadPriceUsd: number;
      creditBalance: number;
      useDiscount?: boolean;
    }) => {
      if (creditBalance >= leadPriceUsd) {
        const { data, error } = await supabase.functions.invoke('purchase-lead', {
          body: {
            lead_id: leadId,
            use_discount: useDiscount || false,
            payment_source: 'credits',
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return { method: 'credits' as const, data };
      }

      const tier = pickLeadUnlockTier(leadPriceUsd);
      const { customerInfo, productId, tierPriceUsd } = await purchaseLeadUnlockTier(leadPriceUsd);

      const txId =
        (customerInfo as any)?.nonSubscriptionTransactions?.slice(-1)?.[0]?.transactionIdentifier ||
        (customerInfo as any)?.nonSubscriptionTransactions?.slice(-1)?.[0]?.transaction_id ||
        `${productId}:${Date.now()}`;

      const { data, error } = await supabase.functions.invoke('iap-unlock-lead', {
        body: {
          lead_id: leadId,
          product_id: productId,
          tier_price_usd: tierPriceUsd,
          rc_transaction_id: String(txId),
          computed_lead_price_usd: leadPriceUsd,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { method: 'iap_tier' as const, data, tierPriceUsd, productId };
    },
    onSuccess: (result) => {
      invalidate();
      if (result.method === 'credits') {
        toast.success('Lead unlocked with credits.');
      } else {
        toast.success(`Lead unlocked via App Store (${formatUsd(result.tierPriceUsd!)}).`);
      }
    },
    onError: (e: Error) => {
      if (/cancel/i.test(e.message)) {
        toast.message('Purchase cancelled');
        return;
      }
      toast.error(e.message || 'Failed to unlock lead');
    },
  });
}

export { pickLeadUnlockTier, formatUsd };
