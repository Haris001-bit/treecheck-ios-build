import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { productionDb, type ProductionStatus } from '@/lib/production/client';
import { computeReports, type Report } from '@/lib/production/reports';
import type { RateCardDefinition } from '@/lib/production/rules';
import type { PacketRow } from '@/hooks/useProductionWork';
import { toReportEstimate, toReportPacket, type ReportEstimateRow } from '@/components/production/jobs/reportRows';

/**
 * The learning loop's numbers for Jobs > Crew work: estimates (price layer), packets with actual hours, and estimated
 * costs only for cost viewers. Each read is limited by the tables' own rules as well.
 */
export function useProductionReport(status: ProductionStatus, def: RateCardDefinition | null, packets: PacketRow[]): { report: Report; isLoading: boolean } {
  const { effectiveContractorId, user } = useAuth();
  const owner = effectiveContractorId ?? user?.id ?? null;
  const can = status.can;
  const estimates = useQuery({
    queryKey: ['production-report-estimates', owner],
    enabled: !!owner && status.published && can.price,
    queryFn: async () => {
      const { data, error } = await productionDb.from('production_estimates')
        .select('id, status, salesperson_id, sent_at, approved_at, totals, backlog_weeks_at_send, work_items')
        .eq('contractor_id', owner).neq('status', 'draft').order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as ReportEstimateRow[];
    },
  });
  const costs = useQuery({
    queryKey: ['production-report-costs', owner],
    enabled: !!owner && status.published && can.costs && status.started,
    queryFn: async () => {
      const { data } = await productionDb.from('production_estimate_costs').select('estimate_id, totals').eq('contractor_id', owner).limit(1000);
      return ((data ?? []) as { estimate_id: string; totals: { cost?: number } | null }[]).map((c) => ({ estimateId: c.estimate_id, estimatedCost: Number(c.totals?.cost) || 0 }));
    },
  });
  // Salespeople by email for the owner (team_member_access); everyone else sees "You" for themselves.
  const names = useQuery({
    queryKey: ['production-report-names', owner],
    enabled: !!owner && status.published && status.is_owner && can.price,
    queryFn: async () => {
      const { data } = await productionDb.from('team_member_access').select('user_id, email').eq('owner_id', owner);
      return Object.fromEntries(((data ?? []) as { user_id: string | null; email: string }[]).filter((m) => m.user_id).map((m) => [m.user_id as string, m.email]));
    },
  });

  const report = useMemo(() => {
    const crewNames = Object.fromEntries((def?.crews ?? []).map((c) => [c.key, c.name]));
    const who: Record<string, string> = { ...(names.data ?? {}) };
    if (user?.id) who[user.id] = 'You';
    if (owner && !who[owner]) who[owner] = 'Owner';
    return computeReports({
      estimates: (estimates.data ?? []).map((e) => toReportEstimate(e, def, who)),
      packets: packets.map((p) => toReportPacket(p, crewNames)),
      costs: can.costs ? costs.data ?? null : null,
      targetRate: def?.pricing.manHourRate ?? null,
      crewNames,
    });
  }, [estimates.data, costs.data, names.data, packets, def, can.costs, user?.id, owner]);
  return { report, isLoading: estimates.isLoading };
}
