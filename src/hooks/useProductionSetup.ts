import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { functionFailure } from '@/lib/functionFailure';
import { productionDb, newDraftDefinition, DEFAULT_BASICS, type CardRow, type SettingsRow } from '@/lib/production/client';
import type { Finding, RateCardDefinition } from '@/lib/production/rules';

export interface TeamMember { user_id: string; email: string; seat_type: string | null; permissions: Record<string, boolean> }

export interface ImportResult { definition: RateCardDefinition; findings: Finding[]; warnings: string[] }

// Draft and settings saves still on their way to the database. A read waits for them, so the setup page opened
// again right after an edit (leaving it saves what's pending) reads what was saved, never the copy from before.
const pendingSaves = new Set<Promise<unknown>>();
function trackSave(write: PromiseLike<{ error: unknown }>): Promise<{ error: unknown }> {
  const p = Promise.resolve(write);
  pendingSaves.add(p);
  const done = () => { pendingSaves.delete(p); };
  p.then(done, done);
  return p;
}

/** Settings, the draft card, the published versions and the team, for Settings > Crews & pricing. */
export function useProductionSetup(enabled: boolean) {
  const { effectiveContractorId, user } = useAuth();
  const owner = effectiveContractorId ?? user?.id ?? null;
  const qc = useQueryClient();
  const key = ['production-setup', owner];

  const q = useQuery({
    queryKey: key,
    enabled: enabled && !!owner,
    // The page edits a copy of the draft and loads it only from a read made after it opened (isFetchedAfterMount):
    // the cached copy can be older than what was saved since.
    refetchOnMount: 'always',
    queryFn: async () => {
      if (pendingSaves.size) await Promise.allSettled([...pendingSaves]);
      const [s, c, m] = await Promise.all([
        productionDb.from('production_settings').select('*').eq('contractor_id', owner).maybeSingle(),
        productionDb.from('production_rate_cards').select('id,label,branch_key,status,version,effective_from,published_at,definition,updated_at')
          .eq('contractor_id', owner).order('created_at', { ascending: false }),
        productionDb.from('team_member_access').select('user_id,email,seat_type,permissions,status,member_kind')
          .eq('owner_id', owner).eq('status', 'active').eq('member_kind', 'employee'),
      ]);
      if (s.error) throw s.error;
      if (c.error) throw c.error;
      const cards = (c.data ?? []) as CardRow[];
      return {
        settings: (s.data ?? null) as SettingsRow | null,
        draft: cards.find((x) => x.status === 'draft' && x.branch_key === null) ?? null,
        published: cards.filter((x) => x.status !== 'draft').sort((a, b) => (b.version ?? 0) - (a.version ?? 0)),
        members: ((m.data ?? []) as (TeamMember & { user_id: string | null })[]).filter((x) => !!x.user_id) as TeamMember[],
      };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: key });

  /** Starts the setup: the settings row, and a draft from the latest published card or the starter card. */
  const ensure = async () => {
    if (!owner) return;
    if (!q.data?.settings) {
      const { error } = await productionDb.from('production_settings').insert({ contractor_id: owner, basics: DEFAULT_BASICS });
      if (error && (error as { code?: string }).code !== '23505') throw error;
    }
    if (!q.data?.draft) {
      const latest = q.data?.published.find((x) => x.status === 'published') ?? null;
      const { error } = await productionDb.from('production_rate_cards').insert({
        contractor_id: owner, status: 'draft', label: latest?.label ?? '', based_on: latest?.id ?? null,
        definition: newDraftDefinition(latest?.definition ?? null),
      });
      if (error && (error as { code?: string }).code !== '23505') throw error;
    }
    await refresh();
    await qc.invalidateQueries({ queryKey: ['production-status'] });
  };

  const saveDefinition = async (cardId: string, definition: RateCardDefinition, label?: string) => {
    const patch: Record<string, unknown> = { definition };
    if (label !== undefined) patch.label = label;
    const { error } = await trackSave(productionDb.from('production_rate_cards').update(patch).eq('id', cardId).eq('status', 'draft'));
    if (error) throw error;
  };

  const saveSettings = async (patch: Partial<SettingsRow>) => {
    if (!owner) return;
    const { error } = await trackSave(productionDb.from('production_settings').update(patch).eq('contractor_id', owner));
    if (error) throw error;
  };

  const invoke = async <T,>(fn: string, body: Record<string, unknown>): Promise<T> => {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    const failure = await functionFailure(error, data);
    if (failure) throw new Error(failure.message);
    return data as T;
  };

  const importSheet = (input: { text?: string; images?: string[]; pdf?: string }) =>
    invoke<ImportResult & { ok: true }>('production-ai', { action: 'import_sheet', ...input });

  const publish = async (input: { cardId: string; effectiveFrom: string; label?: string; skipReason?: string }) => {
    const r = await invoke<{ ok: true; version: number }>('production-setup', { action: 'publish', ...input });
    await refresh();
    await qc.invalidateQueries({ queryKey: ['production-status'] });
    return r;
  };

  return { ...q, owner, ensure, saveDefinition, saveSettings, importSheet, publish, refresh };
}
