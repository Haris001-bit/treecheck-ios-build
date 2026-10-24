import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import type { DMASetupValues } from '@/lib/dmaSetup';

export interface DMASetupStatus {
  setup: (DMASetupValues & { brand_voice: string; completed_at: string | null }) | null;
  defaults: { company_name: string; contact_name: string; delivery_email: string; service_area: string; website_url: string };
  connected: boolean;
  can_manage: boolean;
  can_generate: boolean;
  trial_ends_at: string | null;
  /** Free plan (Oklahoma owners): preview posts only, the rest of each post waits until a trial or paid plan. */
  free_preview?: boolean;
}
export async function dmaSetupAction(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('dma-setup', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = await error.context.json().catch(() => null);
      throw new Error(details?.error || 'Could not load your marketing setup.');
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export function useDMASetup() {
  const { user, effectiveContractorId, roleLoading } = useAuth();
  return useQuery<DMASetupStatus>({ queryKey: ['dma-setup', user?.id, effectiveContractorId], enabled: !!user && !!effectiveContractorId && !roleLoading,
    queryFn: () => dmaSetupAction({ action: 'status' }), staleTime: 30_000 });
}
export function useSaveDMASetup() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ values, complete }: { values: DMASetupValues; complete: boolean }) => dmaSetupAction({ action: 'save', values, complete }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dma-setup'] }); qc.invalidateQueries({ queryKey: ['dma-integration'] }); } });
}