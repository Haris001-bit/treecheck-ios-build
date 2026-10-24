import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, ChevronUp, Calculator, Settings2 } from 'lucide-react';
import {
  calculateWorksheet,
  type ScoutRateCard,
  type WorksheetInputs,
} from '@/lib/scoutWorksheet';
import { ConsultationNote } from '@/components/ConsultationNote';

const money = (v: number) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const numOrNull = (s: string) => {
  if (s.trim() === '') return null;
  const v = Number(s);
  return isNaN(v) ? null : v;
};

interface Props {
  value: WorksheetInputs;
  onChange: (next: WorksheetInputs) => void;
  rates: ScoutRateCard;
  /** Start expanded (used on the owner review screen). */
  defaultOpen?: boolean;
  showRatesLink?: boolean;
}

export function ScoutWorksheetPanel({ value, onChange, rates, defaultOpen = false, showRatesLink = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const result = useMemo(() => calculateWorksheet(value, rates), [value, rates]);
  const set = <K extends keyof WorksheetInputs>(key: K, v: WorksheetInputs[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <Calculator className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-medium">Estimator worksheet</span>
        <span className="text-xs text-muted-foreground">(optional)</span>
        {result.hasInput && (
          <span className="ml-auto text-sm font-semibold text-primary">{money(result.total)}</span>
        )}
        {open ? <ChevronUp className="w-4 h-4 ml-2 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 ml-2 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Enter what you pay for this job — your saved rates and target profit work backward to a
            homeowner price you can cross-check against the AI estimate.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Climber payout ($)</Label>
              <Input
                className="mt-1" type="number" min="0" step="1" inputMode="decimal" placeholder="e.g. 800"
                value={value.climberPayout ?? ''}
                onChange={(e) => set('climberPayout', numOrNull(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-sm">Hours on site</Label>
              <Input
                className="mt-1" type="number" min="0" step="0.5" inputMode="decimal" placeholder="e.g. 5"
                value={value.hours ?? ''}
                onChange={(e) => set('hours', numOrNull(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-sm">Ground crew</Label>
              <Input
                className="mt-1" type="number" min="0" step="1" inputMode="numeric" placeholder="e.g. 2"
                value={value.groundCrew ?? ''}
                onChange={(e) => set('groundCrew', numOrNull(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Priced at {money(rates.labor_rate)}/hr per person.
              </p>
            </div>
            <div>
              <Label className="text-sm">Disposal loads</Label>
              <Input
                className="mt-1" type="number" min="0" step="0.5" inputMode="decimal" placeholder="e.g. 2"
                value={value.loads ?? ''}
                onChange={(e) => set('loads', numOrNull(e.target.value))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {money(rates.disposal_per_load)} dump fee per load.
              </p>
            </div>
          </div>

          <div>
            <Label className="text-sm">Extras ($)</Label>
            <Input
              className="mt-1" type="number" min="0" step="1" inputMode="decimal" placeholder="permits, traffic control"
              value={value.extrasAmount ?? ''}
              onChange={(e) => set('extrasAmount', numOrNull(e.target.value))}
            />
            {value.extrasAmount != null && value.extrasAmount > 0 && (
              <Input
                className="mt-2"
                placeholder="What are the extras for?"
                maxLength={120}
                value={value.extrasNote ?? ''}
                onChange={(e) => set('extrasNote', e.target.value)}
              />
            )}
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="wk-crane" className="text-sm">Crane required</Label>
              <Switch id="wk-crane" checked={value.craneRequired} onCheckedChange={(v) => set('craneRequired', v)} />
            </div>
            {value.craneRequired && (
              <div>
                <Label className="text-sm">Estimated crane time (hours)</Label>
                <Input
                  className="mt-1" type="number" min="0" step="0.5" inputMode="decimal" placeholder="e.g. 3"
                  value={value.craneHours ?? ''}
                  onChange={(e) => set('craneHours', numOrNull(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Priced at {money(rates.crane_hourly)}/hr
                  {rates.crane_mobilization_fee > 0 ? ` + ${money(rates.crane_mobilization_fee)} mobilization` : ''}.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="wk-mini-skid" className="text-sm">Mini skid steer</Label>
              <Switch id="wk-mini-skid" checked={!!value.miniSkid} onCheckedChange={(v) => set('miniSkid', v)} />
            </div>
            {value.miniSkid && (
              <p className="text-xs text-muted-foreground mt-2">
                {rates.mini_skid_rate > 0
                  ? `Priced at ${money(rates.mini_skid_rate)} per ${rates.mini_skid_rate_type === 'day' ? 'day' : 'hour on site'}.`
                  : 'Set your mini skid rate on the rates page to price it.'}
              </p>
            )}
          </div>

          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="wk-chipper" className="text-sm">Chipper / chip truck</Label>
              <Switch id="wk-chipper" checked={!!value.chipper} onCheckedChange={(v) => set('chipper', v)} />
            </div>
            {value.chipper && (
              <p className="text-xs text-muted-foreground mt-2">
                {rates.chipper_rate > 0
                  ? `Priced at ${money(rates.chipper_rate)} per ${rates.chipper_rate_type === 'hour' ? 'hour on site' : 'day'}.`
                  : 'Set your chipper rate on the rates page to price it.'}
              </p>
            )}
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="wk-stump" className="text-sm">Stump grinding</Label>
              <Switch id="wk-stump" checked={value.stump} onCheckedChange={(v) => set('stump', v)} />
            </div>
            {value.stump && (
              <div>
                <Label className="text-sm">Stump diameter (inches)</Label>
                <Input
                  className="mt-1" type="number" min="0" step="0.5" inputMode="decimal" placeholder="e.g. 18"
                  value={value.stumpDiameterInches ?? ''}
                  onChange={(e) => set('stumpDiameterInches', numOrNull(e.target.value))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {money(rates.stump_base_price)} up to {rates.stump_base_inches}", then {money(rates.stump_per_inch)} per inch.
                </p>
              </div>
            )}
          </div>

          {result.hasInput && (
            <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Your calculated price</div>
              <div className="text-2xl font-bold text-primary">{money(result.total)}</div>
              <div className="text-xs text-muted-foreground">
                = {money(result.subtotal)} costs + {money(result.profit)} profit ({result.profitPct}%)
              </div>
              <div className="mt-2 space-y-1">
                {result.lines.map((l, i) => (
                  <div key={i} className="flex justify-between text-xs text-muted-foreground gap-3">
                    <span>{l.label}{l.detail ? ` — ${l.detail}` : ''}</span>
                    <span className="font-medium text-foreground shrink-0">{money(l.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs text-muted-foreground gap-3 border-t pt-1">
                  <span>Target profit ({result.profitPct}%)</span>
                  <span className="font-medium text-foreground shrink-0">{money(result.profit)}</span>
                </div>
              </div>
            </div>
          )}

          {showRatesLink && (
            <Link to="/dashboard/scout-rates" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Settings2 className="w-3.5 h-3.5" /> Edit your rates
            </Link>
          )}

          <ConsultationNote />
        </div>
      )}
    </div>
  );
}
