import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export interface ExpiringCredit {
  amount: number;
  expires_at: string;
  reason_code: string;
}

export interface EngagementData {
  current_streak: number;
  last_purchase_at: string | null;
  flagged_for_outreach: boolean;
}

export interface MetroRank {
  rank: number;
  total_purchases: number;
  total_contractors: number;
}

export function useExpiringCredits() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['expiring-credits', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credit_transactions' as any)
        .select('amount, expires_at, reason_code')
        .eq('contractor_id', user!.id)
        .eq('type', 'win_back')
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as ExpiringCredit[];
    },
    enabled: !!user,
    staleTime: 1000 * 60,
  });
}

export function useEngagement() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['engagement', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contractor_engagement' as any)
        .select('current_streak, last_purchase_at, flagged_for_outreach')
        .eq('contractor_id', user!.id)
        .maybeSingle();

      if (error) throw error;
      return (data || { current_streak: 0, last_purchase_at: null, flagged_for_outreach: false }) as unknown as EngagementData;
    },
    enabled: !!user,
    staleTime: 1000 * 60,
  });
}

export function useMetroRank() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['metro-rank', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_metro_rank', {
        p_contractor_id: user!.id,
      });

      if (error) throw error;
      const row = (data as any)?.[0];
      return {
        rank: Number(row?.rank || 0),
        total_purchases: Number(row?.total_purchases || 0),
        total_contractors: Number(row?.total_contractors || 0),
      } as MetroRank;
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });
}

export function useJustMissedLeads() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['just-missed-leads', user?.id],
    queryFn: async () => {
      // Get leads that have been purchased but not by this user
      const { data: allLeads, error } = await supabase
        .from('leads_secure' as any)
        .select('*')
        .gt('purchase_count', 0)
        .order('last_purchased_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      // Filter out leads this user has purchased
      const { data: myPurchases } = await supabase
        .from('lead_purchases' as any)
        .select('lead_id')
        .eq('contractor_id', user!.id);

      const myLeadIds = new Set((myPurchases || []).map((p: any) => p.lead_id));

      return ((allLeads || []) as any[]).filter((lead: any) => !myLeadIds.has(lead.id));
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 2,
  });
}
