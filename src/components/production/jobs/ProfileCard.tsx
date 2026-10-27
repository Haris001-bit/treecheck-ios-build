import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import { productionDb, newDraftDefinition, type SettingsRow } from '@/lib/production/client';
import { parseDefinition, type RateCardDefinition } from '@/lib/production/rules';
import { activeProfile, applyIncrease, recommendProfile } from '@/lib/production/profiles';
import { ChoiceField, NumberField } from '@/components/production/setup/fields';
import { today } from '@/components/production/setup/types';

const signed = (n: number) => (n > 0 ? `+${n}%` : n < 0 ? `${n}%` : 'no change');
const message = (e: unknown) => (e instanceof Error ? e.message : 'Could not save');

/**
 * The workload profile in force, the advice in words (from the backlog and what crews earn per man-hour), and for the
 * owner or setup managers: activate one, schedule one for a window, or put the suggested increase into a draft card to
 * review and publish. The AI never changes a price by itself.
 */
export function ProfileCard({ def, settings, backlogWeeks, realizedRate, canSetup, onChanged }: {
  def: RateCardDefinition; settings: SettingsRow | null; backlogWeeks: number | null; realizedRate: number | null; canSetup: boolean; onChanged: () => void;
}) {
  const { effectiveContractorId, user } = useAuth();
  const owner = effectiveContractorId ?? user?.id ?? null;
  const nav = useNavigate();
  const day = today();
  const active = activeProfile(def, settings, day);
  const advice = recommendProfile(def, { backlogWeeks: backlogWeeks ?? 0, realizedRate, targetRate: def.pricing.manHourRate ?? null });
  const windows = settings?.profile_schedule ?? [];
  const [busy, setBusy] = useState(false);
  const [win, setWin] = useState<{ key: string; from: string; to: string }>({ key: def.profiles[0]?.key ?? 'normal', from: day, to: day });
  const [raise, setRaise] = useState<number | undefined>(advice.increase?.low);
  const options = def.profiles.map((p): [string, string] => [p.key, `${p.name} (${signed(p.percent)})`]);

  const save = async (patch: Partial<SettingsRow>, done: string) => {
    if (!owner) return;
    setBusy(true);
    try {
      const { error } = await productionDb.from('production_settings').update(patch).eq('contractor_id', owner);
      if (error) throw error;
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };

  const putIntoDraft = async (percent: number) => {
    if (!owner) return;
    setBusy(true);
    try {
      let { data: draft } = await productionDb.from('production_rate_cards').select('id, definition')
        .eq('contractor_id', owner).eq('status', 'draft').is('branch_key', null).maybeSingle();
      if (!draft) {
        const { data: latest } = await productionDb.from('production_rate_cards').select('id, label, definition')
          .eq('contractor_id', owner).eq('status', 'published').is('branch_key', null).order('version', { ascending: false }).limit(1).maybeSingle();
        const made = await productionDb.from('production_rate_cards').insert({
          contractor_id: owner, status: 'draft', label: latest?.label ?? '', based_on: latest?.id ?? null, definition: newDraftDefinition(latest?.definition ?? null),
        }).select('id, definition').maybeSingle();
        if (made.error) throw made.error;
        draft = made.data;
      }
      const parsed = parseDefinition(draft?.definition);
      if (!draft || parsed.kind !== 'ok') throw new Error("The draft rates can't be read. Open Settings, Crews and pricing.");
      const { error } = await productionDb.from('production_rate_cards').update({ definition: applyIncrease(parsed.def, percent) }).eq('id', draft.id).eq('status', 'draft');
      if (error) throw error;
      toast.success(`Crew-time prices are up ${percent}% in your draft. Check it and publish it when ready.`);
      nav('/dashboard/settings/crews');
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold">Workload profile: {active?.name ?? 'Normal'}{active && active.percent !== 0 ? ` (${signed(active.percent)})` : ''}</div>
        {advice.key && advice.key !== active?.key && <span className="text-xs text-muted-foreground">Suggested: {def.profiles.find((p) => p.key === advice.key)?.name}</span>}
      </div>
      <p className="text-sm text-muted-foreground">{advice.text}</p>
      {canSetup && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
            <ChoiceField<string> label="Use this profile from now" value={settings?.active_profile ?? 'normal'} options={options}
              onChange={(v) => save({ active_profile: v }, 'Profile changed. New estimates use it.')} />
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">Or set one for some dates (a scheduled profile beats the one above)</div>
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto] items-end">
              <ChoiceField<string> label="Profile" value={win.key} options={options} onChange={(v) => setWin({ ...win, key: v })} />
              <div className="space-y-1"><Label className="text-xs" htmlFor="prof-from">From</Label><Input id="prof-from" type="date" value={win.from} onChange={(e) => setWin({ ...win, from: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor="prof-to">To</Label><Input id="prof-to" type="date" value={win.to} onChange={(e) => setWin({ ...win, to: e.target.value })} /></div>
              <Button size="sm" variant="outline" disabled={busy || !win.from || !win.to || win.to < win.from}
                onClick={() => save({ profile_schedule: [...windows, win].slice(-20) }, 'Profile scheduled.')}>Add</Button>
            </div>
            {windows.map((w, i) => (
              <div key={`${w.key}-${w.from}-${i}`} className="flex items-center justify-between text-sm">
                <span>{def.profiles.find((p) => p.key === w.key)?.name ?? w.key}: {w.from} to {w.to}</span>
                <Button size="icon" variant="ghost" aria-label="Remove this window" disabled={busy}
                  onClick={() => save({ profile_schedule: windows.filter((_, j) => j !== i) }, 'Window removed.')}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
          {advice.increase && (
            <div className="grid gap-2 sm:grid-cols-[9rem_auto] items-end">
              <NumberField label="Raise crew-time prices" unit="%" max={50} value={raise} onChange={setRaise} />
              <Button size="sm" disabled={busy || !raise} onClick={() => raise && putIntoDraft(raise)}>Put it into a draft to review</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
