import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { FunctionsHttpError } from '@supabase/supabase-js';

async function marketingError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const details = await error.context.json().catch(() => null);
    return new Error(details?.error || 'Marketing billing could not be checked.');
  }
  return error instanceof Error ? error : new Error('Marketing billing could not be checked.');
}

export interface MarketingProfile {
  id: string;
  contractor_id: string;
  photo_url: string | null;
  bio: string | null;
  isa_certified: boolean;
  isa_credentials: string | null;
  website_url: string | null;
  is_active: boolean;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketingSubscriptionStatus {
  subscribed: boolean | null;
  billing_available?: boolean;
  message?: string;
  subscription_end: string | null;
  subscription_id: string | null;
}

export function useMarketingSubscription() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['marketing-subscription', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('check-marketing-subscription');
      if (error) throw await marketingError(error);
      if (data?.error) throw new Error(data.error);
      return data as MarketingSubscriptionStatus;
    },
    enabled: !!user,
    staleTime: 1000 * 60,
    retry: false,
  });
}

export function useMarketingProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['marketing-profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_profiles' as any)
        .select('*')
        .eq('contractor_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as MarketingProfile | null;
    },
    enabled: !!user,
  });
}

export function useUpdateMarketingProfile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (updates: Partial<MarketingProfile>) => {
      // Upsert
      const { data, error } = await supabase
        .from('marketing_profiles' as any)
        .upsert({ contractor_id: user!.id, ...updates }, { onConflict: 'contractor_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-profile'] });
      toast.success('Marketing profile saved!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save marketing profile');
    },
  });
}

export function useCreateMarketingCheckout() {
  return useMutation({
    mutationFn: async () => {
      const { canUsePaymentFunction } = await import('@/lib/platform');
      if (!canUsePaymentFunction('create-marketing-checkout')) {
        throw new Error('Subscriptions are managed on the web.');
      }
      const { data, error } = await supabase.functions.invoke('create-marketing-checkout');
      if (error) throw await marketingError(error);
      if (data.error) throw new Error(data.error);
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

export function useGenerateMarketingBio() {
  return useMutation({
    mutationFn: async ({ transcript, company_name }: { transcript: string; company_name: string }) => {
      const { data, error } = await supabase.functions.invoke('generate-marketing-bio', {
        body: { transcript, company_name },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as { bio: string };
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to generate bio');
    },
  });
}

export function useSendMarketingWebhook() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-marketing-webhook');
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Your marketing profile has been sent to the website!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send to website');
    },
  });
}
