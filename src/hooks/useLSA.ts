import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';

export interface LSASettings {
  contractor_id: string;
  enabled: boolean;
  callback_number: string | null;
  sms_template: string;
  office_hours_start: string;
  office_hours_end: string;
  after_hours_behavior: 'always' | 'office_only';
  retell_agent_id: string | null;
}

export interface LSALead {
  id: string;
  contractor_id: string;
  lead_type: 'call' | 'message';
  customer_name: string | null;
  customer_phone: string | null;
  job_type: string | null;
  message: string | null;
  received_at: string;
  first_response_at: string | null;
  response_channel: string | null;
  outcome: 'new' | 'contacted' | 'booked' | 'follow_up' | 'lost';
  retell_call_id: string | null;
  notes: string | null;
  created_at: string;
}

export function useLSASettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['lsa-settings', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lsa_settings' as any)
        .select('*')
        .eq('contractor_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as LSASettings | null;
    },
    enabled: !!user,
  });
}

export function useUpdateLSASettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (updates: Partial<LSASettings>) => {
      const { data, error } = await supabase
        .from('lsa_settings' as any)
        .upsert({ contractor_id: user!.id, ...updates }, { onConflict: 'contractor_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lsa-settings'] });
      toast.success('LSA settings saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useLSALeads(filters?: { status?: string; from?: string; to?: string }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['lsa-leads', user?.id, filters],
    queryFn: async () => {
      let q = supabase
        .from('lsa_leads' as any)
        .select('*')
        .eq('contractor_id', user!.id)
        .order('received_at', { ascending: false });
      if (filters?.status && filters.status !== 'all') q = q.eq('outcome', filters.status);
      if (filters?.from) q = q.gte('received_at', filters.from);
      if (filters?.to) q = q.lte('received_at', filters.to);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as LSALead[]) ?? [];
    },
    enabled: !!user,
  });
}

export function useUpdateLSALead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<LSALead> }) => {
      const { data, error } = await supabase
        .from('lsa_leads' as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lsa-leads'] });
      toast.success('Lead updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
