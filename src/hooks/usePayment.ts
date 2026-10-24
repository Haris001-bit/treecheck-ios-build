import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { canUsePaymentFunction, isAppStoreSafeMode } from '@/lib/platform';

function blockedInSafeMode(fn: string): never {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(`[AppStoreSafeMode] Refusing to invoke ${fn} from native iOS`);
  }
  throw new Error('This action is not available in the mobile app.');
}

export interface PaymentCard {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}

export interface PaymentMethodStatus {
  has_payment_method: boolean;
  card: PaymentCard | null;
}

export function usePaymentMethod() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['payment-method', user?.id],
    queryFn: async () => {
      if (isAppStoreSafeMode()) {
        return { has_payment_method: false, card: null } as PaymentMethodStatus;
      }
      const { data, error } = await supabase.functions.invoke('check-payment-method');
      if (error) throw error;
      return data as PaymentMethodStatus;
    },
    enabled: !!user && !isAppStoreSafeMode(),
    staleTime: 1000 * 60 * 5,
  });
}

export function useSetupPaymentMethod() {
  return useMutation({
    mutationFn: async () => {
      if (!canUsePaymentFunction('setup-payment-method')) blockedInSafeMode('setup-payment-method');
      const { data, error } = await supabase.functions.invoke('setup-payment-method');
      if (error) throw error;
      return data as { url: string };
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set up payment method');
    },
  });
}

export function useBuyCredits() {
  return useMutation({
    mutationFn: async (leadId?: string) => {
      if (!canUsePaymentFunction('buy-credits')) blockedInSafeMode('buy-credits');
      const { data, error } = await supabase.functions.invoke('buy-credits', {
        body: leadId ? { lead_id: leadId } : {},
      });
      if (error) throw error;
      return data as { url: string };
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start credit purchase');
    },
  });
}

export function useAddCredits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!canUsePaymentFunction('add-credits')) blockedInSafeMode('add-credits');
      const { data, error } = await supabase.functions.invoke('add-credits');
      if (error) throw error;
      return data as { success: boolean; credit_balance: number; amount_added?: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      if (data.amount_added) {
        toast.success(`$${data.amount_added} in credits added to your wallet!`);
      }
    },
  });
}

export function usePurchaseLeadWithStripe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      leadId,
      useDiscount,
      paymentSource,
    }: {
      leadId: string;
      useDiscount?: boolean;
      paymentSource?: 'credits' | 'card';
    }) => {
      if (!canUsePaymentFunction('purchase-lead')) blockedInSafeMode('purchase-lead');
      const { data, error } = await supabase.functions.invoke('purchase-lead', {
        body: {
          lead_id: leadId,
          use_discount: useDiscount || false,
          ...(paymentSource ? { payment_source: paymentSource } : {}),
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as {
        success: boolean;
        amount_charged: number;
        credits_used: number;
        card_charged: number;
        credit_balance: number;
        payment_method: 'credits' | 'card';
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['purchased-leads'] });
      queryClient.invalidateQueries({ queryKey: ['has-purchased'] });
      queryClient.invalidateQueries({ queryKey: ['subscription'] });

      if (data.payment_method === 'credits') {
        toast.success(`Lead unlocked! $${data.credits_used.toFixed(2)} deducted from credits. Balance: $${data.credit_balance.toFixed(2)}`);
      } else if (data.credits_used > 0) {
        toast.success(`Lead unlocked! $${data.credits_used.toFixed(2)} from credits + $${data.card_charged.toFixed(2)} charged to card.`);
      } else {
        toast.success(`Lead unlocked! $${data.amount_charged.toFixed(2)} charged to card.`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to purchase lead');
    },
  });
}
