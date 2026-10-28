import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HardHat, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useProductionStatus } from '@/hooks/useProductionStatus';
import { useProductionSetup } from '@/hooks/useProductionSetup';
import { parseDefinition, type RateCardDefinition } from '@/lib/production/rules';
import { publishBlockers } from '@/lib/production/contradictions';
import { validatePastJobs } from '@/lib/production/validation';
import { DEFAULT_BASICS, type SettingsRow } from '@/lib/production/client';
import { cn } from '@/lib/utils';
import { BasicsStep } from '@/components/production/setup/BasicsStep';
import { ServicesStep } from '@/components/production/setup/ServicesStep';
import { PricingStep } from '@/components/production/setup/PricingStep';
import { CrewsStep } from '@/components/production/setup/CrewsStep';
import { MethodStep } from '@/components/production/setup/MethodStep';
import { PlaybooksStep } from '@/components/production/setup/PlaybooksStep';
import { PoliciesStep } from '@/components/production/setup/PoliciesStep';
import { ReviewStep } from '@/components/production/setup/ReviewStep';
import { ValidateStep } from '@/components/production/setup/ValidateStep';
import { PublishStep } from '@/components/production/setup/PublishStep';
import { today, type StepKey, type StepProps } from '@/components/production/setup/types';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'basics', label: 'Company and who sees what' },
  { key: 'services', label: 'Services' },
  { key: 'pricing', label: 'Prices' },
  { key: 'crews', label: 'Crews and equipment' },
  { key: 'method', label: 'Pricing method' },
  { key: 'playbooks', label: 'Playbooks' },
  { key: 'policies', label: 'Customer text and policies' },
  { key: 'review', label: 'Open items' },
  { key: 'validate', label: 'Past jobs check' },
  { key: 'publish', label: 'Publish' },
];

export default function ProductionSetup() {
  const { status, isLoading: statusLoading } = useProductionStatus();
  const allowed = status.eligible && status.can.setup;
  const setup = useProductionSetup(allowed);
  const draft = setup.data?.draft ?? null;
  const [def, setDef] = useState<RateCardDefinition | null>(null);
  const [label, setLabelState] = useState('');
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [step, setStep] = useState<StepKey>('basics');
  const [focusService, setFocusService] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const loadedDraft = useRef<string | null>(null);
  const defRef = useRef<RateCardDefinition | null>(null);
  const labelRef = useRef('');
  const settingsRef = useRef<SettingsRow | null>(null);
  const dirtyRef = useRef(false);
  const settingsDirtyRef = useRef(false);
  // Bumped on every edit, so a save only marks the page saved when nothing changed while it ran.
  const edits = useRef(0);
  const settingsEdits = useRef(0);
  defRef.current = def;
  labelRef.current = label;
  settingsRef.current = settings;
  dirtyRef.current = dirty;
  settingsDirtyRef.current = settingsDirty;

  // Load only from a read made after the page opened. Opening it again (another Settings tab and back) used to
  // show the cached copy from the first visit, and the next edit then saved that over newer work.
  const fresh = setup.isFetchedAfterMount;
  useEffect(() => {
    if (!draft || !fresh || loadedDraft.current === draft.id) return;
    const p = parseDefinition(draft.definition);
    setDef(p.kind === 'ok' ? p.def : null);
    setUnreadable(p.kind !== 'ok');
    setLabelState(draft.label ?? '');
    loadedDraft.current = draft.id;
    setDirty(false);
  }, [draft, fresh]);
  useEffect(() => {
    if (fresh && setup.data?.settings && !settings) setSettings({ ...setup.data.settings, basics: { ...DEFAULT_BASICS, ...setup.data.settings.basics } });
  }, [fresh, setup.data?.settings, settings]);

  const update = useCallback((fn: (d: RateCardDefinition) => void) => {
    setDef((prev) => { if (!prev) return prev; const next = structuredClone(prev); fn(next); return next; });
    edits.current += 1;
    setDirty(true);
  }, []);
  const setLabel = (v: string) => { setLabelState(v); edits.current += 1; setDirty(true); };
  const updateSettings = useCallback((patch: Partial<SettingsRow>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    settingsEdits.current += 1;
    setSettingsDirty(true);
  }, []);

  const saveNow = useCallback(async () => {
    if (!draft || !defRef.current) return;
    const seen = edits.current;
    setSaving(true);
    try {
      await setup.saveDefinition(draft.id, defRef.current, labelRef.current);
      if (edits.current === seen) setDirty(false);
    }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setSaving(false); }
  }, [draft, setup]);
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(saveNow, 800);
    return () => clearTimeout(t);
  }, [def, label, dirty, saveNow]);
  const saveSettingsNow = useCallback(async () => {
    const s = settingsRef.current;
    if (!s) return;
    const seen = settingsEdits.current;
    try {
      const { basics, crew_counts, resources, cost_viewer_ids, send_unit_cost, isa_credentials } = s;
      await setup.saveSettings(status.is_owner
        ? { basics, crew_counts, resources, cost_viewer_ids, send_unit_cost, isa_credentials }
        : { basics, crew_counts, resources, isa_credentials });
      if (settingsEdits.current === seen) setSettingsDirty(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
  }, [setup, status.is_owner]);
  useEffect(() => {
    if (!settingsDirty || !settings) return;
    const t = setTimeout(saveSettingsNow, 800);
    return () => clearTimeout(t);
  }, [settings, settingsDirty, saveSettingsNow]);
  // Leaving the page within the 800 ms wait still saves the last edit.
  const flush = useRef(() => {});
  flush.current = () => {
    if (dirtyRef.current) void saveNow();
    if (settingsDirtyRef.current) void saveSettingsNow();
  };
  useEffect(() => () => flush.current(), []);

  const goTo = useCallback((s: StepKey, serviceKey?: string) => { setStep(s); setFocusService(serviceKey ?? null); window.scrollTo({ top: 0 }); }, []);
  const badges = useMemo(() => {
    if (!def) return {} as Partial<Record<StepKey, string>>;
    const blockers = publishBlockers(def);
    const check = validatePastJobs(def, today());
    return {
      pricing: blockers.filter((b) => b.serviceKey).length ? String(blockers.filter((b) => b.serviceKey).length) : undefined,
      review: blockers.length ? String(blockers.length) : undefined,
      validate: check.ready ? undefined : `${check.summary.won + check.summary.lost}/7`,
    } as Partial<Record<StepKey, string>>;
  }, [def]);

  if (statusLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!allowed) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 space-y-2">
          <h1 className="text-xl font-bold flex items-center gap-2"><HardHat className="w-5 h-5 text-primary" />Crews and pricing</h1>
          <p className="text-sm text-muted-foreground">
            {status.eligible ? 'Ask the company owner to set this up, or to give you access to settings.' : 'This is for companies that run their own crews. Choose employees or a mix under How we work to use it.'}
          </p>
        </Card>
      </div>
    );
  }

  const start = async () => {
    setStarting(true);
    try { await setup.ensure(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not start'); } finally { setStarting(false); }
  };
  const latest = setup.data?.published.find((c) => c.status === 'published');

  if (setup.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!draft || !setup.data?.settings) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 space-y-3">
          <h1 className="text-xl font-bold flex items-center gap-2"><HardHat className="w-5 h-5 text-primary" />Crews and pricing</h1>
          {latest ? (
            <p className="text-sm">Version {latest.version}{latest.label ? ` (${latest.label})` : ''} is live from {latest.effective_from}. Your salespeople quote from it. To change prices, start a new version; the live one keeps working until you publish.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Set up how your company prices each service, your crews and equipment, and what happens after a sale. Start from a standard tree-care card with every price at zero, or read your own price sheet in the next step.</p>
          )}
          <Button onClick={start} disabled={starting}>{starting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{latest ? 'Make changes' : 'Start setup'}</Button>
        </Card>
      </div>
    );
  }
  if (!def || !settings) {
    if (!unreadable) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
    return <div className="p-6 text-sm text-destructive">This draft couldn't be read. Refresh the page; if it keeps happening, tell TreeCheck support.</div>;
  }

  const props: StepProps = { def, update, settings, updateSettings, status, members: setup.data?.members ?? [], goTo, focusService };
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><HardHat className="w-6 h-6 text-primary" />Crews and pricing</h1>
          <p className="text-sm text-muted-foreground">{latest ? `Editing a new version. Version ${latest.version} stays live until you publish.` : 'Draft. Nothing reaches salespeople until you publish.'}</p>
        </div>
        <span className="text-xs text-muted-foreground">{saving || dirty || settingsDirty ? 'Saving…' : 'Saved'}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <Button key={s.key} variant={step === s.key ? 'secondary' : 'ghost'} size="sm" className={cn('justify-between whitespace-nowrap')} onClick={() => goTo(s.key)}>
              <span>{i + 1}. {s.label}</span>
              {badges[s.key] && <Badge variant={s.key === 'validate' ? 'secondary' : 'destructive'} className="ml-2">{badges[s.key]}</Badge>}
            </Button>
          ))}
        </nav>
        <main className="min-w-0">
          {step === 'basics' && <BasicsStep {...props} />}
          {step === 'services' && <ServicesStep {...props} importSheet={setup.importSheet} />}
          {step === 'pricing' && <PricingStep {...props} />}
          {step === 'crews' && <CrewsStep {...props} />}
          {step === 'method' && <MethodStep {...props} />}
          {step === 'playbooks' && <PlaybooksStep {...props} />}
          {step === 'policies' && <PoliciesStep {...props} />}
          {step === 'review' && <ReviewStep {...props} />}
          {step === 'validate' && <ValidateStep {...props} />}
          {step === 'publish' && (
            <PublishStep {...props} label={label} setLabel={setLabel} published={setup.data?.published ?? []} flush={saveNow}
              onPublish={async (i) => {
                const r = await setup.publish({ cardId: draft.id, effectiveFrom: i.effectiveFrom, label: i.label, skipReason: def.validation.skippedReason });
                loadedDraft.current = null;
                setDef(null);
                return r;
              }} />
          )}
          <div className="flex justify-between mt-6">
            <Button variant="ghost" disabled={step === STEPS[0].key} onClick={() => goTo(STEPS[Math.max(0, STEPS.findIndex((s) => s.key === step) - 1)].key)}>Back</Button>
            {step !== 'publish' && <Button onClick={() => goTo(STEPS[Math.min(STEPS.length - 1, STEPS.findIndex((s) => s.key === step) + 1)].key)}>Next</Button>}
          </div>
        </main>
      </div>
    </div>
  );
}
