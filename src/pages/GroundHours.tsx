import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/** A ground worker enters the hours they worked on finished jobs. */
export default function GroundHours() {
  const [params] = useSearchParams();
  const focus = params.get('job');
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-ground-hours'],
    queryFn: async () => {
      const { data: rows } = await supabase.from('job_ground_hours')
        .select('id, bid_request_id, hours, pay, created_at').order('created_at', { ascending: false }).limit(30);
      const ids = ((rows ?? []) as any[]).map((r) => r.bid_request_id);
      const { data: jobs } = ids.length
        ? await supabase.from('bid_requests').select('id, title, city').in('id', ids) : { data: [] };
      return ((rows ?? []) as any[]).map((r) => ({ ...r, job: ((jobs ?? []) as any[]).find((j) => j.id === r.bid_request_id) }));
    },
  });
  const rows = (data ?? []).slice().sort((a, b) => (a.bid_request_id === focus ? -1 : b.bid_request_id === focus ? 1 : 0));

  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="text-2xl font-bold">My hours</h1>
      <p className="text-sm text-muted-foreground">Enter how many hours you worked on each finished job so the office can pay you.</p>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : rows.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No finished jobs need your hours right now.</Card>
      ) : rows.map((r) => <HoursCard key={r.id} r={r} onSaved={() => qc.invalidateQueries({ queryKey: ['my-ground-hours'] })} />)}
    </div>
  );
}

function HoursCard({ r, onSaved }: { r: any; onSaved: () => void }) {
  const [v, setV] = useState(r.hours != null ? String(r.hours) : '');
  const [busy, setBusy] = useState(false);
  const n = Number(v);
  const label = `${r.job?.city ?? ''} ${String(r.job?.title ?? 'Job').split(' — ')[0]}`.trim();
  const save = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('ground-hours-submit', { body: { bid_request_id: r.bid_request_id, hours: n } });
    setBusy(false);
    if (error || (data as any)?.error) return toast.error((data as any)?.error ?? 'Could not save your hours');
    toast.success('Thanks — your hours are saved.');
    onSaved();
  };
  return (
    <Card className="p-4 space-y-2">
      <div className="font-semibold">{label}</div>
      {r.hours != null && <div className="text-sm text-muted-foreground">Saved: {r.hours} hours</div>}
      <div className="flex gap-2">
        <Input inputMode="decimal" placeholder="Hours worked" value={v} onChange={(e) => setV(e.target.value)} className="h-10" />
        <Button onClick={save} disabled={busy || !(n > 0 && n <= 24)}>{r.hours != null ? 'Update' : 'Save'}</Button>
      </div>
    </Card>
  );
}
