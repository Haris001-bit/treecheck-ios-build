import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useProductionConfig } from '@/hooks/useProductionConfig';
import { buildProductionPlan, ENGINE_VERSION, METHOD_LABELS, type ProductionPlan, type JobMethod } from '@/lib/production/engine';
import {
  seedConfirmed, toJobCharacteristics, verdict, actualPersonHours,
  type AiCharacteristics, type ConfirmedCharacteristics, type CharKey, type ActualJob,
} from '@/lib/production/calibration';
import { CHAR_LIMITS, JOB_HOURS_LIMIT, LOADS_LIMIT, firstOutOfRange, inRange } from '@/lib/inputLimits';

async function compress(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

type FieldDef = { key: CharKey; label: string; kind: 'num' | 'bool' | 'enum'; unit?: string; opts?: { v: string; l: string }[] };
const FIELDS: FieldDef[] = [
  { key: 'dbh_inches', label: 'Trunk diameter (DBH)', kind: 'num', unit: 'in' },
  { key: 'height_ft', label: 'Height', kind: 'num', unit: 'ft' },
  { key: 'access', label: 'Access', kind: 'enum', opts: [{ v: 'easy', l: 'Easy' }, { v: 'moderate', l: 'Moderate' }, { v: 'tight', l: 'Tight' }] },
  { key: 'drop_zone', label: 'Drop zone', kind: 'enum', opts: [{ v: 'open', l: 'Open' }, { v: 'restricted', l: 'Restricted' }] },
  { key: 'near_structure', label: 'House/structure close', kind: 'bool' },
  { key: 'power_lines', label: 'Power lines', kind: 'bool' },
  { key: 'canopy_dense', label: 'Dense canopy', kind: 'bool' },
  { key: 'multiple_leaders', label: 'Multiple leaders', kind: 'bool' },
  { key: 'condition', label: 'Condition', kind: 'enum', opts: [{ v: 'healthy', l: 'Healthy' }, { v: 'declining', l: 'Declining' }, { v: 'dead', l: 'Dead' }] },
  { key: 'crane_indicated', label: 'Crane needed', kind: 'bool' },
  { key: 'loads', label: 'Debris loads', kind: 'num' },
  { key: 'tree_count', label: 'Number of trees', kind: 'num' },
];

type Step = 'photos' | 'confirm' | 'predicted' | 'actual' | 'compare';

export function CalibrationWizard({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved?: () => void }) {
  const { data: conf, ownerId } = useProductionConfig();
  const [step, setStep] = useState<Step>('photos');
  const [files, setFiles] = useState<File[]>([]);
  const [hints, setHints] = useState('');
  const [busy, setBusy] = useState(false);
  const [calId, setCalId] = useState<string | null>(null);
  const [ai, setAi] = useState<AiCharacteristics | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedCharacteristics | null>(null);
  const [plan, setPlan] = useState<ProductionPlan | null>(null);
  const [actual, setActual] = useState<ActualJob>({ method: 'climbing_rigging', crew: [{ roleKey: 'climber', count: 1 }, { roleKey: 'ground', count: 2 }], durationHours: 0, equipment: [], loads: null });
  const [sold, setSold] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setStep('photos'); setFiles([]); setHints(''); setCalId(null); setAi(null); setConfirmed(null); setPlan(null);
    setActual({ method: 'climbing_rigging', crew: [{ roleKey: 'climber', count: 1 }, { roleKey: 'ground', count: 2 }], durationHours: 0, equipment: [], loads: null });
    setSold(''); setNotes('');
  };
  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  const analyze = async () => {
    setBusy(true);
    try {
      const photos = await Promise.all(files.map(compress));
      const { data, error } = await supabase.functions.invoke('calibration-analyze', { body: { photos, hints: hints || null } });
      if (error && !data) throw error;
      if (data?.calibration_id) setCalId(data.calibration_id);
      if (data?.error) toast.error(data.error);
      if (!data?.calibration_id) return;
      setAi(data.ai ?? null);
      setConfirmed(seedConfirmed(data.ai ?? null));
      setStep('confirm');
    } catch (e: any) { toast.error(e?.message || 'Could not analyze photos'); }
    finally { setBusy(false); }
  };

  const lockPrediction = async () => {
    if (!confirmed || !calId) return;
    const bad = firstOutOfRange(confirmed);
    if (bad) {
      const field = FIELDS.find((f) => f.key === bad);
      const limit = CHAR_LIMITS[bad]!;
      toast.error(`${field?.label ?? 'That number'} should be between ${limit.min} and ${limit.max}${field?.unit ? ` ${field.unit}` : ''}. Leave it blank if you don't know.`);
      return;
    }
    setBusy(true);
    try {
      const inputs = toJobCharacteristics(confirmed);
      const p = buildProductionPlan(inputs);
      const { error } = await (supabase as any).from('production_calibrations').update({
        confirmed_characteristics: confirmed, inputs, engine_version: ENGINE_VERSION, predicted_plan: p,
        predicted_at: new Date().toISOString(), status: 'predicted',
      }).eq('id', calId);
      if (error) throw error;
      setPlan(p);
      setActual((a) => ({ ...a, method: p.method, loads: p.loads }));
      setStep('predicted');
    } catch (e: any) { toast.error(e?.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  const saveActual = async () => {
    if (!calId || !inRange(actual.durationHours, JOB_HOURS_LIMIT)) { toast.error(`Enter how long the job took, between ${JOB_HOURS_LIMIT.min} and ${JOB_HOURS_LIMIT.max} hours`); return; }
    if (actual.loads != null && !inRange(actual.loads, LOADS_LIMIT)) { toast.error(`Debris loads should be between ${LOADS_LIMIT.min} and ${LOADS_LIMIT.max}`); return; }
    setBusy(true);
    try {
      const db = supabase as any;
      const { error } = await db.from('production_calibrations').update({
        actual_method: actual.method, actual_crew: actual.crew.filter((c) => c.count > 0),
        actual_duration_hours: actual.durationHours, actual_person_hours: actualPersonHours(actual),
        actual_equipment: actual.equipment, actual_loads: actual.loads, notes: notes.trim() || null,
        status: 'completed', completed_at: new Date().toISOString(),
      }).eq('id', calId);
      if (error) throw error;
      if (sold && Number(sold) > 0) {
        await db.from('production_pricing_history').upsert({ contractor_id: ownerId, calibration_id: calId, sold_price: Number(sold) }, { onConflict: 'calibration_id' });
      }
      setStep('compare');
      onSaved?.();
    } catch (e: any) { toast.error(e?.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  const roleName = (k: string) => conf?.roles.find((r) => r.role_key === k)?.name ?? k;
  const eqName = (k: string) => conf?.equipment.find((r) => r.equipment_key === k)?.name ?? k;
  const setField = (k: CharKey, value: unknown) => setConfirmed((c) => c && ({ ...c, [k]: { ...c[k], value, source: value == null ? 'unknown' : 'owner' } }));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'photos' && 'Show Scout a completed job'}
            {step === 'confirm' && 'Confirm what Scout sees'}
            {step === 'predicted' && 'Scout would have expected'}
            {step === 'actual' && 'How did your company actually do this job?'}
            {step === 'compare' && 'Scout vs. your company'}
          </DialogTitle>
          <DialogDescription>
            {step === 'photos' && 'Add 1–4 photos of a tree removal you already finished.'}
            {step === 'confirm' && 'Fix anything Scout got wrong. Leave it unknown if you don’t remember.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'photos' && (
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm">
              <Camera className="w-5 h-5 text-primary" />Add photos
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 4))} />
            </label>
            {files.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {files.map((f, i) => (
                  <div key={i} className="relative">
                    <img src={URL.createObjectURL(f)} alt="" className="h-20 w-full rounded object-contain bg-muted" />
                    <button type="button" className="absolute right-0 top-0 rounded-full bg-background p-0.5" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove photo"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <Textarea placeholder="Anything you remember? (optional) e.g. about 30 inch oak… backyard, tight gate" value={hints} onChange={(e) => setHints(e.target.value)} maxLength={1000} />
            <Button className="w-full" onClick={analyze} disabled={busy || files.length === 0}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy ? 'Scout is looking…' : 'Continue'}</Button>
          </div>
        )}

        {step === 'confirm' && confirmed && (
          <div className="space-y-2">
            {!ai && <div className="rounded-md bg-muted p-2 text-xs">Scout couldn't read the photos, so fill in what you know.</div>}
            {FIELDS.map((f) => {
              const c = confirmed[f.key];
              return (
                <div key={f.key} className="flex items-center justify-between gap-2 border-b pb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.source === 'owner' ? 'You set this' : c.source === 'ai' ? `Scout · ${c.aiConfidence} confidence` : 'Unknown'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {f.kind === 'num' && (
                      <Input type="number" className="w-20 h-8" value={c.value == null ? '' : String(c.value)} placeholder="?"
                        min={CHAR_LIMITS[f.key]?.min} max={CHAR_LIMITS[f.key]?.max}
                        onChange={(e) => setField(f.key, e.target.value === '' ? null : Number(e.target.value))} />
                    )}
                    {f.kind === 'num' && f.unit && <span className="text-xs">{f.unit}</span>}
                    {f.kind === 'bool' && (
                      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={c.value == null ? '' : String(c.value)}
                        onChange={(e) => setField(f.key, e.target.value === '' ? null : e.target.value === 'true')}>
                        <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
                      </select>
                    )}
                    {f.kind === 'enum' && (
                      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={c.value == null ? '' : String(c.value)}
                        onChange={(e) => setField(f.key, e.target.value || null)}>
                        <option value="">Unknown</option>{f.opts!.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
            {ai?.observations?.length ? (
              <div className="text-xs text-muted-foreground"><div className="font-semibold text-foreground">Scout noticed</div><ul className="list-disc pl-5">{ai.observations.map((o) => <li key={o}>{o}</li>)}</ul></div>
            ) : null}
            <Button className="w-full" onClick={lockPrediction} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Looks right — show Scout's plan</Button>
          </div>
        )}

        {step === 'predicted' && plan && (
          <div className="space-y-2 text-sm">
            <Row l="Method" v={METHOD_LABELS[plan.method]} />
            <Row l="Crew" v={plan.crew.map((c) => `${c.count} ${roleName(c.roleKey)}`).join(', ')} />
            <Row l="Estimated duration" v={`${plan.durationHours} hours`} />
            <Row l="Person-hours" v={String(plan.personHours)} />
            <Row l="Equipment" v={plan.equipment.map((e) => eqName(e.key)).join(', ') || 'None'} />
            <Row l="Debris" v={`About ${plan.loads} load${plan.loads === 1 ? '' : 's'}`} />
            <Row l="Confidence" v={<Badge variant={plan.confidence === 'low' ? 'destructive' : 'secondary'}>{plan.confidence}</Badge>} />
            {plan.assumptions.length > 0 && <ul className="list-disc pl-5 text-xs text-muted-foreground">{plan.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}
            <div className="text-[11px] text-muted-foreground">Saved. Scout's prediction can't be changed now.</div>
            <Button className="w-full" onClick={() => setStep('actual')}>Tell Scout what really happened</Button>
          </div>
        )}

        {step === 'actual' && conf && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-medium mb-1">How did you take it down?</div>
              <select className="w-full rounded-md border bg-background px-2 py-2" value={actual.method} onChange={(e) => setActual({ ...actual, method: e.target.value as JobMethod })}>
                {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{k === 'crane' ? 'Crane-assisted removal' : v}</option>)}
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <div className="font-medium mb-1">Who was on the job?</div>
              {conf.roles.map((r) => {
                const cur = actual.crew.find((c) => c.roleKey === r.role_key)?.count ?? 0;
                return (
                  <div key={r.role_key} className="flex items-center justify-between py-1">
                    <span>{r.name}</span>
                    <Input type="number" min={0} className="w-20 h-8" value={cur}
                      onChange={(e) => {
                        const n = Math.max(0, Number(e.target.value));
                        const rest = actual.crew.filter((c) => c.roleKey !== r.role_key);
                        setActual({ ...actual, crew: n ? [...rest, { roleKey: r.role_key, count: n }] : rest });
                      }} />
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">How long did the job take?</span>
              <div className="flex items-center gap-1"><Input type="number" step="0.5" min={JOB_HOURS_LIMIT.min} max={JOB_HOURS_LIMIT.max} className="w-20 h-8" value={actual.durationHours || ''} onChange={(e) => setActual({ ...actual, durationHours: Number(e.target.value) })} /><span className="text-xs">hr</span></div>
            </div>
            <div>
              <div className="font-medium mb-1">What equipment did you use?</div>
              <div className="flex flex-wrap gap-2">
                {conf.equipment.map((e) => {
                  const on = actual.equipment.includes(e.equipment_key);
                  return <Button key={e.equipment_key} type="button" size="sm" variant={on ? 'default' : 'outline'}
                    onClick={() => setActual({ ...actual, equipment: on ? actual.equipment.filter((x) => x !== e.equipment_key) : [...actual.equipment, e.equipment_key] })}>{e.name}</Button>;
                })}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">Debris loads <span className="text-xs text-muted-foreground">(optional)</span></span>
              <Input type="number" min={LOADS_LIMIT.min} max={LOADS_LIMIT.max} className="w-20 h-8" value={actual.loads ?? ''} onChange={(e) => setActual({ ...actual, loads: e.target.value === '' ? null : Number(e.target.value) })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">What did you sell the job for? <span className="text-xs text-muted-foreground">(optional)</span></span>
              <Input type="number" className="w-28 h-8" placeholder="$" value={sold} onChange={(e) => setSold(e.target.value)} />
            </div>
            <Textarea placeholder="Short note (optional) e.g. long backyard drag slowed cleanup" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            <Button className="w-full" onClick={saveActual} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Compare</Button>
          </div>
        )}

        {step === 'compare' && plan && conf && (
          <div className="space-y-3 text-sm">
            <table className="w-full text-left">
              <thead><tr className="text-xs text-muted-foreground"><th></th><th>Scout expected</th><th>Actual</th></tr></thead>
              <tbody className="[&_td]:py-1">
                <tr><td>Method</td><td>{METHOD_LABELS[plan.method]}</td><td>{actual.method === 'other' ? 'Other' : METHOD_LABELS[actual.method]}</td></tr>
                {Array.from(new Set([...plan.crew.map((c) => c.roleKey), ...actual.crew.map((c) => c.roleKey)])).map((k) => (
                  <tr key={k}><td>{roleName(k)}</td><td>{plan.crew.filter((c) => c.roleKey === k).reduce((s, c) => s + c.count, 0)}</td><td>{actual.crew.filter((c) => c.roleKey === k).reduce((s, c) => s + c.count, 0)}</td></tr>
                ))}
                <tr><td>Duration</td><td>{plan.durationHours} hr</td><td>{actual.durationHours} hr</td></tr>
                <tr><td>Person-hours</td><td>{plan.personHours}</td><td>{actualPersonHours(actual)}</td></tr>
                {Array.from(new Set([...plan.equipment.map((e) => e.key), ...actual.equipment])).map((k) => (
                  <tr key={k}><td>{eqName(k)}</td><td>{plan.equipment.some((e) => e.key === k) ? 'Yes' : 'No'}</td><td>{actual.equipment.includes(k) ? 'Yes' : 'No'}</td></tr>
                ))}
                <tr><td>Debris loads</td><td>{plan.loads}</td><td>{actual.loads ?? '—'}</td></tr>
                <tr><td>Selling price</td><td>—</td><td>{sold ? `$${Number(sold).toLocaleString()}` : '—'}</td></tr>
              </tbody>
            </table>
            <div className="rounded-md bg-muted p-2 font-semibold">{verdict(plan, actual)}</div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={reset}>Add another job</Button>
              <Button className="flex-1" variant="outline" onClick={() => close(false)}>Finish for now</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ l, v }: { l: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 border-b pb-1"><span className="text-muted-foreground">{l}</span><span className="text-right font-medium">{v}</span></div>;
}
