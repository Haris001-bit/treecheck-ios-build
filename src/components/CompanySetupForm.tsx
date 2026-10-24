import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Check, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useCompanySettings, useSaveCompanySettings, type SubUsage, type OperatingModel } from '@/hooks/useCompanySettings';
import { CalibrationWizard } from '@/components/production/CalibrationWizard';
import { CALIBRATION_INTRO } from '@/components/production/CalibrationPanel';
import { clampTyped } from '@/lib/inputLimits';
import { clearOnboardingDraft, readOnboardingDraft, writeOnboardingDraft } from '@/lib/onboardingDraft';
import { CRM_OPTIONS, otherCrmName } from '../../supabase/functions/_shared/crmChoice';

const OPERATING: { value: string; label: string; hint?: string }[] = [
  { value: 'subcontractors', label: 'Primarily subcontractors', hint: 'Climbers and crews bid on each job.' },
  { value: 'employees', label: 'Primarily employees', hint: 'Scout plans crew, hours, and equipment and prices from your costs.' },
  { value: 'hybrid', label: 'Employees + subcontractors', hint: 'Scout plans with your crew; you can still send jobs to subs.' },
];
import { useScoutRates } from '@/hooks/useScoutRates';
import { pricingConfig } from '@/lib/bidPricing';

type Opt = { value: string; label: string; hint?: string };

const USAGE: Opt[] = [
  { value: 'every_job', label: 'Almost every job', hint: 'Subs do most or all of our work' },
  { value: 'sometimes', label: 'Now and then', hint: 'Big jobs or busy weeks' },
  { value: 'rarely', label: 'Rarely' },
  { value: 'never', label: 'Never, I have my own crew' },
];
const ROLES: Opt[] = [
  { value: 'climber', label: 'Climbers' },
  { value: 'ground', label: 'Ground workers' },
  { value: 'stump', label: 'Stump grinders' },
  { value: 'crane', label: 'Crane operators' },
];
const IN_HOUSE: Opt[] = [
  { value: 'climber', label: 'Climber' },
  { value: 'ground', label: 'Ground crew' },
  { value: 'stump', label: 'Stump grinder' },
  { value: 'crane', label: 'Crane' },
  { value: 'chipper', label: 'Chipper / chip truck' },
  { value: 'just_me', label: 'Just me' },
];
const SOURCES: Opt[] = [
  { value: 'treecheck_site', label: 'TreeCheck website' },
  { value: 'own_site', label: 'Our own website form' },
  { value: 'phone', label: 'Phone / call system' },
  { value: 'scout', label: 'Walking neighborhoods (Scout)' },
  { value: 'manual', label: 'Word of mouth, entered by hand' },
];
// The listed CRMs live in crmChoice.ts, so Mark's text (crm-interest-alert) names the same ones.
const CRMS: Opt[] = [...CRM_OPTIONS, { value: 'other', label: 'Other' }, { value: 'none', label: 'None' }];

interface Costs {
  laborRate: number; disposalRate: number; crewSharePct: number; ownerMinPct: number;
  craneHourly: number; chipperRate: number; chipperType: string; stumpBase: number;
}

interface State {
  sub_usage: SubUsage | null; sub_roles: string[]; in_house_roles: string[];
  lead_sources: string[]; crm: string; crm_other: string; auto_broadcast: boolean;
  operating_model: OperatingModel;
}

const DEFAULT_STATE: State = { sub_usage: null, sub_roles: [], in_house_roles: [], lead_sources: [], crm: 'none', crm_other: '', auto_broadcast: false, operating_model: 'subcontractors' };
const COST_KEYS = ['laborRate', 'disposalRate', 'crewSharePct', 'ownerMinPct', 'craneHourly', 'chipperRate', 'stumpBase'] as const;
const validCosts = (c: unknown): c is Costs =>
  !!c && typeof c === 'object' && COST_KEYS.every((k) => Number.isFinite((c as Record<string, unknown>)[k])) && typeof (c as Record<string, unknown>).chipperType === 'string';

function Choice({ opts, value, onChange, multi, twoColumns }: {
  opts: Opt[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean; twoColumns?: boolean;
}) {
  return (
    <div className={cn('grid gap-2', twoColumns && 'grid-cols-2')}>
      {opts.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button"
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== o.value) : [...value, o.value]) : [o.value])}
            className={cn('flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors',
              on ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50')}>
            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center border-2', multi ? 'rounded' : 'rounded-full',
              on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground')}>
              {on && <Check className="h-3 w-3" />}
            </span>
            <span>
              <span className="block">{o.label}</span>
              {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CompanySetupForm({ mode, onDone }: { mode: 'wizard' | 'page'; onDone?: () => void }) {
  const { user } = useAuth();
  const { data: settings, isLoading } = useCompanySettings();
  const saveSettings = useSaveCompanySettings();
  const { rates, save: saveRates, loading: ratesLoading } = useScoutRates();
  // Wizard only: a reload returns to the same question with the same answers. Finish clears it.
  const [draft] = useState(() => (mode === 'wizard' ? readOnboardingDraft<State, Costs>(user?.id) : null));
  const [s, setS] = useState<State>(() => ({ ...DEFAULT_STATE, ...(draft?.s ?? {}) }));
  const [costs, setCosts] = useState<Costs | null>(() => (validCosts(draft?.costs) ? draft.costs : null));
  const [step, setStep] = useState(draft?.step ?? 0);
  const [saving, setSaving] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [calibrated, setCalibrated] = useState(draft?.calibrated ?? false);

  useEffect(() => {
    if (mode === 'wizard') writeOnboardingDraft(user?.id, { step, s, costs, calibrated });
  }, [mode, user?.id, step, s, costs, calibrated]);

  useEffect(() => {
    // A restored draft already holds this person's answers; the saved settings would put question 1's defaults back.
    if (!settings || draft) return;
    setS({
      sub_usage: settings.sub_usage, sub_roles: settings.sub_roles ?? [], in_house_roles: settings.in_house_roles ?? [],
      lead_sources: settings.lead_sources ?? [], crm: settings.crm ?? 'none', crm_other: settings.crm_other ?? '',
      auto_broadcast: settings.auto_broadcast,
      operating_model: settings.operating_model ?? 'subcontractors',
    });
  }, [settings, draft]);

  useEffect(() => {
    if (!user || ratesLoading || costs) return;
    (async () => {
      const { data: pd } = await supabase.from('pricing_defaults').select('*').eq('contractor_id', user.id).maybeSingle();
      setCosts({
        laborRate: Number(pd?.labor_rate ?? pricingConfig.laborRateDefault),
        disposalRate: Number(pd?.disposal_rate ?? pricingConfig.disposalRateDefault),
        crewSharePct: Math.round(Number(pd?.crew_share ?? pricingConfig.crewShareDefault) * 100),
        ownerMinPct: Math.round(Number(pd?.owner_minimum ?? pricingConfig.ownerMinimumDefault) * 100),
        craneHourly: Number(rates.crane_hourly),
        chipperRate: Number(rates.chipper_rate ?? 0),
        chipperType: rates.chipper_rate_type ?? 'day',
        stumpBase: Number(rates.stump_base_price),
      });
    })();
  }, [user, ratesLoading, rates, costs]);

  const set = (patch: Partial<State>) => setS((p) => ({ ...p, ...patch }));
  const setC = (patch: Partial<Costs>) => setCosts((c) => (c ? { ...c, ...patch } : c));
  // "Primarily subcontractors" starts selected and skips "How often do you use subcontractors?", so Continue without
  // tapping it means the same as tapping it. Without this Finish did nothing (2026-10-21). A saved answer always wins.
  const subUsage: SubUsage | null = s.sub_usage ?? (s.operating_model === 'subcontractors' ? 'every_job' : null);

  const finish = async () => {
    if (!user || !subUsage) return;
    setSaving(true);
    try {
      const auto = mode === 'wizard' ? subUsage === 'every_job' : s.auto_broadcast;
      await saveSettings.mutateAsync({
        sub_usage: subUsage,
        operating_model: s.operating_model,
        sub_roles: subUsage === 'never' ? [] : s.sub_roles,
        in_house_roles: s.in_house_roles,
        lead_sources: s.lead_sources,
        crm: s.crm,
        crm_other: s.crm === 'other' ? s.crm_other.trim() || null : null,
        auto_broadcast: auto,
        onboarding_completed_at: settings?.onboarding_completed_at ?? new Date().toISOString(),
      });
      if (otherCrmName(s.crm, s.crm_other)) {
        // Mark gets a text so he can call them (once per company and CRM; the function reads the saved answer itself).
        void supabase.functions.invoke('crm-interest-alert', { body: {} }).catch(() => undefined);
      }
      if (costs) {
        const { data: pd } = await supabase.from('pricing_defaults').select('*').eq('contractor_id', user.id).maybeSingle();
        await supabase.from('pricing_defaults').upsert({
          fixed_dollar: pricingConfig.fixedDollarDefault,
          fixed_percent: pricingConfig.fixedPercentDefault,
          estimator_dollar: pricingConfig.estimatorDollarDefault,
          estimator_percent: pricingConfig.estimatorPercentDefault,
          owner_minimum_enabled: true,
          ...(pd ?? {}),
          contractor_id: user.id,
          labor_rate: costs.laborRate,
          disposal_rate: costs.disposalRate,
          crew_share: costs.crewSharePct / 100,
          owner_minimum: costs.ownerMinPct / 100,
        } as any, { onConflict: 'contractor_id' });
        await saveRates({
          ...rates,
          crane_hourly: costs.craneHourly,
          chipper_rate: costs.chipperRate,
          chipper_rate_type: costs.chipperType,
          stump_base_price: costs.stumpBase,
          disposal_per_load: costs.disposalRate,
        });
      }
      toast.success(mode === 'wizard' ? "You're all set up" : 'Saved');
      if (mode === 'wizard') clearOnboardingDraft(user.id);
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !costs) {
    return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const num = (label: string, key: keyof Costs, prefix = '$', suffix = '', max?: number) => (
    <div>
      <Label className="text-sm">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        {prefix && <span className="text-sm">{prefix}</span>}
        <Input type="number" inputMode="decimal" min="0" max={max} value={String(costs[key])}
          onChange={(e) => setC({ [key]: clampTyped(e.target.value, max) } as Partial<Costs>)} />
        {suffix && <span className="text-sm">{suffix}</span>}
      </div>
    </div>
  );

  const costsSection = (
    <div className="grid gap-3 sm:grid-cols-2">
      {num('Ground crew hourly rate (per person)', 'laborRate', '$', '/hr')}
      {num('Disposal cost per load', 'disposalRate')}
      {num('Climber pay share of net', 'crewSharePct', '', '%', 100)}
      {num('Crane hourly rate', 'craneHourly', '$', '/hr')}
      {num('Stump grinding base price', 'stumpBase')}
      <div className="sm:col-span-2">
        <Label className="text-sm">Chipper / chip truck</Label>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm">$</span>
          <Input type="number" inputMode="decimal" min="0" value={String(costs.chipperRate)}
            onChange={(e) => setC({ chipperRate: clampTyped(e.target.value) })} />
          {(['day', 'hour'] as const).map((t) => (
            <Button key={t} type="button" size="sm" variant={costs.chipperType === t ? 'default' : 'outline'}
              onClick={() => setC({ chipperType: t })}>Per {t}</Button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Leave at 0 if you don't charge for it separately.</p>
      </div>
    </div>
  );

  const crmSection = (
    <div className="space-y-3">
      <Choice opts={CRMS} value={[s.crm]} onChange={([v]) => set({ crm: v })} twoColumns />
      {s.crm === 'other' && (
        <div className="space-y-1">
          <Label htmlFor="crm-other">Which CRM do you use?</Label>
          <Input id="crm-other" placeholder="Type the name of your CRM" maxLength={60} value={s.crm_other}
            onChange={(e) => set({ crm_other: e.target.value })} />
        </div>
      )}
      {s.crm !== 'jobber' && (
        // Anything but Jobber gets a clear, readable note (Haris, 2026-10-22: "should show visibly and not be hidden").
        <div role="status" className="flex items-start gap-3 rounded-lg border-2 border-primary/60 bg-primary/10 p-4 text-sm leading-relaxed">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          {s.crm === 'none' ? (
            <p><span className="font-bold">TreeCheck syncs with Jobber today.</span> Without a CRM you can print or text quotes straight from the app.</p>
          ) : (
            <p>
              <span className="font-bold">TreeCheck syncs with Jobber today, not {otherCrmName(s.crm, s.crm_other) ?? 'your CRM'} yet.</span> Our team
              will reach out to help you get set up. Until then you can print or text quotes from the app.
            </p>
          )}
        </div>
      )}
    </div>
  );

  const marginSection = (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[20, 25, 30, 35, 40, 50].map((p) => (
          <Button key={p} type="button" variant={costs.ownerMinPct === p ? 'default' : 'outline'} onClick={() => setC({ ownerMinPct: p })}>
            {p}%
          </Button>
        ))}
      </div>
      <div>
        <Label className="text-sm">Or type your own</Label>
        <div className="mt-1 flex items-center gap-2">
          <Input type="number" inputMode="decimal" min="0" max="90" value={String(costs.ownerMinPct)}
            onChange={(e) => setC({ ownerMinPct: clampTyped(e.target.value, 90) })} />
          <span className="text-sm">%</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        This is what your company keeps from each sale after paying subs and job costs. If a price would leave you less, TreeCheck raises the quote automatically.
      </p>
    </div>
  );

  const steps = [
    { title: 'How does your company normally perform tree work?', body: <Choice opts={OPERATING} value={[s.operating_model]} onChange={([v]) => set({ operating_model: v as OperatingModel, ...(v === 'subcontractors' ? { sub_usage: 'every_job' as SubUsage } : {}) })} />, auto: () => set({ operating_model: 'subcontractors', sub_usage: 'every_job' }), skip: false },
    { title: 'Calibrate Scout to Your Company', sub: 'Recommended: 5 completed jobs. Optional — you can do this later in How we work.', body: (
      <div className="space-y-3">
        <p className="text-sm">{CALIBRATION_INTRO}</p>
        <Button type="button" className="w-full" variant="secondary" onClick={() => setCalOpen(true)}>Start Calibration</Button>
        <CalibrationWizard open={calOpen} onOpenChange={setCalOpen} onSaved={() => setCalibrated(true)} />
      </div>
    ), auto: null, skip: mode === 'page' || s.operating_model === 'subcontractors' },
    // Already answered by "Primarily subcontractors" (almost every job).
    { title: 'How often do you use subcontractors?', body: <Choice opts={USAGE} value={s.sub_usage ? [s.sub_usage] : []} onChange={([v]) => set({ sub_usage: v as SubUsage })} />, auto: () => set({ sub_usage: 'sometimes' }), skip: s.operating_model === 'subcontractors' },
    { title: 'When you do, who do you call?', sub: 'Pick any.', body: <Choice multi opts={ROLES} value={s.sub_roles} onChange={(v) => set({ sub_roles: v })} />, auto: () => set({ sub_roles: ['climber', 'ground', 'stump'] }), skip: subUsage === 'never' },
    { title: 'Who does your own crew include?', sub: 'Pick any. We won’t send these jobs to subs unless you ask.', body: <Choice multi opts={IN_HOUSE} value={s.in_house_roles} onChange={(v) => set({ in_house_roles: v })} />, auto: () => set({ in_house_roles: [] }), skip: subUsage === 'every_job' },
    { title: 'Where do your jobs come from?', sub: 'Pick any.', body: <Choice multi opts={SOURCES} value={s.lead_sources} onChange={(v) => set({ lead_sources: v })} />, auto: () => set({ lead_sources: ['scout', 'manual'] }), skip: false },
    { title: 'What CRM are you currently using?', body: crmSection, auto: () => set({ crm: 'none' }), skip: false },
    { title: 'What margin do you want on every job?', sub: 'Your share of each sale, after subs and job costs.', body: marginSection, auto: () => setC({ ownerMinPct: 30 }), skip: false },
    { title: 'Your default job costs', sub: 'We filled in common numbers. Change any, or just tap Finish.', body: costsSection, auto: null, skip: false },
  ];

  if (mode === 'page') {
    return (
      <div className="space-y-4">
        {steps.map((st, i) => (st.skip && i !== 0 ? null : (
          <Card key={i} className="p-4 space-y-3">
            <div>
              <div className="font-semibold">{st.title}</div>
              {st.sub && <div className="text-xs text-muted-foreground">{st.sub}</div>}
            </div>
            {st.body}
          </Card>
        )))}
        {subUsage !== 'never' && subUsage !== 'rarely' && (
          <Card className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Send new jobs to subs automatically</div>
              <div className="text-xs text-muted-foreground">Off: nothing goes out until you tap "Get sub bids" on a job.</div>
            </div>
            <Switch checked={s.auto_broadcast} onCheckedChange={(v) => set({ auto_broadcast: v })} />
          </Card>
        )}
        <Button className="w-full" onClick={finish} disabled={saving || !subUsage}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
        </Button>
      </div>
    );
  }

  const visible = steps.map((st, i) => ({ ...st, i })).filter((st) => !st.skip);
  const idx = Math.min(step, visible.length - 1);
  const cur = visible[idx];
  const last = idx === visible.length - 1;
  const next = () => (last ? finish() : setStep(idx + 1));

  return (
    <div className="space-y-5">
      <div className="flex gap-1">
        {visible.map((_, i) => <div key={i} className={cn('h-1.5 flex-1 rounded-full', i <= idx ? 'bg-primary' : 'bg-muted')} />)}
      </div>
      <div>
        <h2 className="text-xl font-black">{cur.title}</h2>
        {cur.sub && <p className="text-sm text-muted-foreground mt-1">{cur.sub}</p>}
      </div>
      {cur.body}
      <div className="flex flex-col gap-2">
        <Button onClick={next} disabled={saving || (cur.i === 2 && !subUsage)}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{last ? 'Finish' : cur.i === 1 && !calibrated ? 'Skip for Now' : 'Continue'}
        </Button>
        {cur.auto && (
          <Button variant="ghost" onClick={() => { cur.auto!(); if (!last) setStep(idx + 1); }}>
            Not sure, set it up for me
          </Button>
        )}
        {idx > 0 && <Button variant="link" onClick={() => setStep(idx - 1)}>Back</Button>}
      </div>
    </div>
  );
}
