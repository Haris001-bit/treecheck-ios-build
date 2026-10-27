import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useProductionConfig } from '@/hooks/useProductionConfig';
import { recommendPrice } from '@/lib/production/engine';
import { dollars } from '@/lib/production/answers';
import { CATEGORIES, type Category } from '@/lib/production/rules';
import { Section, MoneyField, NumberField } from './fields';
import { CATEGORY_LABELS } from './serviceTemplates';
import type { StepProps } from './types';

export function MethodStep({ def, update, status, goTo }: StepProps) {
  const { data: costs } = useProductionConfig();
  const margin = costs?.pricing.target_margin ?? 0.3;
  const example = recommendPrice(1000, { targetMargin: margin });
  return (
    <div className="space-y-4">
      <Section title="How crew time is priced" hint="Removals, pruning and other crew work use this. Unit prices (cables, stumps, planting) don't.">
        <RadioGroup value={def.pricing.method} onValueChange={(v) => update((d) => { d.pricing.method = v as 'man_hour' | 'cost_plus'; })} className="space-y-2">
          <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
            <RadioGroupItem value="man_hour" id="method-man-hour" className="mt-1" />
            <span>
              <Label htmlFor="method-man-hour" className="font-medium">Revenue per man-hour</Label>
              <span className="block text-xs text-muted-foreground">Crew size × hours × your rate. A 3-person crew for 4 hours at $125 is $1,500, before minimums and day prices.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
            <RadioGroupItem value="cost_plus" id="method-cost-plus" className="mt-1" />
            <span>
              <Label htmlFor="method-cost-plus" className="font-medium">Pay plus a target return</Label>
              <span className="block text-xs text-muted-foreground">Each worker's loaded pay and each machine's cost, priced so your return is a share of the sale. Selling rates are fixed when you publish, so later pay changes never reprice old quotes.</span>
            </span>
          </label>
        </RadioGroup>
        {def.pricing.method === 'man_hour' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyField label="Revenue per man-hour" value={def.pricing.manHourRate} onChange={(v) => update((d) => { d.pricing.manHourRate = v; })} />
            <NumberField label="Normal production day" unit="hours" max={24} value={def.pricing.dayHours} onChange={(v) => update((d) => { d.pricing.dayHours = v ?? 8; })} />
          </div>
        )}
        {def.pricing.method === 'cost_plus' && (
          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            {status.can.costs
              ? <p>Your target return is {Math.round(margin * 100)}%: $1,000 of cost is priced at {dollars(example.price)}. That's a margin on the sale, never cost × {(1 + margin).toFixed(2)}.</p>
              : <p>Your target return and pay rates are visible to the owner and cost viewers.</p>}
            <button type="button" className="text-primary underline text-xs" onClick={() => goTo('crews')}>Set pay rates and the target return under Crews and equipment</button>
          </div>
        )}
      </Section>

      <Section title="Workload pricing" hint="Named price levels for busy and slow times. An admin switches between them (or schedules them); salespeople just see today's price. TreeCheck may suggest a change from your backlog, but never changes prices by itself.">
        {def.profiles.map((p, i) => (
          <div key={p.key} className="rounded-md border p-3 space-y-2">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <div className="text-sm font-medium self-end pb-2">{p.name}</div>
              <NumberField label="Change" unit="%" max={200} value={p.percent} onChange={(v) => update((d) => { d.profiles[i].percent = v ?? 0; })} />
            </div>
            {p.key !== 'normal' && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Different change by kind of work</summary>
                <div className="grid gap-2 sm:grid-cols-3 mt-2">
                  {CATEGORIES.filter((c) => c !== 'other').map((c: Category) => (
                    <NumberField key={c} label={CATEGORY_LABELS[c]} unit="%" max={200} optional value={p.byCategory?.[c]}
                      onChange={(v) => update((d) => { const bc = { ...(d.profiles[i].byCategory ?? {}) }; if (v === undefined) delete bc[c]; else bc[c] = v; d.profiles[i].byCategory = bc; })} />
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Switch or schedule levels from Jobs, under Reports, once this card is published.</p>
      </Section>
    </div>
  );
}
