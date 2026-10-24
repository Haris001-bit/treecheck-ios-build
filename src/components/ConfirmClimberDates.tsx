import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useJobberFreeDays } from '@/hooks/useJobberFreeDays';

export const todayISO = () => format(new Date(), 'yyyy-MM-dd');
export const isPassed = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < todayISO();
export const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

/** Weekdays (0=Sun) the job's company is closed. */
export function useJobClosedWeekdays(requestId: string) {
  return useQuery({
    queryKey: ['job-closed-weekdays', requestId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)('job_closed_weekdays', { p_request_ids: [requestId] });
      return ((data?.[0]?.closed_weekdays ?? []) as number[]).map(Number);
    },
  });
}

/** Pick-your-days grid for the awarded climber (or the office on their behalf).
 *  `locked` days already have ground crew hired: always kept, can't be untapped.
 *  Days the company is closed, and days already booked in Jobber, are greyed out. */
export function ConfirmClimberDates({
  requestId, suggested, cta = 'Confirm my days', onDone, locked = [],
}: { requestId: string; suggested: string[]; cta?: string; onDone?: () => void; locked?: string[] }) {
  const qc = useQueryClient();
  const { data: closed = [] } = useJobClosedWeekdays(requestId);
  const { data: blocked } = useJobberFreeDays(requestId);
  const days = useMemo(() => Array.from({ length: 28 }, (_, i) => format(addDays(new Date(), i), 'yyyy-MM-dd')), []);
  const lockedFuture = locked.filter((d) => !isPassed(d));
  const isClosed = (d: string) => closed.includes(weekdayOf(d));
  const isBooked = (d: string) => blocked?.get(d) === 'busy';
  const [picked, setPicked] = useState<string[]>(() =>
    [...new Set([...suggested, ...lockedFuture])].filter((d) => days.includes(d)));
  // Once closed days load, drop any suggested closed day (hired days stay).
  useEffect(() => {
    if (!closed.length) return;
    setPicked((p) => p.filter((d) => !closed.includes(weekdayOf(d)) || lockedFuture.includes(d)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed.join(',')]);
  // Once Jobber's booked days load, drop any suggested booked day (hired days stay).
  useEffect(() => {
    if (!blocked?.size) return;
    setPicked((p) => p.filter((d) => blocked.get(d) !== 'busy' || lockedFuture.includes(d)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);
  const closedSuggested = suggested.filter((d) => !isPassed(d) && isClosed(d) && !lockedFuture.includes(d));
  const bookedSuggested = suggested.filter((d) => !isPassed(d) && !isClosed(d) && isBooked(d) && !lockedFuture.includes(d));
  const [saving, setSaving] = useState(false);
  const toggle = (d: string) => {
    if (lockedFuture.includes(d)) return toast.info('Ground crew is already hired for this day. Ask the office to move it.');
    if (isClosed(d)) return toast.info('The company is closed that day.');
    if (isBooked(d)) return toast.info('That day is already booked in Jobber.');
    setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  };

  const save = async () => {
    if (!picked.length) return toast.error('Pick at least one day');
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('bid-climber-dates', {
      body: { bid_request_id: requestId, dates: picked },
    });
    setSaving(false);
    if (error || (data as any)?.error) return toast.error((data as any)?.error || error?.message || "Couldn't save the days");
    toast.success('Days saved. The office has been told.');
    ['bid-requests', 'crew-inbox', 'job-dispatches'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onDone?.();
  };

  return (
    <div className="space-y-2">
      {closedSuggested.length > 0 && (
        <p className="text-xs text-destructive">
          {closedSuggested.map((d) => format(parseISO(d), 'EEE MMM d')).join(', ')} fall on a day the company is closed and can't be used.
        </p>
      )}
      {bookedSuggested.length > 0 && (
        <p className="text-xs text-destructive">
          {bookedSuggested.map((d) => format(parseISO(d), 'EEE MMM d')).join(', ')} {bookedSuggested.length === 1 ? 'is' : 'are'} already booked in Jobber and can't be used.
        </p>
      )}
      <div className="grid grid-cols-4 gap-1.5">
        {days.map((d) => {
          const on = picked.includes(d);
          const isLocked = lockedFuture.includes(d);
          const shut = isClosed(d) && !isLocked;
          const booked = isBooked(d) && !isLocked && !shut;
          return (
            <button key={d} type="button" onClick={() => toggle(d)} disabled={shut || booked}
              className={cn('rounded-md border px-1 py-1.5 text-xs leading-tight',
                on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted',
                isLocked && 'opacity-80',
                (shut || booked) && 'opacity-40 line-through cursor-not-allowed hover:bg-background')}>
              <div className="font-medium flex items-center justify-center gap-0.5">
                {isLocked && <Lock className="w-3 h-3" />}{format(parseISO(d), 'EEE')}
              </div>
              <div>{shut ? 'Closed' : booked ? 'Booked' : format(parseISO(d), 'MMM d')}</div>
            </button>
          );
        })}
      </div>
      {lockedFuture.length > 0 && (
        <p className="text-xs text-muted-foreground">Locked days already have ground crew hired. Ask the office to move them.</p>
      )}
      <Button size="sm" className="w-full" onClick={save} disabled={saving || !picked.length}>
        {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}{cta}{picked.length ? ` (${picked.length})` : ''}
      </Button>
    </div>
  );
}
