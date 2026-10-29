import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Gift, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { GIVEAWAY_END_LABEL, GIVEAWAY_ID, giveawayOpen } from '@/lib/giveaway';

type Entry = {
  id: string; full_name: string; email: string; phone: string | null; company_name: string | null;
  region: string | null; country: string | null; source: string; status: string; created_at: string; drawn_at: string | null;
};
const COLS = 'id, full_name, email, phone, company_name, region, country, source, status, created_at, drawn_at';

async function allEntries(): Promise<Entry[]> {
  // First count card-checkout signups whose trial has since started (best effort; the list still loads if it fails).
  await supabase.functions.invoke('giveaway-draw', { body: { action: 'refresh' } }).catch(() => null);
  const rows: Entry[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('giveaway_entries').select(COLS)
      .eq('giveaway', GIVEAWAY_ID).order('created_at', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Entry[]));
    if (!data || data.length < 1000) return rows;
  }
}

const SOURCE: Record<string, string> = { 'trial-signup': 'Trial sign-up', 'app-signup': 'Phone app sign-up', 'free-signup': 'Free plan sign-up', 'free-entry': 'Old free entry form' };
const STATUS: Record<string, string> = { entered: 'Entered', awaiting_trial: 'Waiting for the trial to start' };

export default function AdminGiveaway() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [drawing, setDrawing] = useState(false);
  const entries = useQuery({ queryKey: ['giveaway-entries'], queryFn: allEntries, enabled: isAdmin });
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const rows = entries.data ?? [];
  const eligible = rows.filter((r) => r.status === 'entered');
  const drawn = rows.filter((r) => r.drawn_at).sort((a, b) => (a.drawn_at! < b.drawn_at! ? -1 : 1));
  const open = giveawayOpen();

  const draw = async () => {
    setDrawing(true);
    try {
      const { data, error } = await supabase.functions.invoke('giveaway-draw', { body: {} });
      if (data?.error) throw new Error(data.error);
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? 'Could not draw a winner.');
      }
      toast.success(`Drawn: ${data.winner.full_name} (from ${data.pool} eligible entries)`);
      await qc.invalidateQueries({ queryKey: ['giveaway-entries'] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not draw a winner.');
    } finally {
      setDrawing(false);
    }
  };

  const download = () => {
    const head = ['Name', 'Email', 'Phone', 'Company', 'State/Province', 'Country', 'How they entered', 'Status', 'Signed up', 'Drawn'];
    const cell = (v: string | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.full_name, r.email, r.phone, r.company_name, r.region, r.country, SOURCE[r.source] ?? r.source, STATUS[r.status] ?? r.status, r.created_at, r.drawn_at].map(cell).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ripsaw-giveaway-entries.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <Badge variant={open ? 'default' : 'secondary'}>{open ? 'ENTRIES OPEN' : 'ENTRIES CLOSED'}</Badge>
        <h1 className="text-3xl font-black mt-3">Ripsaw RS2511 giveaway</h1>
        <p className="text-muted-foreground mt-1">Entries close {GIVEAWAY_END_LABEL}. Starting the 14-day trial is the entry. Card-checkout and phone app signups count once their trial starts. Check the winner against the Official Rules before confirming.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['Signups', rows.length],
          ['Entered (trial started)', eligible.length],
          ['Waiting for the trial to start', rows.filter((r) => r.status === 'awaiting_trial').length],
          ['Drawn', drawn.length],
        ].map(([label, n]) => (
          <Card key={label as string}><CardContent className="pt-4"><div className="text-2xl font-black">{entries.isLoading ? '…' : n}</div><div className="text-xs text-muted-foreground">{label}</div></CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5 text-primary" />Draw a winner</CardTitle>
          <CardDescription>Picks one entered signup at random. Plan and billing choice don't change anyone's chances. If a winner doesn't reply or isn't eligible, draw again for an alternate.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={draw} disabled={open || drawing || !eligible.length} className="gradient-primary">
            {drawing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {drawn.length ? 'Draw an alternate' : 'Draw a winner'}
          </Button>
          {open && <p className="text-sm text-muted-foreground">You can draw after entries close.</p>}
          {drawn.map((w, i) => (
            <div key={w.id} className="rounded-md border border-border p-3 text-sm">
              <div className="font-semibold">{i === 0 ? 'Winner' : `Alternate ${i}`}: {w.full_name}</div>
              <div className="text-muted-foreground break-all">{w.email}{w.phone ? ` · ${w.phone}` : ''}</div>
              <div className="text-muted-foreground">{[w.company_name, w.region, w.country].filter(Boolean).join(' · ')}</div>
              
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>Entries</CardTitle>
          <Button variant="outline" size="sm" onClick={download} disabled={!rows.length}><Download className="mr-2 h-4 w-4" />Download list</Button>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {entries.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!entries.isLoading && !rows.length && <p className="text-sm text-muted-foreground">No entries yet.</p>}
          {rows.slice(0, 100).map((r) => (
            <div key={r.id} className="py-2 text-sm flex flex-wrap justify-between gap-x-4">
              <span className="font-medium">{r.full_name}</span>
              <span className="text-muted-foreground">{[r.region, r.country].filter(Boolean).join(', ') || 'No state given'} · {STATUS[r.status] ?? r.status} · {new Date(r.created_at).toLocaleDateString()}</span>
            </div>
          ))}
          {rows.length > 100 && <p className="pt-2 text-xs text-muted-foreground">Showing the newest 100. Download the list for all entries.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
