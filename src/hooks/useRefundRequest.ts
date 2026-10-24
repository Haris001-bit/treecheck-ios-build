import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type RefundReasonCode =
  | 'job_already_done_diy'
  | 'suspected_scam'
  | 'unable_to_reach'
  | 'customer_denies'
  | 'wrong_service'
  | 'misrepresented'
  | 'duplicate'
  | 'other';

export const REFUND_REASONS: { value: RefundReasonCode; label: string; hint?: string }[] = [
  {
    value: 'job_already_done_diy',
    label: 'Homeowner says the work is already done',
    hint: 'Use this only if the homeowner handled it themselves, a neighbor/family member did it, or the tree was already removed before they ever got a quote. This does NOT apply if they hired another contractor — losing a lead to a competitor is normal competition and is not refundable.',
  },
  { value: 'suspected_scam', label: 'Suspected fraudulent lead / scammer' },
  { value: 'unable_to_reach', label: 'Unable to reach customer after multiple attempts' },
  { value: 'customer_denies', label: 'Customer denies submitting the request' },
  { value: 'wrong_service', label: 'Wrong service requested (not tree work)' },
  { value: 'misrepresented', label: 'Job significantly misrepresented' },
  { value: 'duplicate', label: 'Duplicate of a lead I already purchased' },
  { value: 'other', label: 'Other (please describe)' },
];

export function useMyRefundRequests() {
  return useQuery({
    queryKey: ['my-refund-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('refund_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useRequestRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { purchase_id: string; reason_code: RefundReasonCode; reason_notes?: string }) => {
      const { data, error } = await supabase.functions.invoke('request-lead-refund', { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Refund request submitted. We\'ll review and contact you within 1-2 business days.');
      qc.invalidateQueries({ queryKey: ['my-refund-requests'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to submit refund request'),
  });
}

export function useAdminRefundRequests(status: 'pending' | 'approved' | 'denied' | 'all' = 'pending') {
  return useQuery({
    queryKey: ['admin-refund-requests', status],
    queryFn: async () => {
      let q = supabase.from('refund_requests').select('*').order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data: requests, error } = await q;
      if (error) throw error;
      if (!requests || requests.length === 0) return [];

      const contractorIds = [...new Set(requests.map(r => r.contractor_id))];
      const leadIds = [...new Set(requests.map(r => r.lead_id))];

      const [{ data: profiles }, { data: leads }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, company_name, phone, email').in('id', contractorIds),
        supabase.from('leads').select('id, customer_name, city, photo_url, estimated_cost_min, estimated_cost_max, customer_phone, customer_address, status, purchase_count').in('id', leadIds),
      ]);

      return requests.map(r => ({
        ...r,
        contractor: profiles?.find(p => p.id === r.contractor_id),
        lead: leads?.find(l => l.id === r.lead_id),
      }));
    },
  });
}

export function useResolveRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { refund_id: string; decision: 'approved' | 'denied'; admin_notes?: string; lead_action?: 'sold_out' | 'available' | 'no_change' }) => {
      const { data, error } = await supabase.functions.invoke('resolve-lead-refund', { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.status === 'approved' ? `Refund approved — $${data.refund_amount.toFixed(2)} credited` : 'Refund denied');
      qc.invalidateQueries({ queryKey: ['admin-refund-requests'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to resolve refund'),
  });
}
