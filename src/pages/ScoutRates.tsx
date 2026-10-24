import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { useScoutRates } from '@/hooks/useScoutRates';
import { DEFAULT_RATE_CARD, type ScoutRateCard } from '@/lib/scoutWorksheet';
import { ConsultationNote } from '@/components/ConsultationNote';
import { ScoutLearningSwitchRow } from '@/components/scout/ScoutLearningCard';

interface FieldDef {
  key: keyof ScoutRateCard;
  label: string;
  hint?: string;
  suffix?: string;
  step?: string;
}

const GROUPS: { title: string; description: string; fields: FieldDef[] }[] = [
  {
    title: 'Labor',
    description: 'What you pay per person per hour on the ground crew.',
    fields: [{ key: 'labor_rate', label: 'Ground crew pay rate', suffix: '$/hr', hint: 'Per person, per hour on site.' }],
  },
  {
    title: 'Crane',
    description: 'What you pay the crane for jobs that need one.',
    fields: [
      { key: 'crane_hourly', label: 'Crane pay rate', suffix: '$/hr' },
      { key: 'crane_mobilization_fee', label: 'Crane mobilization / minimum fee', suffix: '$', hint: 'Optional flat fee any time a crane is used.' },
    ],
  },
  {
    title: 'Mini skid steer',
    description: 'What you pay for the mini skid on jobs that use one.',
    fields: [{ key: 'mini_skid_rate', label: 'Mini skid rate', suffix: '$' }],
  },
  {
    title: 'Chipper / chip truck',
    description: 'What you pay for the chipper on jobs that use one.',
    fields: [{ key: 'chipper_rate', label: 'Chipper / chip truck rate', suffix: '$' }],
  },
  {
    title: 'Disposal',
    description: 'Dump fees per load of debris you haul away.',
    fields: [{ key: 'disposal_per_load', label: 'Dump fee per load', suffix: '$' }],
  },
  {
    title: 'Stump grinding',
    description: 'What your stump grinder sub charges. For example: $250 up to 12 inches, then $7 per inch after that.',
    fields: [
      { key: 'stump_base_price', label: 'Base price', suffix: '$' },
      { key: 'stump_base_inches', label: 'Inches included in base', suffix: 'in' },
      { key: 'stump_per_inch', label: 'Per inch after that', suffix: '$/in' },
    ],
  },
  {
    title: 'Overhead',
    description: 'Your average cost per job to cover running the business — insurance, admin, fuel, marketing. Added to every worksheet price.',
    fields: [{ key: 'overhead_per_job', label: 'Average amount per job to cover overhead', suffix: '$', hint: 'Leave at 0 if you don\u2019t want overhead built into worksheet prices.' }],
  },
  {
    title: 'Profit & minimums',
    description: 'Scout works backward from your costs so this share of the price is your profit. 30% on $1,750 of costs is a $2,500 price.',
    fields: [
      { key: 'target_profit_pct', label: 'Target profit', suffix: '%' },
      { key: 'minimum_job_price', label: 'Minimum job price', suffix: '$' },
    ],
  },
];

export default function ScoutRates() {
  const { rates, loading, saving, save, canEdit } = useScoutRates();
  const [draft, setDraft] = useState<ScoutRateCard | null>(null);
  const current = draft ?? rates;

  const setField = (key: keyof ScoutRateCard, raw: string) => {
    const v = raw.trim() === '' ? 0 : Number(raw);
    setDraft({ ...current, [key]: isNaN(v) ? 0 : v });
  };

  const onSave = async () => {
    try {
      await save(current);
      setDraft(null);
      toast.success('Scout rates saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save rates');
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading rates…
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calculator className="w-6 h-6 text-primary" />
          Scout Rates
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          What you pay your subs and for equipment. The estimator worksheet works backward from
          these costs to a homeowner price that hits your target profit — a second number to
          cross-check the AI estimate.
        </p>
      </div>

      <ScoutLearningSwitchRow />

      {!canEdit && (
        <Card className="p-4 mb-4 text-sm text-muted-foreground">
          These are your business owner's rates — view only.
        </Card>
      )}

      <div className="space-y-4">
        {GROUPS.map((g) => (
          <Card key={g.title} className="p-4">
            <div className="mb-3">
              <div className="font-semibold">{g.title}</div>
              <div className="text-xs text-muted-foreground">{g.description}</div>
            </div>
            {(g.title === 'Chipper / chip truck' || g.title === 'Mini skid steer') && (
              <div className="flex gap-2 mb-3">
                {(['day', 'hour'] as const).map((t) => {
                  const typeKey: keyof ScoutRateCard = g.title === 'Mini skid steer' ? 'mini_skid_rate_type' : 'chipper_rate_type';
                  return (
                    <Button key={t} type="button" size="sm" disabled={!canEdit}
                      variant={(current[typeKey] ?? 'day') === t ? 'default' : 'outline'}
                      onClick={() => setDraft({ ...current, [typeKey]: t })}>
                      Per {t}
                    </Button>
                  );
                })}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              {g.fields.map((f) => (
                <div key={f.key}>
                  <Label className="text-sm">{f.label}</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="number"
                      min="0"
                      step={f.step ?? '0.5'}
                      inputMode="decimal"
                      disabled={!canEdit}
                      value={String(current[f.key] ?? '')}
                      onChange={(e) => setField(f.key, e.target.value)}
                    />
                    {f.suffix && <span className="text-xs text-muted-foreground shrink-0">{f.suffix}</span>}
                  </div>
                  {f.hint && <p className="text-xs text-muted-foreground mt-1">{f.hint}</p>}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {canEdit && (
        <div className="flex gap-2 mt-6">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Saving…</> : <><Save className="w-4 h-4 mr-1.5" />Save rates</>}
          </Button>
          <Button variant="outline" onClick={() => setDraft({ ...DEFAULT_RATE_CARD })} disabled={saving}>
            Reset to defaults
          </Button>
        </div>
      )}

      <div className="mt-6">
        <ConsultationNote />
      </div>
    </div>
  );
}
