import { SubNetworkSettings } from '@/components/SubNetwork';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMyCrewMemberships } from '@/hooks/useCrew';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CalendarDays, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const DAYS = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 0, label: 'Sun' },
];

function upcomingDays(count = 28) {
  const out: { iso: string; label: string; dow: number }[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    out.push({
      iso: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }),
      dow: d.getDay(),
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export default function CrewAvailability() {
  const { data: memberships, isLoading: loadingCrew } = useMyCrewMemberships();
  const crewIds = useMemo(() => (memberships ?? []).map((m) => m.id), [memberships]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [takingWork, setTakingWork] = useState(true);
  const [weeklyDays, setWeeklyDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [offDates, setOffDates] = useState<string[]>([]);
  const [extraDates, setExtraDates] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const days = useMemo(() => upcomingDays(), []);

  useEffect(() => {
    if (loadingCrew) return;
    if (!crewIds.length) { setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from('crew_availability')
        .select('*')
        .in('crew_member_id', crewIds)
        .order('updated_at', { ascending: false })
        .limit(1);
      const row = data?.[0] as any;
      if (row) {
        setTakingWork(row.taking_work !== false);
        setWeeklyDays(Array.isArray(row.weekly_days) ? row.weekly_days : [1, 2, 3, 4, 5]);
        setOffDates(Array.isArray(row.unavailable_dates) ? row.unavailable_dates : []);
        setExtraDates(Array.isArray(row.available_dates) ? row.available_dates : []);
        setNotes(row.notes ?? '');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingCrew, crewIds.join(',')]);

  const toggleWeekday = (n: number) =>
    setWeeklyDays((w) => (w.includes(n) ? w.filter((x) => x !== n) : [...w, n]));

  const toggleDay = (iso: string, normallyWorking: boolean) => {
    if (normallyWorking) {
      setOffDates((o) => (o.includes(iso) ? o.filter((x) => x !== iso) : [...o, iso]));
    } else {
      setExtraDates((a) => (a.includes(iso) ? a.filter((x) => x !== iso) : [...a, iso]));
    }
  };

  const save = async () => {
    if (!crewIds.length) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('crew_availability').upsert(
        crewIds.map((id) => ({
          crew_member_id: id,
          weekly_days: weeklyDays,
          taking_work: takingWork,
          unavailable_dates: offDates,
          available_dates: extraDates,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'crew_member_id' },
      );
      if (error) throw error;
      toast.success('Availability saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save your availability');
    } finally {
      setSaving(false);
    }
  };

  if (loadingCrew || loading) {
    return (
      <div className="p-6 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading your availability…
      </div>
    );
  }

  if (!crewIds.length) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-8 text-center text-muted-foreground">
          You're not part of a crew network yet, so there's nothing to set here.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays className="w-6 h-6 text-primary" />
          My availability
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Keep this current and you'll only get asked about jobs you can actually take.
        </p>
      </div>

      <SubNetworkSettings />

      <Card className="p-4 flex items-center justify-between gap-4">
        <div>
          <div className="font-medium">{takingWork ? 'Available for work' : 'Not taking work right now'}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Turn this off while you're on vacation or already booked out. Nobody will send you jobs.
          </div>
        </div>
        <Switch checked={takingWork} onCheckedChange={setTakingWork} />
      </Card>

      <Card className="p-4">
        <Label>Days you normally work</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {DAYS.map((d) => (
            <Button
              key={d.n}
              type="button"
              size="sm"
              variant={weeklyDays.includes(d.n) ? 'default' : 'outline'}
              onClick={() => toggleWeekday(d.n)}
            >
              {d.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <Label>Next four weeks</Label>
        <p className="text-xs text-muted-foreground mt-0.5 mb-2">
          Tap a day to flip it. Green means you can work, grey means you can't.
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {days.map((d) => {
            const normallyWorking = weeklyDays.includes(d.dow);
            const free = normallyWorking ? !offDates.includes(d.iso) : extraDates.includes(d.iso);
            return (
              <Button
                key={d.iso}
                type="button"
                size="sm"
                variant={free ? 'default' : 'outline'}
                className="justify-start text-xs"
                onClick={() => toggleDay(d.iso, normallyWorking)}
              >
                {d.label}
              </Button>
            );
          })}
        </div>
      </Card>

      <Card className="p-4">
        <Label htmlFor="avail-notes">Notes for the company (optional)</Label>
        <Textarea
          id="avail-notes"
          rows={2}
          className="mt-1.5"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Mornings only on Fridays, out of town the last week of the month"
        />
      </Card>

      <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
        {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Saving…</> : 'Save availability'}
      </Button>
    </div>
  );
}
