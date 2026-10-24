import { useEffect, useState } from 'react';
import { CalendarOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCompanySettings, useSaveCompanySettings } from '@/hooks/useCompanySettings';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekdays the company doesn't work. Climbers and ground crew can't pick them. */
export function ClosedDaysCard() {
  const { data: settings } = useCompanySettings();
  const save = useSaveCompanySettings();
  const saved = ((settings as any)?.closed_weekdays ?? []) as number[];
  const [days, setDays] = useState<number[]>(saved);
  useEffect(() => { setDays(saved); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [saved.join(',')]);
  const dirty = [...days].sort().join(',') !== [...saved].sort().join(',');

  return (
    <Card className="p-4 mt-8 space-y-3">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2"><CalendarOff className="w-5 h-5 text-primary" />Days we're closed</h2>
        <p className="text-sm text-muted-foreground">Climbers and ground crew can't pick these days for your jobs.</p>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {DAYS.map((label, i) => {
          const on = days.includes(i);
          return (
            <button key={label} type="button" aria-pressed={on}
              onClick={() => setDays((d) => (on ? d.filter((x) => x !== i) : [...d, i]))}
              className={cn('rounded-md border py-2 text-sm font-medium',
                on ? 'bg-destructive/15 border-destructive text-destructive line-through' : 'bg-background hover:bg-muted')}>
              {label}
            </button>
          );
        })}
      </div>
      <Button size="sm" disabled={!dirty || save.isPending}
        onClick={() => save.mutate({ closed_weekdays: days } as any, {
          onSuccess: () => toast.success('Closed days saved'),
          onError: () => toast.error('Only the account owner can change this'),
        })}>
        {save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Save closed days
      </Button>
    </Card>
  );
}
