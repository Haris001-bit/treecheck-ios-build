import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { DEFAULT_BASICS } from '@/lib/production/client';
import { Section, NumberField, TextField, ToggleRow } from './fields';
import { JobberExtrasCard } from './JobberExtrasCard';
import { keyFor } from './keys';
import type { StepProps } from './types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRICE_KEYS = ['createScout', 'reviewEstimates', 'operationalSettings', 'manageJobsSubs'];

export function BasicsStep({ def, update, settings, updateSettings, status, members }: StepProps) {
  const { data: company } = useCompanySettings();
  const basics = { ...DEFAULT_BASICS, ...settings.basics };
  const setBasics = (patch: Partial<typeof basics>) => updateSettings({ basics: { ...basics, ...patch } });
  const branches = basics.branches ?? [];
  const days = basics.workingDays ?? [];
  const viewers = settings.cost_viewer_ids ?? [];
  const eligibleViewers = members.filter((m) => PRICE_KEYS.some((k) => m.permissions?.[k] === true));

  return (
    <div className="space-y-4">
      <Section title="How your company works" hint="Capacity planning and the expected start date on quotes use these.">
        <div>
          <Label className="text-xs">Working days</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {DAYS.map((d, i) => (
              <Button key={d} type="button" size="sm" variant={days.includes(i) ? 'default' : 'outline'}
                onClick={() => setBasics({ workingDays: days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort() })}>{d}</Button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label="Normal production day" unit="hours" max={24} value={basics.dayHours}
            onChange={(v) => { setBasics({ dayHours: v ?? 8 }); update((x) => { x.pricing.dayHours = v ?? 8; }); }} />
          <NumberField label="Sales tax (for reports; Jobber adds tax to quotes)" unit="%" max={30} optional value={basics.taxRate ?? undefined}
            onChange={(v) => setBasics({ taxRate: v ?? null })} />
        </div>
        <TextField label="Service territory" placeholder="For example: Oklahoma City metro, 40 miles from Edmond" value={basics.territory}
          onChange={(v) => setBasics({ territory: v })} max={200} />
        <p className="text-xs text-muted-foreground">Business software: {company?.crm ? String(company.crm) : 'not set'}. Change it under How we work.</p>
      </Section>

      <Section title="Branches" hint="Only if rates or crews differ by location. Leave empty for one location."
        action={<Button size="sm" variant="outline" onClick={() => setBasics({ branches: [...branches, { key: keyFor(`branch ${branches.length + 1}`, branches.map((b) => b.key)), name: '' }] })}><Plus className="w-4 h-4 mr-1" />Add</Button>}>
        {branches.length === 0 && <p className="text-sm text-muted-foreground">One location.</p>}
        {branches.map((b, i) => (
          <div key={b.key} className="flex gap-2">
            <Input value={b.name} placeholder="Branch name" aria-label="Branch name" maxLength={60}
              onChange={(e) => setBasics({ branches: branches.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <Button size="icon" variant="ghost" aria-label="Remove branch" onClick={() => setBasics({ branches: branches.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button>
          </div>
        ))}
      </Section>

      <Section title="Who sees costs and margins" hint="Customer prices show to your salespeople and office. Pay rates, internal costs, margins and commission show only to you and the people you pick here. Crew leaders never see prices.">
        {!status.is_owner && <p className="text-sm text-muted-foreground">Only the company owner chooses this.</p>}
        {status.is_owner && eligibleViewers.length === 0 && <p className="text-sm text-muted-foreground">No team members with sales, office or setup access yet.</p>}
        {status.is_owner && eligibleViewers.map((m) => (
          <label key={m.user_id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={viewers.includes(m.user_id)}
              onCheckedChange={(c) => updateSettings({ cost_viewer_ids: c ? [...viewers, m.user_id] : viewers.filter((v) => v !== m.user_id) })} />
            <span className="break-all">{m.email}</span>
          </label>
        ))}
        {status.is_owner && (
          <ToggleRow label="Send internal costs to Jobber" hint="Jobber keeps each line's cost for its job costing and hides it from customers. Off unless you use Jobber's job costing."
            checked={!!settings.send_unit_cost} onChange={(v) => updateSettings({ send_unit_cost: v })} />
        )}
      </Section>
      <JobberExtrasCard status={status} />
      <p className="text-xs text-muted-foreground">Prices on this card: {def.services.filter((s) => s.offered !== false).length} services offered.</p>
    </div>
  );
}
