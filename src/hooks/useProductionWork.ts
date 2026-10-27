import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { functionFailure } from '@/lib/functionFailure';
import { productionDb, type SettingsRow } from '@/lib/production/client';
import { parseDefinition, type RateCardDefinition } from '@/lib/production/rules';
import { today } from '@/components/production/setup/types';

export async function productionCall<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  const failure = await functionFailure(error, data);
  if (failure) throw new Error(failure.message);
  return data as T;
}

/** The rate card in force today (the latest published one) and the company's settings, for estimates and crew work. */
export function useProductionCard(enabled: boolean) {
  const { effectiveContractorId, user } = useAuth();
  const owner = effectiveContractorId ?? user?.id ?? null;
  return useQuery({
    queryKey: ['production-card', owner],
    enabled: enabled && !!owner,
    staleTime: 60_000,
    queryFn: async () => {
      const [c, s] = await Promise.all([
        productionDb.from('production_rate_cards').select('id, version, label, branch_key, effective_from, definition')
          .eq('contractor_id', owner).eq('status', 'published').order('effective_from', { ascending: false }).order('version', { ascending: false }),
        productionDb.from('production_settings').select('*').eq('contractor_id', owner).maybeSingle(),
      ]);
      const rows = (c.data ?? []) as { id: string; version: number; label: string; branch_key: string | null; effective_from: string; definition: unknown }[];
      const card = rows.find((r) => r.branch_key === null && r.effective_from <= today()) ?? null;
      const parsed = card ? parseDefinition(card.definition) : null;
      return {
        card,
        def: parsed && parsed.kind === 'ok' ? (parsed.def as RateCardDefinition) : null,
        settings: (s.data ?? null) as SettingsRow | null,
      };
    },
  });
}

export interface EstimateRow {
  id: string; number: number; status: string; customer: { name?: string; address?: string } | null;
  totals: { total?: number } | null; created_at: string; sent_at: string | null; approved_at: string | null;
}
export interface PacketRow {
  id: string; estimate_id: string; package_key: string; title: string; fulfillment: string; estimate_number: number | null;
  scope: { workItemId: string; tree: string | null; service: string; scope: string; hours: number; equipment: string[]; access: string | null; gate: string | null; utility: string | null; vendor: string | null; hazards: string | null; photos: string[] }[];
  customer: { name?: string | null; phone?: string | null; address?: string | null; gateCode?: string | null; accessNotes?: string | null };
  crew: { template?: string | null; headcount?: number };
  est_hours: number | null; est_crew_hours: number | null; est_man_hours: number | null;
  resources: { key: string; hours: number }[];
  scheduling_class: string; promised_window?: { from?: string | null; to?: string | null } | null;
  depends_on: string[]; status: string; planned_date: string | null; scheduled_date: string | null; completed_at?: string | null;
  crew_leader_id: string | null; jobber_job_id?: string | null; jobber_job_number?: string | null; tasks: { key: string; kind: string; title: string; status: string; dueAt?: string | null }[];
  actuals: { headcount?: number; hours?: number; manHours?: number; equipment?: Record<string, number>; expenses?: number | null; factors?: string[]; notes?: string } | null;
  updated_at: string;
}

export interface WorkReply { ok: true; updatedAt?: string; outcome?: string; jobs?: { id: string; jobNumber: string | null }[] }

/** Estimates (sales and office), production packets (office, and each crew leader's own) and who can lead jobs. */
export function useProductionWork(opts: { estimates: boolean; packets: boolean; leaders: boolean }) {
  const { effectiveContractorId, user } = useAuth();
  const owner = effectiveContractorId ?? user?.id ?? null;
  const qc = useQueryClient();
  const estimates = useQuery({
    queryKey: ['production-estimates', owner],
    enabled: opts.estimates && !!owner,
    queryFn: async () => {
      const { data, error } = await productionDb.from('production_estimates')
        .select('id, number, status, customer, totals, created_at, sent_at, approved_at').eq('contractor_id', owner).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as EstimateRow[];
    },
  });
  const packets = useQuery({
    queryKey: ['production-packets', owner],
    enabled: opts.packets && !!owner,
    queryFn: async () => {
      const { data, error } = await productionDb.from('production_packets').select('*').eq('contractor_id', owner).order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      return (data ?? []) as PacketRow[];
    },
  });
  const leaders = useQuery({
    queryKey: ['production-leaders', owner],
    enabled: opts.leaders && !!owner,
    staleTime: 60_000,
    queryFn: async () => (await productionCall<{ leaders: { id: string; email: string; name?: string | null; owner?: boolean }[] }>('production-work', { action: 'leaders' })).leaders,
  });
  const work = async (body: Record<string, unknown>) => {
    const r = await productionCall<WorkReply>('production-work', body);
    await qc.invalidateQueries({ queryKey: ['production-packets'] });
    return r;
  };
  return { estimates, packets, leaders, work };
}
