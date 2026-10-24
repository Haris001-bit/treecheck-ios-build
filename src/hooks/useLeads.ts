import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';

export interface Lead {
  id: string;
  photo_url: string;
  city: string;
  estimated_cost_min: number;
  estimated_cost_max: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_address: string | null;
  status: 'available' | 'sold_out' | 'expired';
  purchase_count: number;
  created_at: string;
  job_type: string;
  urgency: string;
  source?: string;
  owner_contractor_id?: string | null;
}

export interface LeadPurchase {
  id: string;
  lead_id: string;
  contractor_id: string;
  purchase_amount: number;
  purchased_at: string;
}

export function useLeads() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['leads', user?.id],
    queryFn: async () => {
      // Use leads_secure view to mask customer PII for unpurchased leads
      const { data, error } = await supabase
        .from('leads_secure' as any)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as unknown as Lead[];
    },
    enabled: !!user,
  });
}

export function usePurchasedLeads() {
  const { user, effectiveContractorId } = useAuth();
  const cid = effectiveContractorId ?? user?.id;

  return useQuery({
    queryKey: ['purchased-leads', cid],
    queryFn: async () => {
      const [purchasesRes, ownedRes] = await Promise.all([
        supabase
          .from('lead_purchases' as any)
          .select(`*, leads (*)`)
          .eq('contractor_id', cid!)
          .order('purchased_at', { ascending: false }),
        supabase
          .from('leads' as any)
          .select('*')
          .eq('owner_contractor_id', cid!)
          .order('created_at', { ascending: false }),
      ]);

      if (purchasesRes.error) throw purchasesRes.error;
      if (ownedRes.error) throw ownedRes.error;

      const purchases = (purchasesRes.data || []) as any[];
      const purchasedLeadIds = new Set(purchases.map((p) => p.lead_id));

      // Synthesize purchase-shaped rows for owned leads not already in purchases
      const ownedRows = ((ownedRes.data || []) as any[])
        .filter((l) => !purchasedLeadIds.has(l.id))
        .map((l) => ({
          id: `owned-${l.id}`,
          lead_id: l.id,
          contractor_id: cid!,
          purchase_amount: 0,
          purchased_at: l.created_at,
          leads: l,
        }));

      const combined = [...purchases, ...ownedRows].sort(
        (a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime()
      );
      return combined as unknown as (LeadPurchase & { leads: Lead })[];
    },
    enabled: !!cid,
  });
}

export function useHasPurchasedLead(leadId: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['has-purchased', leadId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_purchases' as any)
        .select('id')
        .eq('lead_id', leadId)
        .eq('contractor_id', user!.id)
        .maybeSingle();

      if (error) throw error;
      return !!data;
    },
    enabled: !!user && !!leadId,
  });
}

// Old usePurchaseLead removed - purchases must go through Stripe edge function
// Use usePurchaseLeadWithStripe from usePayment.ts instead

export function calculateLeadPrice(minCost: number, maxCost: number, createdAt?: string): number {
  const median = (minCost + maxCost) / 2;
  let rate = 0.05;
  if (createdAt) {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours >= 48) rate = 0.02;
    else if (ageHours >= 24) rate = 0.03;
  }
  return Math.round(median * rate * 100) / 100;
}
