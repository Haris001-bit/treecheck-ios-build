import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Jobs added in this window count as "new" until the viewer opens them. */
export const NEW_JOB_WINDOW_DAYS = 14;

export const isRecentJob = (createdAt: string | null | undefined) =>
  !!createdAt && Date.parse(createdAt) >= Date.now() - NEW_JOB_WINDOW_DAYS * 86400_000;

/** Which jobs this viewer has opened; opening a job (openId) records it. */
export function useJobViews(uid: string | undefined, openId: string | null) {
  const [seen, setSeen] = useState<Set<string> | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data } = await (supabase.from as any)('job_views').select('bid_request_id').eq('user_id', uid);
    setSeen(new Set((data ?? []).map((r: any) => r.bid_request_id as string)));
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!uid || !openId) return;
    setSeen((s) => { if (!s || s.has(openId)) return s; const n = new Set(s); n.add(openId); return n; });
    (supabase.from as any)('job_views')
      .upsert({ user_id: uid, bid_request_id: openId, seen_at: new Date().toISOString() }, { onConflict: 'user_id,bid_request_id' })
      .then(() => {});
  }, [uid, openId]);

  return seen;
}
