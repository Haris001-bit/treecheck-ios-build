import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useJobClosedWeekdays, weekdayOf } from '@/components/ConfirmClimberDates';

/** Office buttons on a ground crew call-out: change the date, or send an urgent re-call. */
export function DispatchActions({ dispatch }: { dispatch: any }) {
  const qc = useQueryClient();
  const { data: closed = [] } = useJobClosedWeekdays(dispatch.bid_request_id);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (action: 'reschedule' | 'nudge') => {
    setBusy(action);
    const { data, error } = await supabase.functions.invoke('job-dispatch-reschedule', {
      body: { dispatch_id: dispatch.id, action, new_date: date },
    });
    setBusy(null);
    if (error || data?.error) return toast.error(data?.error ?? 'Something went wrong');
    toast.success(action === 'reschedule'
      ? `Date changed. ${data.told} crew told, call-out sent to ${data.resent} more.`
      : `Urgent call-out sent to ${data.resent} ground worker${data.resent === 1 ? '' : 's'}.`);
    qc.invalidateQueries({ queryKey: ['job-dispatches'] });
    qc.invalidateQueries({ queryKey: ['bid-requests'] });
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Change date</Button>
      {dispatch.status === 'open' && (
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('nudge')}>
          {busy === 'nudge' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Send urgent call-out
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change the job date</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dispatch-new-date">New date</Label>
            <Input id="dispatch-new-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            {date && closed.includes(weekdayOf(date)) && (
              <p className="text-xs text-destructive">You're closed that day of the week. Pick another date.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Anyone already hired or lined up gets a text about the change and must pick the new day to keep their spot.
              The call-out is then re-sent to the other ground workers.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!date || !!busy || closed.includes(weekdayOf(date))} onClick={() => run('reschedule')}>
              {busy === 'reschedule' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Change date & notify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
