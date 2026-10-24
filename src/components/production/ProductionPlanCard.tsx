import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, HardHat, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useProductionConfig } from '@/hooks/useProductionConfig';
import {
  buildProductionPlan, computeCost, recommendPrice, evaluatePrice, ballparkStatus, personHoursOf,
  METHOD_LABELS, ENGINE_VERSION, type ProductionPlan, type JobMethod,
} from '@/lib/production/engine';
import { fromScoutCapture } from '@/lib/production/fromScoutCapture';

const money = (n: number | null | undefined) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function ProductionPlanCard({ capture }: { capture: any }) {
  const qc = useQueryClient();
  const { data: conf, cfg, ownerId } = useProductionConfig();
  const inputs = useMemo(() => fromScoutCapture(capture), [capture]);
  const original = useMemo(() => buildProductionPlan(inputs), [inputs]);

  const { data: row, isLoading } = useQuery({
    queryKey: ['production-plan', capture.id],
    queryFn: async () => {
      const { data } = await (supabase as any).from('production_plans').select('*').eq('capture_id', capture.id).maybeSingle();
      return data ?? null;
    },
  });

  const [plan, setPlan] = useState<ProductionPlan | null>(null);
  const [editing, setEditing] = useState(false);
  const [finalPrice, setFinalPrice] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isLoading || plan) return;
    setPlan((row?.adjusted_plan ?? row?.original_plan ?? original) as ProductionPlan);
    if (row?.final_price != null) setFinalPrice(String(row.final_price));
  }, [isLoading, row, original, plan]);

  if (!cfg || !conf || !plan) return null;

  const scoutPlan: ProductionPlan = (row?.original_plan as ProductionPlan) ?? original;
  const cost = computeCost(plan, cfg);
  const rec = recommendPrice(cost.total, cfg);
  const bMin = capture.ai_price_min != null ? Number(capture.ai_price_min) : null;
  const bMax = capture.ai_price_max != null ? Number(capture.ai_price_max) : null;
  const status = ballparkStatus(rec.price, bMin, bMax);
  const finalN = finalPrice === '' ? null : Number(finalPrice);
  const finalEval = finalN != null && finalN > 0 ? evaluatePrice(finalN, cost.total) : null;
  const roleName = (k: string) => conf.roles.find((r) => r.role_key === k)?.name ?? k;
  const eqName = (k: string) => conf.equipment.find((r) => r.equipment_key === k)?.name ?? k;
  const review = scoutPlan.reviewRecommended;

  const update = (patch: Partial<ProductionPlan>) => setPlan((p) => {
    const n = { ...p!, ...patch };
    return { ...n, personHours: personHoursOf(n.crew), durationHours: Math.max(0, ...n.crew.map((c) => c.hours)) };
  });

  const persist = async (price: number | null) => {
    setSaving(true);
    try {
      const adjusted = JSON.stringify(plan) === JSON.stringify(scoutPlan) ? null : plan;
      const payload: any = {
        adjusted_plan: adjusted, expected_cost: cost.total, recommended_price: rec.price, final_price: price,
        ballpark_min: bMin, ballpark_max: bMax,
      };
      const db = supabase as any;
      const { error } = row
        ? await db.from('production_plans').update(payload).eq('id', row.id)
        : await db.from('production_plans').insert({
            ...payload, contractor_id: ownerId, capture_id: capture.id, engine_version: ENGINE_VERSION,
            inputs, original_plan: original, confidence: original.confidence,
          });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['production-plan', capture.id] });
      toast.success('Production plan saved');
      setEditing(false);
    } catch (e: any) { toast.error(e?.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const statusBadge = status === 'none' ? null : (
    <Badge variant={status === 'within' ? 'default' : status === 'above' ? 'destructive' : 'secondary'}>
      {status === 'within' ? 'Within Customer Ballpark' : status === 'below' ? 'Below Customer Ballpark' : 'Above Customer Ballpark — Review Recommended'}
      {review && status !== 'above' ? ' · Review recommended' : ''}
    </Badge>
  );

  return (
    <div className="rounded-lg border-2 border-primary/30 bg-card p-4 space-y-4 text-sm">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-bold flex items-center gap-1.5"><HardHat className="w-4 h-4 text-primary" />Scout Production Plan</div>
        <div className="flex items-center gap-2">
          <Badge variant={scoutPlan.confidence === 'high' ? 'default' : scoutPlan.confidence === 'medium' ? 'secondary' : 'destructive'}>
            {scoutPlan.confidence} confidence
          </Badge>
          {!editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="w-3.5 h-3.5 mr-1" />Adjust Production Plan</Button>}
        </div>
      </div>

      {review && (
        <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
          <span><strong>Review recommended.</strong> Scout is missing key details and made assumptions (listed below).</span>
        </div>
      )}

      {!conf.configured && (
        <div className="text-xs text-muted-foreground">Using sample labor and equipment costs. Set your own in How we work → Production costs.</div>
      )}

      <div className="rounded-md bg-muted/50 p-3">
        <div className="text-xs text-muted-foreground">Customer AI Ballpark</div>
        <div className="text-lg font-bold">{bMin == null && bMax == null ? 'None received' : `${money(bMin)}${bMax != null && bMax !== bMin ? ` – ${money(bMax)}` : ''}`}</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Job method</div>
          {editing ? (
            <select className="w-full rounded-md border bg-background px-2 py-1.5" value={plan.method} onChange={(e) => update({ method: e.target.value as JobMethod })}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          ) : <div className="font-semibold">{METHOD_LABELS[plan.method]}</div>}
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Estimated duration</div>
          <div className="font-semibold">{plan.durationHours} hours · {plan.personHours} person-hours</div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Crew</div>
        {plan.crew.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            {editing ? (
              <>
                <select className="flex-1 rounded-md border bg-background px-2 py-1" value={c.roleKey}
                  onChange={(e) => update({ crew: plan.crew.map((x, j) => j === i ? { ...x, roleKey: e.target.value } : x) })}>
                  {conf.roles.map((r) => <option key={r.role_key} value={r.role_key}>{r.name}</option>)}
                </select>
                <Input type="number" className="w-16 h-8" value={c.count} aria-label="Count"
                  onChange={(e) => update({ crew: plan.crew.map((x, j) => j === i ? { ...x, count: Math.max(0, Number(e.target.value)) } : x) })} />
                <span className="text-xs">×</span>
                <Input type="number" step="0.5" className="w-20 h-8" value={c.hours} aria-label="Hours"
                  onChange={(e) => update({ crew: plan.crew.map((x, j) => j === i ? { ...x, hours: Math.max(0, Number(e.target.value)) } : x) })} />
                <span className="text-xs">hr</span>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => update({ crew: plan.crew.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </>
            ) : <div><strong>{roleName(c.roleKey)}:</strong> {c.count} × {c.hours} hr</div>}
          </div>
        ))}
        {editing && <Button size="sm" variant="ghost" onClick={() => update({ crew: [...plan.crew, { roleKey: conf.roles[0]?.role_key ?? 'ground', count: 1, hours: plan.durationHours }] })}><Plus className="w-3.5 h-3.5 mr-1" />Add role</Button>}
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Equipment</div>
        {plan.equipment.length === 0 && !editing && <div className="text-muted-foreground">None</div>}
        {plan.equipment.map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            {editing ? (
              <>
                <select className="flex-1 rounded-md border bg-background px-2 py-1" value={e.key}
                  onChange={(ev) => update({ equipment: plan.equipment.map((x, j) => j === i ? { ...x, key: ev.target.value } : x) })}>
                  {conf.equipment.map((r) => <option key={r.equipment_key} value={r.equipment_key}>{r.name}</option>)}
                </select>
                <Input type="number" step="0.5" className="w-20 h-8" value={e.hours} aria-label="Hours"
                  onChange={(ev) => update({ equipment: plan.equipment.map((x, j) => j === i ? { ...x, hours: Math.max(0, Number(ev.target.value)) } : x) })} />
                <span className="text-xs">hr</span>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => update({ equipment: plan.equipment.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </>
            ) : <div>{eqName(e.key)} — {e.hours} hr</div>}
          </div>
        ))}
        {editing && <Button size="sm" variant="ghost" onClick={() => update({ equipment: [...plan.equipment, { key: conf.equipment[0]?.equipment_key ?? 'chipper', hours: plan.durationHours }] })}><Plus className="w-3.5 h-3.5 mr-1" />Add equipment</Button>}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Debris loads:</span>
          {editing ? <Input type="number" className="w-16 h-8" value={plan.loads} onChange={(e) => update({ loads: Math.max(0, Number(e.target.value)) })} /> : <span>{plan.loads}</span>}
        </div>
      </div>

      {editing && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => persist(finalN)} disabled={saving}>{saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Save plan</Button>
          <Button size="sm" variant="ghost" onClick={() => { setPlan(scoutPlan); }}>Reset to Scout's plan</Button>
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer font-semibold">Scout considered</summary>
        <ul className="mt-1 list-disc pl-5 space-y-0.5">{scoutPlan.factors.map((f) => <li key={f}>{f}</li>)}</ul>
        {scoutPlan.assumptions.length > 0 && (
          <>
            <div className="mt-2 font-semibold">Assumptions</div>
            <ul className="mt-1 list-disc pl-5 space-y-0.5 text-muted-foreground">{scoutPlan.assumptions.map((f) => <li key={f}>{f}</li>)}</ul>
          </>
        )}
      </details>

      <div className="rounded-md border p-3 space-y-1">
        <div className="font-semibold">Expected Production Cost</div>
        <div className="flex justify-between"><span>Labor</span><span>{money(cost.labor)}</span></div>
        <div className="flex justify-between"><span>Equipment</span><span>{money(cost.equipment)}</span></div>
        <div className="flex justify-between"><span>Disposal/other</span><span>{money(cost.disposal)}</span></div>
        <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>{money(cost.total)}</span></div>
        {cost.missingRates.length > 0 && <div className="text-xs text-destructive">No cost set for: {cost.missingRates.join(', ')}</div>}
      </div>

      <div className="rounded-md bg-primary/5 p-3 space-y-1">
        <div className="flex justify-between"><span>Company target margin</span><span>{pct(cfg.targetMargin)}</span></div>
        <div className="flex justify-between"><span>Expected gross profit</span><span>{money(rec.grossProfit)}</span></div>
        <div className="flex justify-between text-base font-bold"><span>Scout Recommended Price</span><span className="text-primary">{money(rec.price)}</span></div>
        {rec.minimumApplied && <div className="text-xs text-muted-foreground">Raised to your minimum job charge.</div>}
        <div className="pt-1">{statusBadge}</div>
      </div>

      <div className="space-y-2">
        <div className="font-semibold">Final price</div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => { setFinalPrice(String(rec.price)); persist(rec.price); }} disabled={saving}>Use Recommended Price</Button>
          <Input type="number" placeholder="Enter different price" className="w-40 h-9" value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} />
          <Button size="sm" onClick={() => persist(finalN)} disabled={saving || finalN == null}>Save</Button>
        </div>
        {finalEval && (
          <div className="text-xs grid grid-cols-2 gap-1">
            <span>Final quote</span><span className="text-right">{money(finalEval.price)}</span>
            <span>Expected cost</span><span className="text-right">{money(finalEval.cost)}</span>
            <span>Expected gross profit</span><span className="text-right">{money(finalEval.grossProfit)}</span>
            <span>Expected gross margin</span><span className={`text-right ${finalEval.grossMargin < cfg.targetMargin ? 'text-destructive' : ''}`}>{pct(finalEval.grossMargin)}</span>
          </div>
        )}
        <div className="text-[11px] text-muted-foreground">Nothing is sent to the customer from here.</div>
      </div>
    </div>
  );
}
