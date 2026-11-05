import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Loader2, Save } from 'lucide-react';
import { emptyPricingInputs, withOwnerRates, type OwnerRateDefaults, type StoredPricingInputs } from '@/lib/bidPricingInputs';

/** Rates that follow Settings unless typed on this job. */
const RATE_KEYS = ['laborRate', 'disposalRate', 'miniSkidRate', 'miniSkidPerDay'] as const;

interface Props {
  value: StoredPricingInputs | null | undefined;
  onSave: (next: StoredPricingInputs) => Promise<void> | void;
  /** The owner's Settings rates, shown and used wherever this job has no rate of its own. */
  ownerRates?: OwnerRateDefaults | null;
}

const numOrNull = (v: string) => (v === '' ? null : Number(v));

/** Owner-only editor for the job costs that feed the price calculator. */
export function JobCostsPanel({ value, onSave, ownerRates }: Props) {
  const shown = () => {
    const base = { ...emptyPricingInputs(), laborRate: null, disposalRate: null, ...(value ?? {}) } as StoredPricingInputs;
    return { ...emptyPricingInputs(), ...withOwnerRates(base, ownerRates) } as StoredPricingInputs;
  };
  const [form, setForm] = useState<StoredPricingInputs>(shown);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(shown());
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ownerRates]);

  const set = (patch: Partial<StoredPricingInputs>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Keep a Settings rate linked to Settings unless it was changed on this job.
      const initial = shown();
      const next: StoredPricingInputs = { ...form };
      for (const k of RATE_KEYS) {
        const own = (value ?? {})[k];
        if ((own === null || own === undefined) && next[k] === initial[k]) delete next[k];
      }
      await onSave(next);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof StoredPricingInputs,
    opts: { prefix?: string; suffix?: string; step?: string } = {},
  ) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        {opts.prefix && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {opts.prefix}
          </span>
        )}
        <Input
          type="number"
          inputMode="decimal"
          step={opts.step}
          className={`h-9 ${opts.prefix ? 'pl-5' : ''}`}
          value={form[key] == null ? '' : String(form[key])}
          onChange={(e) => set({ [key]: numOrNull(e.target.value) } as Partial<StoredPricingInputs>)}
        />
      </div>
    </div>
  );

  const pctField = (label: string, key: 'fixedPercent' | 'estimatorPercent' | 'crewShare' | 'ownerMinimum') => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        className="h-9"
        value={form[key] == null ? '' : String(Math.round(Number(form[key]) * 1000) / 10)}
        onChange={(e) => {
          const v = e.target.value === '' ? null : Number(e.target.value) / 100;
          set({ [key]: v } as Partial<StoredPricingInputs>);
        }}
      />
    </div>
  );

  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 [&::-webkit-details-marker]:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job costs (only you see these)</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {dirty ? 'Unsaved' : 'Tap to edit'}
          <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
        </span>
      </summary>
    <div className="px-3 pb-3 space-y-3">

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {field('Ground crew size', 'crewSize')}
        {field('Hours on site', 'jobHours')}
        {field('Ground rate /hr', 'laborRate', { prefix: '$' })}
        {field('Disposal loads', 'disposalLoads')}
        {field('Per load', 'disposalRate', { prefix: '$' })}
        {field('Mini skid steer /hr', 'miniSkidRate', { prefix: '$' })}
        {field('Stump grinding', 'stumpCost', { prefix: '$' })}
        {field('Travel', 'travelCost', { prefix: '$' })}
        {field('Other costs', 'otherCosts', { prefix: '$' })}
        {field('Fixed cost', 'fixedDollar', { prefix: '$' })}
        {pctField('Fixed cost %', 'fixedPercent')}
        {field('Estimator fee', 'estimatorDollar', { prefix: '$' })}
        {pctField('Estimator %', 'estimatorPercent')}
        {pctField('Climber share of net %', 'crewShare')}
        {pctField('Your minimum %', 'ownerMinimum')}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Switch
            id="own-min"
            checked={form.ownerMinimumEnabled !== false}
            onCheckedChange={(v) => set({ ownerMinimumEnabled: v })}
          />
          <Label htmlFor="own-min" className="text-xs">Hold my minimum share</Label>
        </div>
        <Button size="sm" variant={dirty ? 'default' : 'outline'} onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
          {dirty ? 'Save costs' : 'Saved'}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Mini skid steer cost = climber's hours × this rate (default $100/hr). Leave a field blank to skip it.
      </p>
    </div>
    </details>
  );
}
