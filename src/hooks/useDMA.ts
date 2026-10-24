import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';

export interface DMASubscriptionStatus {
  subscribed: boolean;
  subscription_end: string | null;
  subscription_id: string | null;
  card_last4: string | null;
  card_brand: string | null;
  beta_enabled?: boolean;
}

export interface DMAIntegration {
  id: string;
  contractor_id: string;
  facebook_page_id: string | null;
  facebook_page_name: string | null;
  instagram_business_account_id: string | null;
  instagram_handle: string | null;
  google_account_id: string | null;
  google_location_id: string | null;
  google_review_link: string | null;
  google_business_name: string | null;
  has_first_impression: boolean;
  website_url: string | null;
  publish_endpoint_url?: string | null;
  public_site_url?: string | null;
}


export interface DMAReviewTemplate {
  id: string;
  contractor_id: string;
  template_text: string;
}

export function useDMASubscription() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['dma-subscription', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('check-dma-subscription');
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as DMASubscriptionStatus;
    },
    enabled: !!user,
    staleTime: 1000 * 60,
  });
}

export function useCreateDMASubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { canUsePaymentFunction } = await import('@/lib/platform');
      if (!canUsePaymentFunction('create-dma-subscription')) {
        throw new Error('Subscriptions are managed on the web.');
      }
      const { data, error } = await supabase.functions.invoke('create-dma-subscription');
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as { success: boolean; subscription_id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dma-subscription'] });
      toast.success('DMA subscription activated!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create subscription');
    },
  });
}

export function useDMAIntegration() {
  const { user, effectiveContractorId } = useAuth();
  const cid = effectiveContractorId ?? user?.id;
  return useQuery({
    queryKey: ['dma-integration', cid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dma_integrations' as any)
        .select('*')
        .eq('contractor_id', cid!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as DMAIntegration | null;
    },
    enabled: !!cid,
  });
}

export function useUpsertDMAIntegration() {
  const queryClient = useQueryClient();
  const { user, effectiveContractorId } = useAuth();
  const cid = effectiveContractorId ?? user?.id;
  return useMutation({
    mutationFn: async (updates: Partial<DMAIntegration>) => {
      const { data, error } = await supabase
        .from('dma_integrations' as any)
        .upsert({ contractor_id: cid, ...updates }, { onConflict: 'contractor_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dma-integration'] });
    },
  });
}

export function useDMAReviewTemplate() {
  const { user, effectiveContractorId } = useAuth();
  const cid = effectiveContractorId ?? user?.id;
  return useQuery({
    queryKey: ['dma-review-template', cid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dma_review_templates' as any)
        .select('*')
        .eq('contractor_id', cid!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as DMAReviewTemplate | null;
    },
    enabled: !!cid,
  });
}

export function useUpsertDMAReviewTemplate() {
  const queryClient = useQueryClient();
  const { user, effectiveContractorId } = useAuth();
  const cid = effectiveContractorId ?? user?.id;
  return useMutation({
    mutationFn: async (template_text: string) => {
      const { data, error } = await supabase
        .from('dma_review_templates' as any)
        .upsert({ contractor_id: cid, template_text }, { onConflict: 'contractor_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dma-review-template'] });
      toast.success('Review template saved!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save template');
    },
  });
}
