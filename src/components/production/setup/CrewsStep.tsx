import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ProductionCostsForm } from '@/components/production/ProductionCostsForm';
import { useProductionConfig } from '@/hooks/useProductionConfig';
import type { ResourceRow } from '@/lib/production/client';
import { Section, NumberField, MoneyField, TextField, ChoiceField } from './fields';
import { keyFor } from './keys';
import type { StepProps } from './types';

export function CrewsStep({ def, update, settings, updateSettings, status }: StepProps) {
  const { data: costs } = useProductionConfig();
  const roleOptions = (costs?.roles ?? []).map((r) => [r.role_key, r.name] as [string, string]);
  const equipmentKeys = [...new Set([...(costs?.equipment ?? []).map((e) => e.equipment_key), ...def.bundles.flatMap((b) => b.equipment), ...(settings.resources ?? []).map((r) => r.key)])];
  const nameOf = (k: string) => costs?.equipment.find((e) => e.equipment_key === k)?.name ?? (settings.resources ?? []).find((r) => r.key === k)?.name ?? k.replace(/_/g, ' ');
  const branches = settings.basics?.branches ?? [];
  const counts = settings.crew_counts ?? {};
  const resources = settings.resources ?? [];
  const setResources = (next: ResourceRow[]) => updateSettings({ resources: next });

  const countOf = (crew: string, branch?: string) => {
    const v = counts[crew];
    if (typeof v === 'number') return branch ? undefined : v;
    return branch ? v?.[branch] : undefined;
  };
  const setCount = (crew: string, n: number, branch?: string) => {
    const cur = counts[crew];
    const next = branch ? { ...(typeof cur === 'object' && cur ? cur : {}), [branch]: n } : n;
    updateSettings({ crew_counts: { ...counts, [crew]: next } });
  };

  return (
    <div className="space-y-4">
      <Section title="Crew templates" hint="The crews your salespeople pick from, such as a 3-person climb crew. Pick a crew and a time, and TreeCheck works out the price and what the job needs."
        action={<Button size="sm" variant="outline" onClick={() => update((d) => { d.crews.push({ key: keyFor(`crew ${d.crews.length + 1}`, d.crews.map((c) => c.key)), name: `Crew ${d.crews.length + 1}`, roles: [{ roleKey: roleOptions[0]?.[0] ?? 'ground', count: 2 }] }); })}><Plus className="w-4 h-4 mr-1" />Add crew</Button>}>
        {def.crews.map((c, i) => (
          <div key={c.key} className="rounded-md border p-3 space-y-2">
            <div className="flex gap-2">
              <Input value={c.name} maxLength={120} aria-label="Crew name" onChange={(e) => update((d) => { d.crews[i].name = e.target.value || d.crews[i].name; })} />
              <Button size="icon" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => update((d) => { d.crews.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
            </div>
            {c.roles.map((r, ri) => (
              <div key={ri} className="flex items-end gap-2">
                <ChoiceField className="flex-1" label="Role" value={r.roleKey} options={roleOptions.length ? roleOptions : [[r.roleKey, r.roleKey]]}
                  onChange={(v) => update((d) => { d.crews[i].roles[ri].roleKey = v; })} />
                <NumberField className="w-24" label="How many" max={20} value={r.count} onChange={(v) => update((d) => { d.crews[i].roles[ri].count = Math.max(1, Math.round(v ?? 1)); })} />
                {c.roles.length > 1 && <Button size="icon" variant="ghost" aria-label="Remove role" onClick={() => update((d) => { d.crews[i].roles.splice(ri, 1); })}><Trash2 className="w-4 h-4" /></Button>}
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => update((d) => { d.crews[i].roles.push({ roleKey: roleOptions[0]?.[0] ?? 'ground', count: 1 }); })}><Plus className="w-4 h-4 mr-1" />Add a role</Button>
            {def.pricing.method === 'man_hour' && (
              <MoneyField label="Man-hour rate for this crew (leave empty to use the company rate)" optional value={c.manHourRate} onChange={(v) => update((d) => { d.crews[i].manHourRate = v; })} />
            )}
            <div className="flex flex-wrap gap-3">
              {equipmentKeys.map((k) => (
                <label key={k} className="flex items-center gap-1 text-xs">
                  <Checkbox checked={(c.equipment ?? []).includes(k)} onCheckedChange={(on) => update((d) => {
                    const cur = new Set(d.crews[i].equipment ?? []); if (on) cur.add(k); else cur.delete(k); d.crews[i].equipment = [...cur];
                  })} />{nameOf(k)}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Ticked equipment is what this crew usually brings.</p>
          </div>
        ))}
      </Section>

      <Section title="How many crews you run" hint="Capacity planning compares sold work with this.">
        {def.crews.map((c) => (
          <div key={c.key} className="flex flex-wrap items-end gap-3">
            <div className="w-48 text-sm pb-2">{c.name}</div>
            {branches.length === 0
              ? <NumberField className="w-28" label="Crews" max={100} value={countOf(c.key) ?? 0} onChange={(v) => setCount(c.key, Math.round(v ?? 0))} />
              : branches.map((b) => <NumberField key={b.key} className="w-28" label={b.name || 'Branch'} max={100} value={countOf(c.key, b.key) ?? 0} onChange={(v) => setCount(c.key, Math.round(v ?? 0), b.key)} />)}
          </div>
        ))}
      </Section>

      <Section title="Equipment and outside resources" hint="How many of each you have and how many hours a day each can work. Mark cranes and grapple trucks you hire as vendor."
        action={<Button size="sm" variant="outline" onClick={() => setResources([...resources, { key: keyFor(`resource ${resources.length + 1}`, resources.map((r) => r.key)), name: '', ownership: 'owned', units: 1, hoursPerDay: 8, leadTimeDays: 0 }])}><Plus className="w-4 h-4 mr-1" />Add</Button>}>
        {resources.length === 0 && equipmentKeys.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setResources(equipmentKeys.map((k) => ({ key: k, name: nameOf(k), ownership: k === 'crane' || k === 'grapple_truck' ? 'vendor' : 'owned', units: 1, hoursPerDay: 8, leadTimeDays: k === 'crane' ? 3 : 0 })))}>
            Fill in from your equipment list
          </Button>
        )}
        {resources.map((r, i) => (
          <div key={r.key} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_0.7fr_0.8fr_0.8fr_auto] items-end">
            <TextField label="Name" value={r.name} max={60} onChange={(v) => setResources(resources.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
            <ChoiceField label="Ours or hired" value={r.ownership} options={[['owned', 'We own it'], ['rented', 'We rent it'], ['vendor', 'Outside vendor']]}
              onChange={(v) => setResources(resources.map((x, j) => (j === i ? { ...x, ownership: v } : x)))} />
            <NumberField label="How many" max={100} value={r.units} onChange={(v) => setResources(resources.map((x, j) => (j === i ? { ...x, units: Math.round(v ?? 0) } : x)))} />
            <NumberField label="Hours a day" max={24} value={r.hoursPerDay} onChange={(v) => setResources(resources.map((x, j) => (j === i ? { ...x, hoursPerDay: v ?? 0 } : x)))} />
            <NumberField label="Days notice" max={60} value={r.leadTimeDays} onChange={(v) => setResources(resources.map((x, j) => (j === i ? { ...x, leadTimeDays: Math.round(v ?? 0) } : x)))} />
            <Button size="icon" variant="ghost" aria-label="Remove resource" onClick={() => setResources(resources.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </Section>

      {status.can.costs ? (
        <div className="space-y-2">
          <div className="font-semibold">Pay and equipment costs</div>
          <p className="text-xs text-muted-foreground">Only you and the people you picked as cost viewers see this. Pay plus target return pricing and every margin use these numbers.</p>
          <ProductionCostsForm withUnits />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Pay rates and costs are visible to the owner and chosen cost viewers only.</p>
      )}
    </div>
  );
}
