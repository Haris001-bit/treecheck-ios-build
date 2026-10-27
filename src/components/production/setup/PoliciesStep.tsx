import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/lib/auth';
import { Section, TextField, NumberField, MoneyField, ToggleRow, ChoiceField, ListField } from './fields';
import { keyFor } from './keys';
import type { StepProps } from './types';

export function PoliciesStep({ def, update, settings, updateSettings, members }: StepProps) {
  const { user } = useAuth();
  const p = def.policies;
  const c = p.consultation;
  const isa = settings.isa_credentials ?? {};
  const people = [...(settings.contractor_id === user?.id ? [{ user_id: user.id, email: user.email ?? 'You' }] : []), ...members.map((m) => ({ user_id: m.user_id, email: m.email }))];
  const resourceKeys = [...new Set([...(settings.resources ?? []).map((r) => r.key), ...def.bundles.flatMap((b) => b.equipment)])];

  return (
    <div className="space-y-4">
      <Section title="The consultation block" hint="The first line of every proposal: who looked at the job, their credential, when work is expected to start, and what happens after approval.">
        <ToggleRow label="Show the salesperson's name" checked={c.showSalesperson} onChange={(v) => update((d) => { d.policies.consultation.showSalesperson = v; })} />
        <ToggleRow label="Show the ISA credential" checked={c.showIsa} onChange={(v) => update((d) => { d.policies.consultation.showIsa = v; })} />
        <ToggleRow label="Show the expected start" hint="Worked out from how much work is booked." checked={c.showWorkWindow} onChange={(v) => update((d) => { d.policies.consultation.showWorkWindow = v; })} />
        <ToggleRow label="Explain the next steps" checked={c.showNextSteps} onChange={(v) => update((d) => { d.policies.consultation.showNextSteps = v; })} />
        <TextField label="Opening text" value={c.text} multiline max={1500} onChange={(v) => update((d) => { d.policies.consultation.text = v; })} />
        <TextField label="Next steps after approval" value={c.nextStepsText} multiline max={1500} onChange={(v) => update((d) => { d.policies.consultation.nextStepsText = v; })} />
        {c.showIsa && people.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">ISA credentials</Label>
            {people.map((m) => (
              <div key={m.user_id} className="grid gap-2 sm:grid-cols-[1fr_12rem] items-center">
                <span className="text-sm break-all">{m.email}</span>
                <TextField label="Credential" value={isa[m.user_id] ?? ''} max={40} placeholder="For example OK-1234A"
                  onChange={(v) => updateSettings({ isa_credentials: { ...isa, [m.user_id]: v } })} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Discounts" hint="The discounts a salesperson may apply. If two of yours disagree, Open items asks which is current."
        action={<Button size="sm" variant="outline" onClick={() => update((d) => { d.policies.discounts.push({ key: keyFor(`discount ${d.policies.discounts.length + 1}`, d.policies.discounts.map((x) => x.key)), label: 'Discount', percent: 5, categories: [] }); })}><Plus className="w-4 h-4 mr-1" />Add</Button>}>
        {p.discounts.length === 0 && <p className="text-sm text-muted-foreground">No discounts.</p>}
        {p.discounts.map((x, i) => (
          <div key={x.key} className="grid gap-2 sm:grid-cols-[1.5fr_6rem_1.5fr_auto] items-end">
            <TextField label="Name" value={x.label} max={120} onChange={(v) => update((d) => { d.policies.discounts[i].label = v || x.label; })} />
            <NumberField label="Percent" unit="%" max={100} value={x.percent} onChange={(v) => update((d) => { d.policies.discounts[i].percent = v ?? 0; })} />
            <ListField label="Who qualifies (comma between)" value={x.categories ?? []} itemMax={60} onChange={(v) => update((d) => { d.policies.discounts[i].categories = v.map((s) => s.toLowerCase()); })} />
            <Button size="icon" variant="ghost" aria-label="Remove discount" onClick={() => update((d) => { d.policies.discounts.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </Section>

      <Section title="Payment plans" hint="The deposit goes on the Jobber quote; the terms text explains the rest to the customer."
        action={<Button size="sm" variant="outline" onClick={() => update((d) => { d.policies.paymentPlans.push({ key: keyFor(`plan ${d.policies.paymentPlans.length + 1}`, d.policies.paymentPlans.map((x) => x.key)), label: 'Payment plan', depositPercent: 25, installments: 2, termsText: '' }); })}><Plus className="w-4 h-4 mr-1" />Add</Button>}>
        {p.paymentPlans.length === 0 && <p className="text-sm text-muted-foreground">No payment plans.</p>}
        {p.paymentPlans.map((x, i) => (
          <div key={x.key} className="rounded-md border p-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-[1.5fr_7rem_7rem_auto] items-end">
              <TextField label="Name" value={x.label} max={120} onChange={(v) => update((d) => { d.policies.paymentPlans[i].label = v || x.label; })} />
              <NumberField label="Deposit" unit="%" max={100} value={x.depositPercent} onChange={(v) => update((d) => { d.policies.paymentPlans[i].depositPercent = v ?? 0; })} />
              <NumberField label="Payments" max={36} value={x.installments} onChange={(v) => update((d) => { d.policies.paymentPlans[i].installments = Math.max(1, Math.round(v ?? 1)); })} />
              <Button size="icon" variant="ghost" aria-label="Remove plan" onClick={() => update((d) => { d.policies.paymentPlans.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
            </div>
            <TextField label="Terms the customer reads" value={x.termsText} multiline max={600} onChange={(v) => update((d) => { d.policies.paymentPlans[i].termsText = v; })} />
          </div>
        ))}
        <TextField label="Financing (optional text, for example a Wisetack note)" value={p.financingText ?? ''} multiline max={600} onChange={(v) => update((d) => { d.policies.financingText = v || undefined; })} />
      </Section>

      <Section title="Commission" hint="What sales commission counts. Outside resources you pass through (a crane, a grapple truck) can be left out, and a set amount taken off when they're on the job.">
        <div className="flex flex-wrap gap-3">
          {resourceKeys.map((k) => (
            <label key={k} className="flex items-center gap-1 text-xs">
              <Checkbox checked={p.commission.excludedResources.includes(k)} onCheckedChange={(on) => update((d) => {
                const cur = new Set(d.policies.commission.excludedResources); if (on) cur.add(k); else cur.delete(k); d.policies.commission.excludedResources = [...cur];
              })} />Leave out {k.replace(/_/g, ' ')}
            </label>
          ))}
        </div>
        {p.commission.deductions.map((x, i) => (
          <div key={i} className="grid gap-2 grid-cols-[1fr_1fr_auto] items-end">
            <ChoiceField label="When on the job" value={x.resource} options={resourceKeys.map((k) => [k, k.replace(/_/g, ' ')] as [string, string])} onChange={(v) => update((d) => { d.policies.commission.deductions[i].resource = v; })} />
            <MoneyField label="Take off" value={x.amount} onChange={(v) => update((d) => { d.policies.commission.deductions[i].amount = v ?? 0; })} />
            <Button size="icon" variant="ghost" aria-label="Remove" onClick={() => update((d) => { d.policies.commission.deductions.splice(i, 1); })}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
        {resourceKeys.length > 0 && <Button size="sm" variant="ghost" onClick={() => update((d) => { d.policies.commission.deductions.push({ resource: resourceKeys[0], amount: 0 }); })}><Plus className="w-4 h-4 mr-1" />Add a deduction</Button>}
        <NumberField label="Commission rate (optional)" unit="%" optional max={100} value={p.commission.rate !== undefined ? Math.round(p.commission.rate * 1000) / 10 : undefined}
          onChange={(v) => update((d) => { d.policies.commission.rate = v === undefined ? undefined : Math.min(1, v / 100); })} />
      </Section>

      <Section title="Rounding and override reasons">
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceField label="Round prices to" value={String(p.rounding.to)} options={[['1', '$1'], ['5', '$5'], ['10', '$10'], ['25', '$25'], ['50', '$50']]}
            onChange={(v) => update((d) => { d.policies.rounding.to = Number(v) as 1 | 5 | 10 | 25 | 50; })} />
          <ChoiceField label="How" value={p.rounding.mode} options={[['nearest', 'To the nearest'], ['up', 'Always up']]} onChange={(v) => update((d) => { d.policies.rounding.mode = v; })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['lower', 'higher'] as const).map((dir) => (
            <ListField key={dir} lines max={12} itemMax={60} label={`Reasons for a ${dir} price (one per line)`} value={p.overrideReasons?.[dir] ?? []}
              onChange={(lines) => update((d) => { d.policies.overrideReasons = { lower: d.policies.overrideReasons?.lower ?? [], higher: d.policies.overrideReasons?.higher ?? [], [dir]: lines }; })} />
          ))}
        </div>
      </Section>
    </div>
  );
}
