import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { DEFAULT_RATE_CARD, type ScoutRateCard } from '@/lib/scoutWorksheet';

/**
 * Reads the account owner's Scout rate card (team members see their owner's
 * card read-only). Falls back to sensible defaults when none is saved yet.
 */
export function useScoutRates() {
  const { user, effectiveContractorId, isTeamMember } = useAuth();
  const ownerId = effectiveContractorId ?? user?.id ?? null;
  const [rates, setRates] = useState<ScoutRateCard>(DEFAULT_RATE_CARD);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!ownerId) return;
    setLoading(true);
    const { data } = await supabase
      .from('scout_rate_cards')
      .select('*')
      .eq('contractor_id', ownerId)
      .maybeSingle();
    if (data) {
      const { id, contractor_id, created_at, updated_at, ...rest } = data as any;
      setRates({ ...DEFAULT_RATE_CARD, ...rest } as ScoutRateCard);
      setExists(true);
    } else {
      setRates(DEFAULT_RATE_CARD);
      setExists(false);
    }
    setLoading(false);
  }, [ownerId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (next: ScoutRateCard) => {
    if (!ownerId) throw new Error('No account');
    setSaving(true);
    try {
      const { error } = await supabase
        .from('scout_rate_cards')
        .upsert({ contractor_id: ownerId, ...next }, { onConflict: 'contractor_id' });
      if (error) throw new Error(error.message);
      setRates(next);
      setExists(true);
    } finally {
      setSaving(false);
    }
  }, [ownerId]);

  return { rates, setRates, exists, loading, saving, save, reload: load, canEdit: !isTeamMember };
}
