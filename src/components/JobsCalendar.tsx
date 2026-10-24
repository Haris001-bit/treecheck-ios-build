import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type CalRow = {
  bid_request_id: string; title: string | null; customer_name: string | null; customer_address: string | null;
  city: string | null; workflow_status: string | null; day: string; kind: 'scheduled' | 'completed';
};

const label = (s: string | null) => (s ?? 'open').replace(/_/g, ' ');

export const jobMatches = (q: string, ...fields: (string | null | undefined)[]) => {
  const t = q.trim().toLowerCase();
  return !t || fields.some((f) => (f ?? '').toLowerCase().includes(t));
};

/** Calendar of scheduled/completed jobs. Crews only get jobs they were hired for (enforced in SQL). */
export function JobsCalendar({ onPick, withSearch = false }: { onPick: (id: string) => void; withSearch?: boolean }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Date | undefined>(new Date());
  const [q, setQ] = useState('');
  const { data: rows = [] } = useQuery({
    queryKey: ['calendar-jobs'],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('calendar_jobs');
      return (data ?? []) as CalRow[];
    },
  });
  const scheduled = useMemo(() => rows.filter((r) => r.kind === 'scheduled').map((r) => parseISO(r.day)), [rows]);
  const completed = useMemo(() => rows.filter((r) => r.kind === 'completed').map((r) => parseISO(r.day)), [rows]);
  const key = day ? format(day, 'yyyy-MM-dd') : '';
  const list = useMemo(() => {
    const src = q.trim()
      ? rows.filter((r) => jobMatches(q, r.customer_name, r.customer_address, r.city, r.title))
      : rows.filter((r) => r.day === key);
    const seen = new Map<string, CalRow>();
    for (const r of src) if (!seen.has(r.bid_request_id + r.kind)) seen.set(r.bid_request_id + r.kind, r);
    return [...seen.values()].sort((a, b) => b.day.localeCompare(a.day));
  }, [rows, key, q]);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} aria-label="Jobs calendar">
        <CalendarDays className="w-4 h-4" /><span className="ml-1">Calendar</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Jobs calendar</DialogTitle></DialogHeader>
          {withSearch && <Input placeholder="Search name, street or city" value={q} onChange={(e) => setQ(e.target.value)} />}
          {!q.trim() && (
            <Calendar mode="single" selected={day} onSelect={setDay} className="p-3 pointer-events-auto mx-auto"
              modifiers={{ scheduled, completed }}
              modifiersClassNames={{ scheduled: 'underline decoration-primary decoration-2 underline-offset-4 font-bold', completed: 'text-muted-foreground line-through' }} />
          )}
          <p className="text-xs text-muted-foreground">Underlined = scheduled · crossed out = completed</p>
          <div className="space-y-2">
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">{q.trim() ? 'No matching jobs.' : 'No jobs on this day.'}</p>
            ) : list.map((r) => (
              <button key={r.bid_request_id + r.kind} onClick={() => { setOpen(false); onPick(r.bid_request_id); }}
                className="w-full text-left rounded-md border border-border p-3 hover:bg-secondary">
                <div className="font-semibold text-sm">{r.customer_name || r.title || 'Job'}</div>
                <div className="text-xs text-muted-foreground">{[r.customer_address, r.city].filter(Boolean).join(', ')}</div>
                <div className="text-xs mt-1">{r.kind === 'completed' ? 'Completed' : 'Scheduled'} {format(parseISO(r.day), 'MMM d')} · {label(r.workflow_status)}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
