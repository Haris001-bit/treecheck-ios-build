import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type SubUsage = 'every_job' | 'sometimes' | 'rarely' | 'never';
export type CrewRole = 'climber' | 'ground' | 'stump' | 'crane' | 'chipper';

export interface CompanySettings {
  contractor_id: string;
  sub_usage: SubUsage;
  sub_roles: string[];
  in_house_roles: string[];
  lead_sources: string[];
  crm: string;
  crm_other: string | null;
  auto_broadcast: boolean;
  ai_estimate_visibility: string;
  onboarding_completed_at: string | null;
  operating_model?: OperatingModel;
  /** Scout learning (the weekly feedback loop), the owner's switch; off by default. */
  scout_learning_enabled?: boolean;
}

export type OperatingModel = 'subcontractors' | 'employees' | 'hybrid';
/** Employee and hybrid companies get the Scout Production Plan; subcontractor companies keep the existing flow. */
export const usesProductionPlan = (s: CompanySettings | null | undefined) =>
  !!s && (s.operating_model === 'employees' || s.operating_model === 'hybrid');

export const usesSubs = (s: CompanySettings | null | undefined) =>
  !s || s.sub_usage === 'every_job' || s.sub_usage === 'sometimes';

/** The account owner's "How we work" settings (team members read their owner's). */
export function useCompanySettings() {
  const { user, effectiveContractorId } = useAuth();
  const ownerId = effectiveContractorId ?? user?.id ?? null;
  return useQuery({
    queryKey: ['company-settings', ownerId],
    enabled: !!ownerId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_settings')
        .select('*')
        .eq('contractor_id', ownerId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CompanySettings | null;
    },
  });
}

export function useSaveCompanySettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (patch: Partial<CompanySettings>) => {
      const { error } = await supabase
        .from('company_settings')
        .upsert({ contractor_id: user!.id, ...patch } as any, { onConflict: 'contractor_id' });
      if (error) throw error;
      if (patch.auto_broadcast !== undefined) {
        await supabase.from('profiles').update({ crew_auto_broadcast: patch.auto_broadcast } as any).eq('id', user!.id);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company-settings'] }),
  });
}
