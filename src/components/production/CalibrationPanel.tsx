import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target } from 'lucide-react';
import { useProductionConfig } from '@/hooks/useProductionConfig';
import { summarize, type ActualJob } from '@/lib/production/calibration';
import { CalibrationWizard } from './CalibrationWizard';

export const CALIBRATION_INTRO = "Show Scout a few tree-removal jobs you've already completed. Scout will estimate how it thinks the job would be performed, then you can tell Scout how your company actually did it. This helps Scout understand how your crews work.";

export function CalibrationPanel({ autoOpen = false }: { autoOpen?: boolean }) {
  const { ownerId, data: conf } = useProductionConfig();
  const [open, setOpen] = useState(autoOpen);
  const { data, refetch } = useQuery({
    queryKey: ['calibrations', ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const db = supabase as any;
      const [c, p] = await Promise.all([
        db.from('production_calibrations').select('id, predicted_plan, actual_method, actual_crew, actual_duration_hours, actual_equipment, actual_loads, status').eq('contractor_id', ownerId).eq('status', 'completed'),
        db.from('production_pricing_history').select('sold_price').eq('contractor_id', ownerId),
      ]);
      return { cals: c.data ?? [], prices: (p.data ?? []).map((x: any) => Number(x.sold_price)) as number[] };
    },
  });

  const records = (data?.cals ?? []).map((r: any) => ({
    predicted_plan: r.predicted_plan,
    actual: { method: r.actual_method, crew: r.actual_crew ?? [], durationHours: Number(r.actual_duration_hours ?? 0), equipment: r.actual_equipment ?? [], loads: r.actual_loads } as ActualJob,
  }));
  const s = summarize(records);
  const n = s.jobs;
  const eqName = (k: string) => conf?.equipment.find((e) => e.equipment_key === k)?.name ?? k;
  const avgPrice = data?.prices.length ? Math.round(data.prices.reduce((a, b) => a + b, 0) / data.prices.length) : null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Target className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Calibrate Scout to your company</div>
          <p className="text-xs text-muted-foreground">{CALIBRATION_INTRO}</p>
        </div>
      </div>
      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <div className="font-bold">{n} completed job{n === 1 ? '' : 's'}</div>
        {n < 5
          ? <div className="text-xs text-muted-foreground">Recommended starting point: 5 jobs</div>
          : <div className="text-xs"><strong>Good starting profile.</strong> You can keep adding completed jobs anytime to give Scout more information about how your company works.</div>}
      </div>

      {n >= 2 && (
        <div className="text-sm space-y-1">
          <div className="font-semibold">What Scout has learned so far</div>
          {s.avgPredDuration != null && s.avgActDuration != null && <div>Average duration: Scout {s.avgPredDuration} hr · Actual {s.avgActDuration} hr</div>}
          {s.avgPredPersonHours != null && s.avgActPersonHours != null && <div>Average person-hours: Scout {s.avgPredPersonHours} · Actual {s.avgActPersonHours}</div>}
          {s.commonPredGround != null && s.commonActGround != null && <div>Most common ground crew: Scout {s.commonPredGround} · You {s.commonActGround}</div>}
          {s.equipment.filter((e) => e.predicted || e.used).map((e) => (
            <div key={e.key}>{eqName(e.key)}: predicted {e.predicted} of {n} · used {e.used} of {n}</div>
          ))}
          <div className="text-[11px] text-muted-foreground">Scout doesn't change its estimates from this yet. It's saved so future versions can learn from similar jobs.</div>
        </div>
      )}
      {avgPrice != null && (data?.prices.length ?? 0) >= 2 && (
        <div className="text-sm border-t pt-2">
          <div className="font-semibold">Pricing history</div>
          <div>Average selling price: ${avgPrice.toLocaleString()} ({data!.prices.length} jobs)</div>
        </div>
      )}

      <Button className="w-full" onClick={() => setOpen(true)}>{n === 0 ? 'Start calibration' : 'Add a completed job'}</Button>
      <CalibrationWizard open={open} onOpenChange={setOpen} onSaved={() => refetch()} />
    </Card>
  );
}
