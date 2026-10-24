import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { canUsePaymentFunction } from '@/lib/platform';
import { toast } from 'sonner';

async function freshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;
  // Refresh if the token expires within 60s so the server never sees a stale one.
  if (session.expires_at && session.expires_at * 1000 - Date.now() < 60_000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  }
  return session.access_token;
}

export async function companyBillingAction(body: Record<string, unknown>) {
  if (body.action !== 'status' && !canUsePaymentFunction('company-billing')) throw new Error('Company billing is not available through Stripe on iPhone.');
  let token = await freshAccessToken();
  if (!token) {
    if (body.action === 'status') return { billing: { pricing_version: 'legacy' }, members: [] };
    throw new Error('Please sign in again.');
  }
  let { data, error } = await supabase.functions.invoke('company-billing', { body, headers: { Authorization: `Bearer ${token}` } });
  // One retry with a refreshed session if the server rejected the token.
  if ((error as { context?: Response } | null)?.context?.status === 401) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token ?? null;
    if (!token) {
      if (body.action === 'status') return { billing: { pricing_version: 'legacy' }, members: [] };
      throw new Error('Please sign in again.');
    }
    ({ data, error } = await supabase.functions.invoke('company-billing', { body, headers: { Authorization: `Bearer ${token}` } }));
  }
  if (data?.error) throw new Error(data.error);
  if (error) throw error;
  return data;
}

export function useCompanyBilling() {
  const { user, isTeamMember, effectiveContractorId } = useAuth();
  return useQuery({ queryKey: ['company-billing', user?.id, effectiveContractorId], enabled: !!user && !!effectiveContractorId,
    queryFn: async () => {
      if (!isTeamMember) return companyBillingAction({ action: 'status' });
      const { data, error } = await supabase.from('company_billing').select('pricing_version,status,capacity,dma_source,current_period_end,trial_ends_at,complimentary').eq('owner_id', effectiveContractorId ?? '').maybeSingle();
      if (error) throw error;
      return { billing: data ?? { pricing_version: 'legacy' }, members: [] };
    }, staleTime: 15_000, refetchInterval: 60_000 });
}

export function useCompanyBillingChange() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: companyBillingAction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-billing'] });
      qc.invalidateQueries({ queryKey: ['company-permission'] });
      qc.invalidateQueries({ queryKey: ['product-entitlements'] });
    },
    onError: (e: Error) => toast.error(e.message) });
}