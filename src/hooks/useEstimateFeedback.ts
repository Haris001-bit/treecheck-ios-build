import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type FeedbackValue = 'too_low' | 'about_right' | 'too_high';

export interface EstimateFeedback {
  id: string;
  lead_id: string;
  contractor_id: string;
  feedback: FeedbackValue;
  ai_estimate_low: number;
  ai_estimate_high: number;
  job_type: string;
  location: string;
  created_at: string;
  updated_at: string;
}

export function useEstimateFeedback(leadId: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['estimate-feedback', leadId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estimate_feedback' as any)
        .select('*')
        .eq('lead_id', leadId)
        .eq('contractor_id', user!.id)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as EstimateFeedback | null;
    },
    enabled: !!user && !!leadId,
  });
}

export function useUpsertEstimateFeedback() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      leadId: string;
      feedback: FeedbackValue;
      aiEstimateLow: number;
      aiEstimateHigh: number;
      jobType: string;
      location: string;
    }) => {
      const { data: existing } = await supabase
        .from('estimate_feedback' as any)
        .select('id')
        .eq('lead_id', params.leadId)
        .eq('contractor_id', user!.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('estimate_feedback' as any)
          .update({ feedback: params.feedback } as any)
          .eq('id', (existing as any).id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('estimate_feedback' as any)
          .insert({
            lead_id: params.leadId,
            contractor_id: user!.id,
            feedback: params.feedback,
            ai_estimate_low: params.aiEstimateLow,
            ai_estimate_high: params.aiEstimateHigh,
            job_type: params.jobType,
            location: params.location,
          } as any);
        if (error) throw error;
      }
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: ['estimate-feedback', params.leadId, user?.id] });
    },
  });
}
