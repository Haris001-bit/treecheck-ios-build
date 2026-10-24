import { useState } from 'react';
import { CATALOG, formatCents, annualMonthlyEquivalent, type ProductKey } from '@/lib/pricing/catalog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';
import type { PlanChoice } from '@/lib/pricing/planChoice';

/** Core + 1 Scout license — the recommended starting package. */
const RECOMMENDED = {
  month: CATALOG.core.month + CATALOG.scout.month,
  year: CATALOG.core.year + CATALOG.scout.year,
};

const CORE_FEATURES = [
  'Jobs, Subs, and Pulse',
  'Supported integrations',
  'One owner account',
  'Two Field/Job seats included',
];

const SCOUT_FEATURES = [
  'Create AI-assisted and manually priced estimates',
  'Request approval before sending',
  'Move opportunities into Jobs',
];

/**
 * The company plans. Without `onSelect` it only shows them (the Pricing page). With `onSelect` (signup and the plan
 * picker, payments milestone) the two starting plans can be picked and the toggle sets the chosen interval.
 */
export function CompanyCatalog({ selected, onSelect }: { selected?: PlanChoice; onSelect?: (choice: PlanChoice) => void } = {}) {
  const [ownInterval, setOwnInterval] = useState<'month' | 'year'>('month');
  const choosing = !!onSelect && !!selected;
  const interval = choosing ? selected.interval : ownInterval;
  const setInterval = (i: 'month' | 'year') => (choosing ? onSelect({ ...selected, interval: i }) : setOwnInterval(i));
  const ring = (ownerScout: boolean) => (choosing && selected.ownerScout === ownerScout ? ' ring-2 ring-primary' : '');
  const pickable = (ownerScout: boolean) => choosing
    ? {
        role: 'button', tabIndex: 0, 'aria-pressed': selected.ownerScout === ownerScout,
        onClick: () => onSelect({ ownerScout, interval }),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ ownerScout, interval }); }
        },
      }
    : {};
  const unit = (key: ProductKey) => `${formatCents(CATALOG[key][interval])}/${interval === 'year' ? 'year' : 'month'}`;
  return <section className="space-y-4 mb-8 text-left">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-xl font-bold">{choosing ? 'Choose your plan' : 'Company plans'}</h2>
      <div className="flex gap-1">
        <Button type="button" variant={interval === 'month' ? 'default' : 'outline'} size="sm" onClick={() => setInterval('month')}>Monthly</Button>
        <Button type="button" variant={interval === 'year' ? 'default' : 'outline'} size="sm" onClick={() => setInterval('year')}>Annual</Button>
      </div>
    </div>

    <div className={`border-2 border-primary rounded-lg p-5 space-y-4 relative${choosing ? ' cursor-pointer' : ''}${ring(true)}`} {...pickable(true)}>
      <Badge className="gradient-primary text-primary-foreground px-3 absolute -top-3 left-4">Recommended</Badge>
      <div>
        <h3 className="text-lg font-bold">Core + 1 Scout license</h3>
        <p className="text-2xl font-bold mt-1">{formatCents(RECOMMENDED.month)}/month</p>
        <p className="text-sm text-muted-foreground">
          or {formatCents(RECOMMENDED.year)}/year, paid upfront ({formatCents(Math.floor(RECOMMENDED.year / 12))}/month equivalent)
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          The Scout license can be assigned to you or another estimator on your team.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-semibold mb-1">Core</p>
          <ul className="space-y-1 text-muted-foreground">
            {CORE_FEATURES.map((f) => <li key={f} className="flex items-start gap-2"><Check className="h-4 w-4 text-primary mt-0.5 shrink-0" /><span>{f}</span></li>)}
          </ul>
        </div>
        <div>
          <p className="font-semibold mb-1">Scout</p>
          <ul className="space-y-1 text-muted-foreground">
            {SCOUT_FEATURES.map((f) => <li key={f} className="flex items-start gap-2"><Check className="h-4 w-4 text-primary mt-0.5 shrink-0" /><span>{f}</span></li>)}
          </ul>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Core alone does not include creating Scout estimates. Reviewing or approving another user's estimate never requires a Scout license.
      </p>
    </div>

    <div className="grid sm:grid-cols-3 gap-4">
      <div className={`border rounded-lg p-4 space-y-2${choosing ? ' cursor-pointer' : ''}${ring(false)}`} {...pickable(false)}>
        <h3 className="font-semibold">Core only</h3>
        <p className="text-xl font-bold">{unit('core')}</p>
        <p className="text-sm text-muted-foreground">Per company{interval === 'year' ? ` · $${annualMonthlyEquivalent('core')}/month equivalent, paid annually` : ''}</p>
      </div>
      <div className="border rounded-lg p-4 space-y-2">
        <h3 className="font-semibold">Scout estimator seat</h3>
        <p className="text-xl font-bold">{unit('scout')}</p>
        <p className="text-sm text-muted-foreground">Per estimator{interval === 'year' ? ` · $${annualMonthlyEquivalent('scout')}/month equivalent, paid annually` : ''}</p>
      </div>
      <div className="border rounded-lg p-4 space-y-2">
        <h3 className="font-semibold">{CATALOG.dma.label}</h3>
        <p className="text-xl font-bold">{unit('dma')}</p>
        <p className="text-sm text-muted-foreground">Per company{interval === 'year' ? ` · $${annualMonthlyEquivalent('dma')}/month equivalent, paid annually` : ''}</p>
      </div>
    </div>

    <p className="text-sm text-muted-foreground">Additional Manager: {formatCents(CATALOG.manager[interval])}/user/{interval}. Additional Field beyond two included: {formatCents(CATALOG.field[interval])}/user/{interval}. Subcontractors are free. Prices before tax.</p>
  </section>;
}
