import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type JobFlag = { summary: string; at: string; count: number };

/** Unseen activity per job (dates confirmed, ground crew claimed, new offers) for this viewer.
 *  Opening a job (openId) marks it seen. */
export function useJobActivity(uid: string | undefined, openId: string | null) {
  const [flags, setFlags] = useState<Record<string, JobFlag>>({});

  const load = useCallback(async () => {
    if (!uid) return;
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [actRes, readRes] = await Promise.all([
      (supabase.from as any)('job_activity').select('bid_request_id, summary, actor_user_id, created_at')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(500),
      (supabase.from as any)('job_activity_reads').select('bid_request_id, seen_at').eq('user_id', uid),
    ]);
    if (actRes.error || readRes.error) return;
    const seen = new Map<string, string>((readRes.data ?? []).map((r: any) => [r.bid_request_id, r.seen_at]));
    const next: Record<string, JobFlag> = {};
    for (const a of (actRes.data ?? []) as any[]) {
      if (a.actor_user_id === uid) continue;
      const s = seen.get(a.bid_request_id);
      if (s && a.created_at <= s) continue;
      const cur = next[a.bid_request_id];
      if (cur) cur.count += 1;
      else next[a.bid_request_id] = { summary: a.summary, at: a.created_at, count: 1 };
    }
    setFlags(next);
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel('job-activity-flags')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_activity' }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, load]);

  // Opening a job clears its flag for this viewer.
  useEffect(() => {
    if (!uid || !openId) return;
    setFlags((f) => { if (!f[openId]) return f; const n = { ...f }; delete n[openId]; return n; });
    (supabase.from as any)('job_activity_reads')
      .upsert({ user_id: uid, bid_request_id: openId, seen_at: new Date().toISOString() }, { onConflict: 'user_id,bid_request_id' })
      .then(() => {});
  }, [uid, openId]);

  return flags;
}
