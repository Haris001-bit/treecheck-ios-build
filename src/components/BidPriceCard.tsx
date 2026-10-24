import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { money, pct, type PricingResult } from '@/lib/bidPricing';

export type QuoteOption = 'lowest' | 'recommended' | 'plus10' | 'plus15' | 'ai' | 'custom';
export interface QuotePick { bid_id: string; option: QuoteOption; amount: number; climber_pay?: number | null; picked_by_name?: string | null; picked_at: string }

const OPTION_LABEL: Record<QuoteOption, string> = {
  lowest: "Lowest he'll take", recommended: 'Recommended quote', plus10: '+10%', plus15: '+15%', ai: 'Scout AI price', custom: 'Your own price',
};
export const quoteOptionLabel = (o: QuoteOption) => OPTION_LABEL[o];

/** The AI price shown next to an offer: the midpoint of the AI's range, or null when there is none. */
export function aiMidpoint(aiMin?: number | null, aiMax?: number | null): number | null {
  const lo = aiMin != null && Number(aiMin) > 0 ? Number(aiMin) : null;
  const hi = aiMax != null && Number(aiMax) > 0 ? Number(aiMax) : null;
  const mid = lo != null && hi != null ? Math.round((lo + hi) / 2) : (hi ?? lo);
  return mid != null && mid > 0 ? mid : null;
}

/** Owner-facing price panel for one crew offer. Never shown to crew. */
export function BidPriceCard({ result, pick, onPick, equipmentNeeded, groundLabel, ownerLabel, aiMin, aiMax, aiLabel, crewShare }: {
  result: PricingResult;
  /** The pick for this offer, if any. */
  pick?: QuotePick | null;
  onPick?: (option: QuoteOption, amount: number) => void;
  /** Human list of what equipment this job needs, e.g. "Crane 4 hr, Chipper". */
  equipmentNeeded?: string | null;
  /** Detail for the ground crew line, e.g. "2 workers × 5 hr". */
  groundLabel?: string | null;
  /** Label for the owner's cut line, e.g. the company name. Defaults to "You". */
  ownerLabel?: string;
  /** The AI price range for this job: Scout's for a Scout job, the website estimate for a website job. */
  aiMin?: number | null;
  aiMax?: number | null;
  /** What to call the AI price, e.g. "Website AI estimate". Defaults to "Scout AI price". */
  aiLabel?: string;
  /** Climber share of net (decimal), for the AI fair-pay guide. */
  crewShare?: number;
}) {
  const aiMid = aiMidpoint(aiMin, aiMax);
  const labelOf = (o: QuoteOption) => (o === 'ai' && aiLabel ? aiLabel : OPTION_LABEL[o]);
  const banner = pick && (
    <div className="rounded-md bg-primary/10 border border-primary/40 p-2 text-sm">
      <Check className="w-4 h-4 inline mr-1 text-primary" />
      <strong>{pick.picked_by_name || 'The owner'}</strong> picked <strong>{labelOf(pick.option)} — {money(pick.amount)}</strong> to send the customer.
      {pick.climber_pay != null && <> Climber pay: <strong>{money(pick.climber_pay)}</strong>.</>}
    </div>
  );
  if (!result.baseSale) {
    // The formula can't price this offer, but the AI price and the owner's own price still can be picked.
    return (
      <div className="rounded-md border p-3 space-y-3">
        {banner}
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {result.warnings[0] ?? 'Not enough information to price this job yet.'}
        </div>
        {aiMid != null && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Box label={labelOf('ai')} value={money(aiMid)} selected={pick?.option === 'ai'}
              onClick={onPick ? () => onPick('ai', aiMid) : undefined} />
          </div>
        )}
        {onPick && <CustomPrice floor={null} picked={pick?.option === 'custom' ? pick.amount : null} onPick={(v) => onPick('custom', v)} />}
      </div>
    );
  }
  const b = result.baseBreakdown!;
  const opts: [QuoteOption, number | null][] = [
    ['lowest', result.minimumSaleFloor], ['recommended', result.baseSale],
    ['plus10', result.plus10Sale], ['plus15', result.plus15Sale],
  ];
  if (aiMid != null) opts.push(['ai', aiMid]);
  // Climber pay is fixed at his ask; any extra from a higher sale goes to the company.
  const netAtAi = aiMid != null ? b.net + (aiMid - b.sale) : null;
  const fairPay = netAtAi != null ? Math.max(0, Math.round(netAtAi * (crewShare ?? 0.4))) : null;
  const diff = aiMid != null && result.baseSale ? ((aiMid - result.baseSale) / result.baseSale) * 100 : null;
  return (
    <div className="rounded-md border p-3 space-y-3">
      {banner}
      {onPick && !pick && <div className="text-xs text-muted-foreground">Tap a price to pick the quote to send.</div>}
      <div className={`grid grid-cols-2 gap-2 ${opts.length > 4 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
        {opts.map(([o, v]) => (
          <Box key={o} label={labelOf(o)} value={money(v)} accent={o === 'recommended'}
            selected={pick?.option === o}
            onClick={onPick && v != null ? () => onPick(o, v) : undefined} />
        ))}
      </div>
      {onPick && <CustomPrice floor={result.minimumSaleFloor} picked={pick?.option === 'custom' ? pick.amount : null} onPick={(v) => onPick('custom', v)} />}

      {aiMid != null && (
        <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-1">
          <div className="font-semibold text-foreground">Formula vs {aiLabel ? 'AI estimate' : 'Scout AI'}</div>
          <Line label="Your formula (Recommended)" value={money(result.baseSale)} />
          <Line label={`${aiLabel ?? 'Scout AI'} midpoint${diff != null ? ` (${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%)` : ''}`} value={money(aiMid)} strong />
          <Line label="Climber gets (his ask, never more)" value={money(b.crew)} />
          <Line label="Fair climber pay (AI guide, owner only)" value={`~${money(fairPay)}`} />
          {netAtAi != null && <Line label={`${ownerLabel || 'You'} keeps at AI price`} value={money(netAtAi - b.crew)} />}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Round-number options: <strong className="text-foreground">{money(result.rounded25Quote)}</strong>
        {' · '}
        <strong className="text-foreground">{money(result.rounded50Quote)}</strong>
      </div>

      <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1">
        <Line label="Fixed cost" value={money(result.costs.fixed)} />
        <Line label={groundLabel ? `Ground crew (${groundLabel})` : 'Ground crew'} value={money(result.costs.grounds)} />
        <Line label="Disposal" value={money(result.costs.disposal)} />
        <Line label={equipmentNeeded ? `Mini skid steer (${equipmentNeeded})` : 'Mini skid steer'} value={money(result.costs.equipment)} />
        <Line label="Stump grinding" value={money(result.costs.stump)} />
        <Line label="Travel / other" value={money(result.costs.travel + result.costs.other)} />
        <Line label="Estimator fee" value={money(b.estimator)} />
        <Line label="Left after costs" value={money(b.net)} strong />
        <Line label="Climber gets" value={money(b.crew)} />
        <Line label={`${ownerLabel || 'You'} keeps`} value={money(b.owner)} strong />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {result.ownerMinimum.enabled ? (
          result.ownerMinimum.passes ? (
            <Badge variant="outline" className="text-[10px]">
              <Check className="w-3 h-3 mr-1" />
              Your share {pct(b.ownerPercent)} — minimum {pct(result.ownerMinimum.requiredPercent)} met
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-[10px]">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Your share is only {pct(b.ownerPercent)} — {money(result.ownerMinimum.shortfallDollars)} short
            </Badge>
          )
        ) : (
          <Badge variant="outline" className="text-[10px]">Your share {pct(b.ownerPercent)}</Badge>
        )}
        {result.adjustedBaseSale != null && (
          <Badge variant="secondary" className="text-[10px]">Price raised to protect your share</Badge>
        )}
      </div>

      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((w, i) => (
            <div key={i} className="text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const Box = ({ label, value, accent, selected, onClick }: { label: string; value: string; accent?: boolean; selected?: boolean; onClick?: () => void }) => (
  <button type="button" disabled={!onClick} onClick={onClick}
    className={`relative text-left rounded-md border p-2 transition ${accent ? 'border-primary/30 bg-primary/5' : ''} ${selected ? 'ring-2 ring-primary border-primary bg-primary/10' : ''} ${onClick ? 'hover:border-primary cursor-pointer' : 'cursor-default'}`}>
    {selected && <Check className="absolute top-1.5 right-1.5 w-4 h-4 text-primary" />}
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className={`font-bold ${accent || selected ? 'text-primary' : ''}`}>{value}</div>
  </button>
);

function CustomPrice({ floor, picked, onPick }: { floor: number | null; picked: number | null; onPick: (v: number) => void }) {
  const [val, setVal] = useState(picked ? String(Math.round(picked)) : '');
  const n = Number(val.replace(/[^0-9.]/g, ''));
  const ok = val.trim() !== '' && Number.isFinite(n) && n > 0 && n <= 1000000;
  const low = ok && floor != null && n < floor;
  return (
    <div className="rounded-md border p-2 space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Or type your own price for the homeowner</div>
      <div className="flex gap-2">
        <Input inputMode="decimal" placeholder="$ e.g. 1850" value={val} onChange={(e) => setVal(e.target.value)} className="h-9" />
        <Button type="button" size="sm" disabled={!ok} onClick={() => onPick(Math.round(n))}>
          {picked ? 'Update' : 'Use this price'}
        </Button>
      </div>
      {low && <div className="text-xs text-destructive">Below the lowest this crew will take ({money(floor)}) — you'd lose money on this job.</div>}
    </div>
  );
}

const Line = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className="flex justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <span className={strong ? 'font-semibold' : ''}>{value}</span>
  </div>
);
