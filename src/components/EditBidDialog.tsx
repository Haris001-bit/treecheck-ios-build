import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Bid } from '@/hooks/useCrew';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type Fields = {
  min_pay: string; ideal_pay: string; crew_size: string; est_hours: string;
  est_disposal_loads: string; ground_crew_size: string; mini_skid: string; mini_skid_hours: string; equipment: string; notes: string;
};

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function EditBidDialog({ bid, crewName, open, onOpenChange }: {
  bid: Bid | null; crewName: string; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Fields | null>(null);
  const [saving, setSaving] = useState(false);
  const isStump = bid?.bid_role === 'stump';

  useEffect(() => {
    if (!bid) return;
    setF({
      min_pay: s(bid.min_pay), ideal_pay: s(bid.ideal_pay),
      crew_size: s(bid.people_count ?? bid.crew_size), est_hours: s(bid.est_hours),
      est_disposal_loads: s(bid.est_disposal_loads), ground_crew_size: s(bid.ground_crew_size),
      mini_skid: bid.needs_mini_skid == null ? '' : bid.needs_mini_skid ? 'yes' : 'no', mini_skid_hours: s(bid.mini_skid_hours),
      equipment: s(bid.equipment), notes: s(bid.notes),
    });
  }, [bid]);

  if (!bid || !f) return null;
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = async () => {
    const min = num(f.min_pay);
    const ideal = isStump ? min : num(f.ideal_pay);
    if (min == null || !Number.isFinite(min) || min < 0) return toast.error('Enter a valid minimum pay');
    if (ideal == null || !Number.isFinite(ideal) || ideal < min) return toast.error('Ideal pay must be at least the minimum');
    const nums = ['crew_size', 'est_hours', 'est_disposal_loads', 'ground_crew_size', 'mini_skid_hours'] as const;
    for (const k of nums) {
      const v = num(f[k]);
      if (v != null && (!Number.isFinite(v) || v < 0)) return toast.error('Numbers can’t be negative');
    }
    const crew = num(f.crew_size);
    setSaving(true);
    const { error } = await supabase.from('bids').update({
      min_pay: min, ideal_pay: ideal,
      crew_size: crew == null ? null : Math.round(crew),
      people_count: crew == null ? null : Math.round(crew),
      est_hours: num(f.est_hours),
      est_disposal_loads: num(f.est_disposal_loads) == null ? null : Math.round(num(f.est_disposal_loads)!),
      ground_crew_size: num(f.ground_crew_size) == null ? null : Math.round(num(f.ground_crew_size)!),
      needs_mini_skid: f.mini_skid === '' ? null : f.mini_skid === 'yes',
      mini_skid_hours: f.mini_skid === 'yes' ? (num(f.est_hours) ?? null) : null,
      equipment: f.equipment.trim() || null,
      notes: f.notes.trim() || null,
    }).eq('id', bid.id);
    setSaving(false);
    if (error) return toast.error(`Couldn’t save: ${error.message}`);
    toast.success('Offer updated — prices recalculated');
    qc.invalidateQueries({ queryKey: ['bids'] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit {crewName}’s offer</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{isStump ? 'Stump price' : 'Minimum pay'}</Label><Input type="number" inputMode="decimal" value={f.min_pay} onChange={set('min_pay')} /></div>
          {!isStump && <div><Label>Ideal pay</Label><Input type="number" inputMode="decimal" value={f.ideal_pay} onChange={set('ideal_pay')} /></div>}
          {!isStump && <>
            <div><Label>Job length (hours)</Label><Input type="number" inputMode="decimal" value={f.est_hours} onChange={set('est_hours')} /></div>
            <div><Label>Disposal loads</Label><Input type="number" inputMode="numeric" value={f.est_disposal_loads} onChange={set('est_disposal_loads')} /></div>
            <div><Label>Ground crew size</Label><Input type="number" inputMode="numeric" value={f.ground_crew_size} onChange={set('ground_crew_size')} /></div>
            <div><Label>Mini skid steer needed?</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={f.mini_skid}
                onChange={(e) => setF({ ...f, mini_skid: e.target.value })}>
                <option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option>
              </select></div>
            {f.mini_skid === 'yes' && <p className="text-xs text-muted-foreground self-end pb-2">Billed at $100/hr for the job length.</p>}
            <div className="col-span-2"><Label>Equipment</Label><Input value={f.equipment} onChange={set('equipment')} /></div>
          </>}
          <div className="col-span-2"><Label>Notes</Label><Textarea value={f.notes} onChange={set('notes')} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
