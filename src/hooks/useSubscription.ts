import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { SubscriptionTier } from '@/lib/subscriptions';
import { canUsePaymentFunction, isAppStoreSafeMode } from '@/lib/platform';

export interface SubscriptionStatus {
  subscribed: boolean;
  tier: SubscriptionTier;
  subscription_end: string | null;
  credit_balance: number;
  discount_next_lead: boolean;
}

export function useSubscription() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['subscription', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('check-subscription');
      if (error) throw error;
      return data as SubscriptionStatus;
    },
    enabled: !!user,
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60,
  });
}

export function useUpgradeToPremium() {
  return useMutation({
    mutationFn: async () => {
      if (!canUsePaymentFunction('create-pro-checkout')) {
        throw new Error('Upgrades are managed on the web.');
      }
      const { data, error } = await supabase.functions.invoke('create-pro-checkout');
      if (error) throw error;
      return data as { url: string };
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start checkout');
    },
  });
}

// Keep old export name for backward compatibility
export const useUpgradeToPro = useUpgradeToPremium;
