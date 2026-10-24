import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Job = { id: string; title: string; city: string | null; customer_name: string | null; customer_phone: string | null; customer_address: string | null; awarded_date?: string | null };
const FIELDS = [
  ['title', 'Job name'], ['customer_name', 'Customer name'], ['customer_phone', 'Customer phone'],
  ['customer_address', 'Street address'], ['city', 'City'],
] as const;

export function EditJobInfoDialog({ job, open, onOpenChange }: { job: Job | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState('');

  useEffect(() => {
    if (job) setF(Object.fromEntries(FIELDS.map(([k]) => [k, (job as any)[k] ?? ''])));
  }, [job]);

  if (!job) return null;

  const save = async () => {
    if (!f.title?.trim()) return toast.error('Job name is required');
    setSaving(true);
    const payload = Object.fromEntries(FIELDS.map(([k]) => [k, f[k]?.trim() || (k === 'title' ? f.title.trim() : null)]));
    (payload as any).awarded_date = date || null;
    const { error, count } = await supabase.from('bid_requests').update(payload as any, { count: 'exact' }).eq('id', job.id);
    setSaving(false);
    if (error || !count) return toast.error("Couldn't save the job details");
    if ((date || null) !== (job.awarded_date ?? null)) {
      await supabase.from('job_dispatches').update({ scheduled_date: date || null, awarded_date: date || null } as any)
        .eq('bid_request_id', job.id).neq('status', 'open');
      await supabase.from('job_dispatches').update({ scheduled_date: date || null } as any)
        .eq('bid_request_id', job.id).eq('status', 'open').is('offered_dates', null);
    }
    toast.success('Job details updated');
    qc.invalidateQueries({ queryKey: ['job-dispatches'] });
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit job details</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {FIELDS.map(([k, label]) => (
            <div key={k}>
              <Label htmlFor={`job-${k}`}>{label}</Label>
              <Input id={`job-${k}`} type={k === 'customer_phone' ? 'tel' : 'text'} value={f[k] ?? ''}
                onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </div>
          ))}
          <div>
            <Label htmlFor="job-date">Scheduled date</Label>
            <Input id="job-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Leave empty if not scheduled yet. Crew aren't texted about the change.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
