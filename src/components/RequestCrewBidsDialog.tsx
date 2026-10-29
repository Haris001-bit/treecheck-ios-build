import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrewNetwork } from '@/hooks/useCrew';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Gavel } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { functionFailure } from '@/lib/functionFailure';
import { FreePlanUpsell } from '@/components/free/FreePlanUpsell';
import { FreeUsageNote } from '@/components/free/FreeUsageNote';

export interface RequestCrewBidsSeed {
  captureId?: string | null;
  title?: string;
  description?: string;
  city?: string;
  photoPath?: string | null;
  /** Pre-fill from the Scout worksheet */
  climber?: boolean;
  groundCount?: number | null;
  hours?: number | null;
  loads?: number | null;
  stump?: boolean;
  crane?: boolean;
  chipper?: boolean;
}


const AUDIENCES = [
  { key: 'own_then_network', label: 'My subs first, then nearby subs' },
  { key: 'own', label: 'My subs only' },
  { key: 'all', label: 'Everyone nearby at once' },
];

export function RequestCrewBidsDialog({
  seed,
  open,
  onOpenChange,
}: {
  seed: RequestCrewBidsSeed | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: crew } = useCrewNetwork();
  const activeCrew = (crew ?? []).filter((c) => c.status === 'active');
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [ownerCost, setOwnerCost] = useState('0');
  const [selected, setSelected] = useState<string[]>([]);
  const [needClimber, setNeedClimber] = useState(true);
  const [needGround, setNeedGround] = useState(false);
  const [needStump, setNeedStump] = useState(false);
  const [groundSize, setGroundSize] = useState('');
  const [jobHours, setJobHours] = useState('');
  const [loads, setLoads] = useState('');
  const [needCrane, setNeedCrane] = useState(false);
  const [payMode, setPayMode] = useState<'bid' | 'fixed'>('bid');
  const [fixedPay, setFixedPay] = useState('');
  const [fixedType, setFixedType] = useState<'hourly' | 'per_job'>('hourly');
  const [audience, setAudience] = useState('own_then_network');

  useEffect(() => {
    if (!open) return;
    setTitle(seed?.title ?? 'Tree job');
    setDescription(seed?.description ?? '');
    setCity(seed?.city ?? '');
    setOwnerCost('0');
    setSelected([]);
    setNeedClimber(seed?.climber ?? true);
    setNeedGround((seed?.groundCount ?? 0) > 0);
    setNeedStump(!!seed?.stump);
    setGroundSize(seed?.groundCount ? String(seed.groundCount) : '');
    setJobHours(seed?.hours ? String(seed.hours) : '');
    setLoads(seed?.loads ? String(seed.loads) : '');
    setNeedCrane(!!seed?.crane);
    setPayMode('bid');
    setFixedPay('');
    setFixedType('hourly');
    setAudience('own_then_network');
  }, [open, seed]);

  const roleNeeded = needClimber && needGround ? 'both' : needClimber ? 'climber' : needGround ? 'ground' : needStump ? 'stump' : '';

  // Free plan: the server's monthly-limit message, shown here instead of a generic error.
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  useEffect(() => { if (open) setLimitMessage(null); }, [open]);

  const send = async () => {
    if (!roleNeeded) return toast.error('Pick at least one kind of sub');
    if (payMode === 'fixed' && !(Number(fixedPay) > 0)) return toast.error('Enter the pay you want to offer');
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('bid-request-create', {
        body: {
          capture_id: seed?.captureId ?? null,
          photo_path: seed?.photoPath ?? null,
          title,
          description,
          city,
          target_margin_pct: 30,
          owner_cost: 0,
          pricing_inputs: {
            crewSize: groundSize === '' ? null : Number(groundSize),
            jobHours: jobHours === '' ? null : Number(jobHours),
            disposalLoads: loads === '' ? null : Number(loads),
            otherCosts: Number(ownerCost) || 0,
          },
          role_needed: roleNeeded,
          needs_stump_grinding: needStump,
          crew_counts: { climber: needClimber ? 1 : 0, ground: needGround ? Number(groundSize) || 1 : 0, stump: needStump ? 1 : 0, crane: needCrane ? 1 : 0 },
          equipment_needed: needCrane ? ['crane'] : [],
          pay_mode: payMode,
          fixed_pay: payMode === 'fixed' ? Number(fixedPay) : null,
          fixed_pay_type: payMode === 'fixed' ? fixedType : null,
          audience,
          crew_member_ids: selected.length ? selected : null,
        },
      });
      const failure = await functionFailure(error, data);
      if (failure) {
        if (failure.status === 403 && /this month/.test(failure.message)) {
          setLimitMessage(failure.message);
          qc.invalidateQueries({ queryKey: ['free-plan'] });
          return;
        }
        throw new Error(failure.message);
      }
      qc.invalidateQueries({ queryKey: ['free-plan'] });
      toast.success(
        data?.demo
          ? 'Demo: job sent to subs. It is in Jobs → Active. (Demo accounts never alert real people.)'
          : data?.recipients
          ? `Sent to ${data.recipients} sub${data.recipients === 1 ? '' : 's'}${data.held_for_first_refusal ? ' — others get it after the head start' : ''}`
          : 'Job created. No subs to alert yet.',
      );
      qc.invalidateQueries({ queryKey: ['bid-requests'] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the job');
    } finally {
      setSaving(false);
    }
  };

  const chip = (on: boolean) =>
    cn('rounded-md border px-3 py-2 text-sm font-bold text-left', on ? 'border-primary bg-primary/10' : 'border-input');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="w-5 h-5 text-primary" />Get subs for this job
          </DialogTitle>
          <DialogDescription>
            Subs see the photo, description, address and customer contact.
          </DialogDescription>
        </DialogHeader>
        <FreeUsageNote kind="jobs" />
        {limitMessage && <FreePlanUpsell title="Monthly free jobs used" body={limitMessage} />}

        <div className="space-y-4">
          <div>
            <Label htmlFor="rb-title">Job title</Label>
            <Input id="rb-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <Label>Who do you need?</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button type="button" className={chip(needClimber)} onClick={() => setNeedClimber(!needClimber)}>Climber</button>
              <button type="button" className={chip(needGround)} onClick={() => setNeedGround(!needGround)}>Ground crew</button>
              <button type="button" className={chip(needStump)} onClick={() => setNeedStump(!needStump)}>Stump grinder</button>
              <button type="button" className={chip(needCrane)} onClick={() => setNeedCrane(!needCrane)}>Crane</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {needGround && (
              <div>
                <Label htmlFor="rb-crew">How many ground workers?</Label>
                <Input id="rb-crew" type="number" inputMode="numeric" value={groundSize} onChange={(e) => setGroundSize(e.target.value)} />
              </div>
            )}
            <div>
              <Label htmlFor="rb-hours">Hours on site</Label>
              <Input id="rb-hours" type="number" inputMode="decimal" value={jobHours} onChange={(e) => setJobHours(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="rb-loads">Disposal loads</Label>
              <Input id="rb-loads" type="number" inputMode="decimal" value={loads} onChange={(e) => setLoads(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="rb-city">City</Label>
              <Input id="rb-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>


          <div>
            <Label>Pay</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button type="button" className={chip(payMode === 'bid')} onClick={() => setPayMode('bid')}>
                Ask for bids
                <div className="text-xs font-normal">Subs name their price</div>
              </button>
              <button type="button" className={chip(payMode === 'fixed')} onClick={() => setPayMode('fixed')}>
                I'll set the pay
                <div className="text-xs font-normal">Subs accept or pass</div>
              </button>
            </div>
            {payMode === 'fixed' && (
              <div className="flex gap-2 mt-2">
                <Input type="number" inputMode="decimal" placeholder="$" value={fixedPay} onChange={(e) => setFixedPay(e.target.value)} />
                <Select value={fixedType} onValueChange={(v) => setFixedType(v as any)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">per hour</SelectItem>
                    <SelectItem value="per_job">for the job</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="rb-desc">Description for the subs</Label>
            <Textarea id="rb-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Large tree over the house, tight backyard access, power line on the north side." />
          </div>

          <div>
            <Label>Who gets it?</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUDIENCES.map((a) => <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {activeCrew.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs cursor-pointer">Only send to specific subs…</summary>
                <div className="space-y-2 max-h-40 overflow-y-auto rounded-md border p-2 mt-2">
                  {activeCrew.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selected.includes(c.id)}
                        onCheckedChange={(v) =>
                          setSelected((curr) => (v ? [...curr, c.id] : curr.filter((x) => x !== c.id)))
                        }
                      />
                      <span>{c.full_name || c.email}</span>
                      {c.rating_avg != null && (
                        <span className="text-xs text-muted-foreground">★ {Number(c.rating_avg).toFixed(1)}</span>
                      )}
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={send} disabled={saving || !title.trim()} className="w-full">
            {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</> : 'Send to subs'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
