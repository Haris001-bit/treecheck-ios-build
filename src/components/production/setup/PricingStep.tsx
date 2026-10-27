import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { Answers, Service, Strategy } from '@/lib/production/rules';
import { priceWorkItem } from '@/lib/production/pricing';
import { findContradictions } from '@/lib/production/contradictions';
import { dollars } from '@/lib/production/answers';
import { clampTyped, RATE_CARD_MONEY_MAX } from '@/lib/inputLimits';
import { Section, MoneyField, NumberField, TextField, ToggleRow, ChoiceField, ListField } from './fields';
import { keyFor } from './keys';
import { QuestionInputs } from './QuestionInputs';
import { STRATEGY_LABELS } from './serviceTemplates';
import { today, type StepProps } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PricingStep({ def, update, focusService }: StepProps) {
  const [selected, setSelected] = useState<string | null>(focusService ?? def.services[0]?.key ?? null);
  useEffect(() => { if (focusService) setSelected(focusService); }, [focusService]);
  const idx = def.services.findIndex((s) => s.key === selected);
  const open = useMemo(() => new Set(findContradictions(def).filter((c) => c.blocking && !c.resolved && c.serviceKey).map((c) => c.serviceKey as string)), [def]);
  const service = idx >= 0 ? def.services[idx] : null;
  const edit = (fn: (s: Service) => void) => update((d) => { const s = d.services.find((x) => x.key === selected); if (s) fn(s); });

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
      <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1">
        {def.services.map((s) => (
          <Button key={s.key} variant={s.key === selected ? 'secondary' : 'ghost'} size="sm" className="justify-between whitespace-nowrap" onClick={() => setSelected(s.key)}>
            <span className={s.offered === false ? 'line-through text-muted-foreground' : ''}>{s.name}</span>
            {open.has(s.key) && <Badge variant="destructive" className="ml-2">!</Badge>}
          </Button>
        ))}
      </div>
      {service ? <ServiceEditor key={service.key} service={service} edit={edit} def={def} /> : <p className="text-sm text-muted-foreground">Add a service first.</p>}
    </div>
  );
}

function ServiceEditor({ service, edit, def }: { service: Service; edit: (fn: (s: Service) => void) => void; def: StepProps['def'] }) {
  const st = service.strategy;
  const issues = findContradictions(def).filter((c) => c.serviceKey === service.key && !c.resolved && c.blocking);
  const yesNoQs = service.questions.filter((q) => q.kind === 'yes_no');
  return (
    <div className="space-y-4 min-w-0">
      <Section title={service.name} hint={STRATEGY_LABELS[st.kind]}>
        {issues.length > 0 && <ul className="text-sm text-destructive list-disc pl-5">{issues.map((i) => <li key={i.key}>{i.message}</li>)}</ul>}
        <StrategyEditor service={service} edit={edit} def={def} />
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField label="Minimum for this service" optional value={service.minimum} onChange={(v) => edit((s) => { s.minimum = v; })} />
          <MoneyField label="Maximum (rarely used)" optional value={service.maximum} onChange={(v) => edit((s) => { s.maximum = v; })} />
        </div>
      </Section>

      <Section title="When it's sold" hint="Leave all months off to sell it all year.">
        <div className="flex flex-wrap gap-1">
          {MONTHS.map((m, i) => {
            const on = (service.sellMonths ?? []).includes(i + 1);
            return <Button key={m} size="sm" variant={on ? 'default' : 'outline'} onClick={() => edit((s) => {
              const cur = new Set(s.sellMonths ?? []); if (on) cur.delete(i + 1); else cur.add(i + 1);
              s.sellMonths = cur.size ? [...cur].sort((a, b) => a - b) : undefined;
            })}>{m}</Button>;
          })}
        </div>
        <ToggleRow label="Taxable" hint="Marks the line taxable in Jobber." checked={!!service.taxable} onChange={(v) => edit((s) => { s.taxable = v; })} />
        <TextField label="What the customer reads on the quote" value={service.customerText} max={500} multiline onChange={(v) => edit((s) => { s.customerText = v || undefined; })} />
      </Section>

      <Section title="Adjustments" hint="Add or take off an amount or a percent when an answer is yes (for example a hub and spoke system, or rear yard access)."
        action={yesNoQs.length > 0 ? <Button size="sm" variant="outline" onClick={() => edit((s) => { (s.adjustments ??= []).push({ when: { question: yesNoQs[0].key, equals: true }, amount: 0, label: yesNoQs[0].label }); })}><Plus className="w-4 h-4 mr-1" />Add</Button> : undefined}>
        {yesNoQs.length === 0 && <p className="text-xs text-muted-foreground">This service has no yes or no questions to adjust on.</p>}
        {(service.adjustments ?? []).map((a, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_7rem_7rem_auto] items-end">
            <ChoiceField label="When yes" value={a.when.question} options={yesNoQs.map((q) => [q.key, q.label] as [string, string])}
              onChange={(v) => edit((s) => { s.adjustments![i].when = { question: v, equals: true }; s.adjustments![i].label = yesNoQs.find((q) => q.key === v)?.label ?? v; })} />
            <MoneyField label="Add" value={a.amount ?? 0} onChange={(v) => edit((s) => { s.adjustments![i].amount = v ?? 0; })} />
            <NumberField label="Or add %" unit="%" max={300} value={a.percent ?? 0} onChange={(v) => edit((s) => { s.adjustments![i].percent = v || undefined; })} />
            <Button size="icon" variant="ghost" aria-label="Remove adjustment" onClick={() => edit((s) => { s.adjustments!.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </Section>

      {st.kind !== 'crew_time' && (
        <Section title="Time on site" hint="How long the crew is booked, for capacity planning and reports: base hours plus hours per unit.">
          <div className="grid gap-3 sm:grid-cols-3">
            <ChoiceField label="Crew" value={service.production?.crewTemplate} options={def.crews.map((c) => [c.key, c.name] as [string, string])}
              onChange={(v) => edit((s) => { s.production = { ...(s.production ?? {}), crewTemplate: v }; })} />
            <NumberField label="Base hours" unit="hr" max={100} step={0.25} value={service.production?.baseHours}
              onChange={(v) => edit((s) => { s.production = { ...(s.production ?? {}), baseHours: v }; })} />
            {service.questions.filter((q) => q.kind === 'number' || q.kind === 'count').slice(0, 1).map((q) => {
              const cur = service.production?.perUnit?.find((p) => p.question === q.key)?.hours;
              return <NumberField key={q.key} label={`Hours per ${q.label.toLowerCase()}`} unit="hr" max={100} step={0.05} value={cur}
                onChange={(v) => edit((s) => { const pr = { ...(s.production ?? {}) }; pr.perUnit = [...(pr.perUnit ?? []).filter((p) => p.question !== q.key), ...(v ? [{ question: q.key, hours: v }] : [])]; s.production = pr; })} />;
            })}
          </div>
        </Section>
      )}

      {service.category === 'planting' && <SpeciesEditor service={service} edit={edit} />}
      <TryIt service={service} def={def} />
    </div>
  );
}

function StrategyEditor({ service, edit, def }: { service: Service; edit: (fn: (s: Service) => void) => void; def: StepProps['def'] }) {
  const st = service.strategy;
  const set = (fn: (x: Strategy) => void) => edit((s) => fn(s.strategy));
  switch (st.kind) {
    case 'fixed':
      return <MoneyField label="Price" value={st.price} onChange={(v) => set((x) => { if (x.kind === 'fixed') x.price = v ?? 0; })} />;
    case 'per_unit':
      return <MoneyField label={`Price per ${labelOf(service, st.unitQuestion)}`} value={st.unitPrice} onChange={(v) => set((x) => { if (x.kind === 'per_unit') x.unitPrice = v ?? 0; })} />;
    case 'first_additional':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField label="First one" value={st.first} onChange={(v) => set((x) => { if (x.kind === 'first_additional') x.first = v ?? 0; })} />
          <MoneyField label="Each additional" value={st.additional} onChange={(v) => set((x) => { if (x.kind === 'first_additional') x.additional = v ?? 0; })} />
        </div>
      );
    case 'threshold':
      return (
        <div className="space-y-2">
          <Label className="text-xs">Price by {labelOf(service, st.question).toLowerCase()}</Label>
          {st.bands.map((b, i) => (
            <div key={i} className="flex items-end gap-2">
              {b.upTo === null
                ? <div className="w-32 text-sm pb-2">and above</div>
                : <NumberField className="w-32" label="Up to" value={b.upTo} max={10000} onChange={(v) => set((x) => { if (x.kind === 'threshold') x.bands[i].upTo = v ?? 0; })} />}
              <MoneyField className="flex-1" label="Price" value={b.price} onChange={(v) => set((x) => { if (x.kind === 'threshold') x.bands[i].price = v ?? 0; })} />
              {b.upTo !== null && st.bands.length > 2 && <Button size="icon" variant="ghost" aria-label="Remove band" onClick={() => set((x) => { if (x.kind === 'threshold') x.bands.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set((x) => {
            if (x.kind !== 'threshold') return;
            const nums = x.bands.map((b) => b.upTo).filter((u): u is number => u !== null);
            x.bands.splice(x.bands.length - 1, 0, { upTo: (nums.length ? Math.max(...nums) : 0) + 10, price: 0 });
          })}><Plus className="w-4 h-4 mr-1" />Add a band</Button>
        </div>
      );
    case 'measurement':
      return (
        <div className="space-y-3">
          <MoneyField label={`Price per ${labelOf(service, st.question).toLowerCase()} unit`} value={st.perUnit} onChange={(v) => set((x) => { if (x.kind === 'measurement') x.perUnit = v ?? 0; })} />
          {(st.variants ?? []).map((v, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="text-sm font-medium">When "{labelOf(service, v.when.question)}" is yes</div>
              {v.range ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <MoneyField label="Low" value={v.range.low} onChange={(n) => set((x) => { if (x.kind === 'measurement') x.variants![i].range!.low = n ?? 0; })} />
                  <MoneyField label="High" value={v.range.high} onChange={(n) => set((x) => { if (x.kind === 'measurement') x.variants![i].range!.high = n ?? 0; })} />
                  <ChoiceField label="Which to use" value={v.range.rule ?? undefined}
                    options={[['low', 'Always the low end'], ['mid', 'The middle'], ['high', 'Always the high end'], ['ask', 'The salesperson picks']]}
                    onChange={(r) => edit((s) => {
                      const x = s.strategy;
                      if (x.kind !== 'measurement') return;
                      const variant = x.variants![i];
                      variant.range!.rule = r as 'low' | 'mid' | 'high' | 'ask';
                      if (r === 'ask') {
                        variant.rateQuestion ??= `rate_${i + 1}`;
                        if (!s.questions.some((q) => q.key === variant.rateQuestion)) {
                          s.questions.push({ key: variant.rateQuestion, label: `Rate per unit when ${labelOf(s, variant.when.question).toLowerCase()}`, kind: 'number', unit: '$' });
                        }
                      }
                    })} />
                </div>
              ) : (
                <MoneyField label="Price per unit then" value={v.perUnit ?? 0} onChange={(n) => set((x) => { if (x.kind === 'measurement') x.variants![i].perUnit = n ?? 0; })} />
              )}
            </div>
          ))}
        </div>
      );
    case 'time_block':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="Block length" unit="min" max={480} value={st.blockMinutes} onChange={(v) => set((x) => { if (x.kind === 'time_block') x.blockMinutes = Math.max(5, Math.round(v ?? 60)); })} />
          <MoneyField label="Price per block" value={st.blockPrice} onChange={(v) => set((x) => { if (x.kind === 'time_block') x.blockPrice = v ?? 0; })} />
        </div>
      );
    case 'per_dbh':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField label="Price per DBH inch" value={st.perInch} onChange={(v) => set((x) => { if (x.kind === 'per_dbh') x.perInch = v ?? 0; })} />
          <MoneyField label="Minimum per tree" optional value={st.perTreeMinimum} onChange={(v) => set((x) => { if (x.kind === 'per_dbh') x.perTreeMinimum = v; })} />
        </div>
      );
    case 'height':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <MoneyField label="Price per foot" value={st.perFoot} onChange={(v) => set((x) => { if (x.kind === 'height') x.perFoot = v ?? 0; })} />
          <NumberField label="Highest it counts" unit="ft" optional max={200} value={st.maxHeight} onChange={(v) => set((x) => { if (x.kind === 'height') x.maxHeight = v; })} />
          <MoneyField label="Most it costs" optional value={st.maxPrice} onChange={(v) => set((x) => { if (x.kind === 'height') x.maxPrice = v; })} />
        </div>
      );
    case 'matrix':
      return <MatrixEditor service={service} edit={edit} />;
    case 'crew_time':
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Priced from the crew and time the salesperson picks, using {def.pricing.method === 'cost_plus' ? 'your pay rates plus your target return' : `your man-hour rate (${def.pricing.manHourRate ? dollars(def.pricing.manHourRate) : 'not set yet'})`}. Change it under Pricing method.
          </p>
          <div className="space-y-2">
            <Label className="text-xs">Day prices (optional): a set price once a crew works a full day</Label>
            {(st.floors ?? []).map((f, i) => (
              <div key={f.key} className="grid gap-2 grid-cols-[1fr_1fr_1fr_auto] items-end">
                <NumberField label="Crew size" max={30} value={f.headcount} onChange={(v) => set((x) => { if (x.kind === 'crew_time') x.floors![i].headcount = v ? Math.round(v) : undefined; })} />
                <NumberField label="From hours" unit="hr" max={24} value={f.minHours} onChange={(v) => set((x) => { if (x.kind === 'crew_time') x.floors![i].minHours = v ?? 8; })} />
                <MoneyField label="Day price" value={f.price} onChange={(v) => set((x) => { if (x.kind === 'crew_time') x.floors![i].price = v ?? 0; })} />
                <Button size="icon" variant="ghost" aria-label="Remove day price" onClick={() => set((x) => { if (x.kind === 'crew_time') x.floors!.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => set((x) => { if (x.kind === 'crew_time') (x.floors ??= []).push({ key: keyFor(`day ${(x.floors?.length ?? 0) + 1}`, (x.floors ?? []).map((f) => f.key)), minHours: def.pricing.dayHours, headcount: 4, price: 0 }); })}>
              <Plus className="w-4 h-4 mr-1" />Add a day price
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Equipment charges (optional): added when the answer is yes</Label>
            {(st.equipmentAdders ?? []).map((a, i) => (
              <div key={i} className="grid gap-2 grid-cols-[1fr_1fr_1fr_auto] items-end">
                <ChoiceField label="When" value={a.question} options={service.questions.filter((q) => q.kind === 'yes_no').map((q) => [q.key, q.label] as [string, string])}
                  onChange={(v) => set((x) => { if (x.kind === 'crew_time') { x.equipmentAdders![i].question = v; x.equipmentAdders![i].equipment = v; } })} />
                <MoneyField label="Per hour" value={a.perHour ?? 0} onChange={(v) => set((x) => { if (x.kind === 'crew_time') x.equipmentAdders![i].perHour = v || undefined; })} />
                <MoneyField label="Per job" value={a.perJob ?? 0} onChange={(v) => set((x) => { if (x.kind === 'crew_time') x.equipmentAdders![i].perJob = v || undefined; })} />
                <Button size="icon" variant="ghost" aria-label="Remove charge" onClick={() => set((x) => { if (x.kind === 'crew_time') x.equipmentAdders!.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
            {service.questions.some((q) => q.kind === 'yes_no') && (
              <Button size="sm" variant="outline" onClick={() => set((x) => {
                if (x.kind !== 'crew_time') return;
                const q = service.questions.find((qq) => qq.kind === 'yes_no')!;
                (x.equipmentAdders ??= []).push({ question: q.key, equipment: q.key, perJob: 0 });
              })}><Plus className="w-4 h-4 mr-1" />Add a charge</Button>
            )}
          </div>
        </div>
      );
    case 'recurring_plan':
      return (
        <div className="space-y-2">
          {st.classes.map((c, i) => (
            <div key={c.value} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_0.7fr_0.7fr_auto] items-end">
              <TextField label="Class" value={c.label} max={120} onChange={(v) => set((x) => { if (x.kind === 'recurring_plan') x.classes[i].label = v || x.classes[i].label; })} />
              <MoneyField label="To start" value={c.initial} onChange={(v) => set((x) => { if (x.kind === 'recurring_plan') x.classes[i].initial = v ?? 0; })} />
              <MoneyField label="Monthly" value={c.monthly} onChange={(v) => set((x) => { if (x.kind === 'recurring_plan') x.classes[i].monthly = v ?? 0; })} />
              <NumberField label="Months" max={120} value={c.months} onChange={(v) => set((x) => { if (x.kind === 'recurring_plan') x.classes[i].months = Math.round(v ?? 12); })} />
              <NumberField label="Visits" max={366} value={c.visits} onChange={(v) => set((x) => { if (x.kind === 'recurring_plan') x.classes[i].visits = Math.round(v ?? 0); })} />
              {st.classes.length > 1 && <Button size="icon" variant="ghost" aria-label="Remove class" onClick={() => edit((s) => {
                if (s.strategy.kind !== 'recurring_plan') return; const v = s.strategy.classes[i].value;
                s.strategy.classes.splice(i, 1); const q = s.questions.find((qq) => qq.key === (s.strategy as { classQuestion: string }).classQuestion);
                if (q?.choices) q.choices = q.choices.filter((ch) => ch.value !== v);
              })}><Trash2 className="w-4 h-4" /></Button>}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => edit((s) => {
            if (s.strategy.kind !== 'recurring_plan') return;
            const value = keyFor(`class ${s.strategy.classes.length + 1}`, s.strategy.classes.map((c) => c.value));
            s.strategy.classes.push({ value, label: `Class ${s.strategy.classes.length + 1}`, initial: 0, monthly: 0, months: 12, visits: 0 });
            const q = s.questions.find((qq) => qq.key === (s.strategy as { classQuestion: string }).classQuestion);
            if (q) (q.choices ??= []).push({ value, label: `Class ${s.strategy.classes.length}` });
          })}><Plus className="w-4 h-4 mr-1" />Add a class</Button>
        </div>
      );
    case 'sub_bid':
      return <NumberField label="Margin on the sub's price" unit="%" max={95} value={Math.round(st.margin * 100)} onChange={(v) => set((x) => { if (x.kind === 'sub_bid') x.margin = Math.min(0.95, (v ?? 0) / 100); })} />;
    case 'manual':
      return <p className="text-sm text-muted-foreground">The salesperson types the price each time.</p>;
  }
}

function MatrixEditor({ service, edit }: { service: Service; edit: (fn: (s: Service) => void) => void }) {
  const st = service.strategy;
  if (st.kind !== 'matrix') return null;
  const cols = st.cols ?? [];
  const cellKey = (r: string, c?: string) => (c ? `${r}|${c}` : r);
  const addRow = () => edit((s) => {
    if (s.strategy.kind !== 'matrix') return;
    const label = `Type ${s.strategy.rows.length + 1}`;
    const value = keyFor(label, s.strategy.rows.map((r) => r.value));
    s.strategy.rows.push({ value, label });
    const q = s.questions.find((x) => x.key === (s.strategy as { rowQuestion: string }).rowQuestion);
    if (q) (q.choices ??= []).push({ value, label });
    for (const c of s.strategy.cols ?? []) s.strategy.cells[cellKey(value, c.value)] = 0;
    if (!(s.strategy.cols ?? []).length) s.strategy.cells[value] = 0;
  });
  return (
    <div className="space-y-2 overflow-x-auto">
      <table className="text-sm border-separate border-spacing-1">
        <thead>
          <tr>
            <th />
            {cols.map((c) => <th key={c.value} className="text-xs font-medium text-muted-foreground px-1">{c.label}</th>)}
            {cols.length === 0 && <th className="text-xs font-medium text-muted-foreground px-1">Price</th>}
          </tr>
        </thead>
        <tbody>
          {st.rows.map((r, ri) => (
            <tr key={r.value}>
              <td><Input value={r.label} maxLength={60} aria-label="Row name" className="w-36" onChange={(e) => edit((s) => {
                if (s.strategy.kind !== 'matrix') return; const v = e.target.value || s.strategy.rows[ri].label; s.strategy.rows[ri].label = v;
                const q = s.questions.find((x) => x.key === (s.strategy as { rowQuestion: string }).rowQuestion);
                const ch = q?.choices?.find((x) => x.value === r.value); if (ch) ch.label = v;
              })} /></td>
              {(cols.length ? cols : [undefined]).map((c) => {
                const k = cellKey(r.value, c?.value);
                const v = st.cells[k];
                return (
                  <td key={k}>
                    <div className="relative w-28">
                      <span className="absolute left-2 top-2 text-sm text-muted-foreground">$</span>
                      <Input type="number" inputMode="decimal" min={0} className="pl-5" value={v ?? ''} placeholder="Not offered" aria-label={`${r.label}${c ? ` ${c.label}` : ''} price`}
                        onChange={(e) => edit((s) => { if (s.strategy.kind === 'matrix') s.strategy.cells[k] = e.target.value === '' ? null : clampTyped(e.target.value, RATE_CARD_MONEY_MAX); })} />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">Leave a box empty when you don't sell that size.</p>
      <Button size="sm" variant="outline" onClick={addRow}><Plus className="w-4 h-4 mr-1" />Add a row</Button>
    </div>
  );
}

function SpeciesEditor({ service, edit }: { service: Service; edit: (fn: (s: Service) => void) => void }) {
  const rules = service.species ?? [];
  return (
    <Section title="Recommended species" hint="Which trees you recommend for a site, so salespeople don't need to remember the list. Separate from the price."
      action={<Button size="sm" variant="outline" onClick={() => edit((s) => { (s.species ??= []).push({ type: 'shade', light: ['full_sun'], moisture: ['average'], species: [] }); })}><Plus className="w-4 h-4 mr-1" />Add</Button>}>
      {rules.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_2fr_auto] items-end">
          <TextField label="Type" value={r.type} max={40} onChange={(v) => edit((s) => { s.species![i].type = v || r.type; })} />
          <ChoiceField label="Light" value={r.light[0]} options={[['full_sun', 'Full sun'], ['part_shade', 'Part shade'], ['shade', 'Shade']]} onChange={(v) => edit((s) => { s.species![i].light = [v]; })} />
          <ChoiceField label="Moisture" value={r.moisture[0]} options={[['dry', 'Dry'], ['average', 'Average'], ['wet', 'Wet']]} onChange={(v) => edit((s) => { s.species![i].moisture = [v]; })} />
          <ListField label="Species (comma between)" value={r.species} max={40} onChange={(v) => edit((s) => { s.species![i].species = v; })} />
          <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => edit((s) => { s.species!.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
        </div>
      ))}
    </Section>
  );
}

function TryIt({ service, def }: { service: Service; def: StepProps['def'] }) {
  const [answers, setAnswers] = useState<Answers>({});
  const r = priceWorkItem(def, { ...service, offered: true, sellMonths: undefined }, answers, { day: today() });
  return (
    <Section title="Try it" hint="Answer as a salesperson would and see the price.">
      <QuestionInputs questions={service.questions} answers={answers} onChange={setAnswers} idPrefix={`try-${service.key}`} />
      <div className="rounded-md bg-muted p-3 text-sm">
        {r.kind === 'ok' && (<><div className="text-lg font-semibold">{dollars(r.engineAmount)}</div><ul className="text-xs text-muted-foreground">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
        {r.kind === 'missing' && <span className="text-muted-foreground">Answer: {r.missing.map((k) => labelOf(service, k)).join(', ')}</span>}
        {r.kind === 'blocked' && <span className="text-destructive">{r.reason}</span>}
        {r.kind === 'not_offered' && <span className="text-muted-foreground">{r.reason}</span>}
      </div>
    </Section>
  );
}

function labelOf(s: Service, key: string): string {
  return s.questions.find((q) => q.key === key)?.label ?? key.replace(/_/g, ' ');
}
