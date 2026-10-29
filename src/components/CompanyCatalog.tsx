import { useState } from 'react';
import { CATALOG, CORE_INCLUDED_FIELD_SEATS, formatCents, annualMonthlyEquivalent, type ProductKey } from '@/lib/pricing/catalog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Check, ChevronDown } from 'lucide-react';
import type { PlanChoice } from '@/lib/pricing/planChoice';

/** Core + 1 Scout license — the recommended starting package. */
const RECOMMENDED = {
  month: CATALOG.core.month + CATALOG.scout.month,
  year: CATALOG.core.year + CATALOG.scout.year,
};

/** Core benefits, named so an owner who has never heard of Jobs, Subs or Pulse knows what each does. */
const CORE_FEATURES: { name: string; text: string }[] = [
  { name: 'Jobs', text: 'Compare crew bids and schedule work in Jobber' },
  { name: 'Subs', text: 'Find nearby climbers, ground workers, and specialists' },
  { name: 'Pulse', text: 'See if this month is making money and plan for payroll' },
];

const SCOUT_FEATURES = [
  'AI-assisted tree estimating with Scout',
  "Scout adapts to your company's pricing",
  'Build quotes around costs and target profit margin',
  'Review the final price before the customer sees it',
];

const DMA_FEATURES = [
  'Turn job photos and a voice memo into website content',
  'Help customers discover your work through Google and AI search',
];

export const DEMO_URL = 'https://calendly.com/hello-tradesmarketing/30min';

export const Item = ({ children }: { children: React.ReactNode }) => (
  <li className="flex items-start gap-2">
    <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden />
    <span>{children}</span>
  </li>
);

export function CoreList() {
  return (
    <>
      {CORE_FEATURES.map((f) => (
        <Item key={f.name}><strong className="font-semibold text-foreground">{f.name}</strong> <span className="text-muted-foreground">— {f.text}</span></Item>
      ))}
    </>
  );
}

/** Scout's benefits, shared with the phone apps' plans (StoreCatalog). */
export function ScoutList() {
  return <>{SCOUT_FEATURES.map((f) => <Item key={f}>{f}</Item>)}</>;
}

/** Scout's longer explanation, kept out of the price card so the card stays scannable. */
export function ScoutLearnMore() {
  return (
    <Collapsible className="text-sm" onClick={(e) => e.stopPropagation()}>
      <CollapsibleTrigger className="group inline-flex items-center gap-1 font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
        Learn more about Scout
        <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-3 text-muted-foreground">
        <div>
          <p className="font-semibold text-foreground">Scout learns how your company prices work.</p>
          <p>As you review estimates and approve final prices, Scout gets better at matching the way your company bids jobs.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground">Built specifically for tree work.</p>
          <p>Scout analyzes tree photos and job details to help build estimates around your pricing, costs, and target margins. Approved by Certified Arborists.</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Optional website marketing add-on. Information only: it's added after signup, never in trial checkout. `inApp` is the
 * phone apps' first screen (Mark, 2026-10-29): the same box without the website's Stripe price (Apple 3.1.1, Google Play
 * billing) and without "add it from Marketing", which the Android app can't sell; Schedule a demo stays.
 */
export function DmaAddOn({ interval = 'month', inApp = false }: { interval?: 'month' | 'year'; inApp?: boolean }) {
  const per = interval === 'year' ? 'year' : 'month';
  return (
    <section aria-labelledby="dma-heading" className="rounded-lg border border-dashed border-border p-5 sm:p-6 space-y-3 text-sm text-left">
      <h2 id="dma-heading" className="text-lg font-bold">Want TreeCheck connected to your website?</h2>
      <div>
        <p className="font-semibold">{CATALOG.dma.label}</p>
        <p className="text-muted-foreground">Turn the work you finish into marketing for your next job.</p>
      </div>
      <ul className="space-y-2 text-muted-foreground">{DMA_FEATURES.map((f) => <Item key={f}>{f}</Item>)}</ul>
      <div className="space-y-2">
        <p className="font-semibold">Two ways to get it:</p>
        <div className="rounded-md border border-border p-3">
          <p><span className="font-semibold">Included</span> <span className="text-muted-foreground">when we build your AI-enabled website. Featured jobs publish straight to your site.</span></p>
        </div>
        <div className="rounded-md border border-border p-3">
          {inApp ? (
            <p><span className="font-semibold">Keeping your current website?</span> <span className="text-muted-foreground">We write the content and you copy it into your site.</span></p>
          ) : (
            <p><span className="font-semibold">{formatCents(CATALOG.dma[interval])}/{per} per company</span> <span className="text-muted-foreground">if you keep your current website. We write the content and you copy it into your site.</span></p>
          )}
        </div>
      </div>
      {!inApp && <p><span className="font-semibold">Add it anytime after signup</span> <span className="text-muted-foreground">from Marketing in the menu.</span></p>}
      <a
        href={DEMO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-full items-center justify-center rounded-md border border-primary px-4 py-2 font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition-colors sm:w-auto"
      >
        Schedule a demo
      </a>
    </section>
  );
}

/** Extra seats and how to add them. */
export function TeammatesInfo({ interval = 'month' }: { interval?: 'month' | 'year' }) {
  const per = interval === 'year' ? 'year' : 'month';
  const unit = (key: ProductKey) => `${formatCents(CATALOG[key][interval])}/${per}`;
  return (
    <Collapsible className="rounded-lg border border-border text-sm text-left">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Add teammates as you grow
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-2 px-4 pb-3 text-muted-foreground">
          <li><strong className="font-semibold text-foreground">Additional Scout estimator:</strong> {unit('scout')} per person.</li>
          <li><strong className="font-semibold text-foreground">Additional manager:</strong> {unit('manager')} per person.</li>
          <li><strong className="font-semibold text-foreground">Additional field user:</strong> {unit('field')} beyond the {CORE_INCLUDED_FIELD_SEATS} included.</li>
        </ul>
        <p className="px-4 pb-4 text-muted-foreground">
          <strong className="font-semibold text-foreground">How to add them:</strong> after you sign up, open <strong className="font-semibold text-foreground">Subs → Office team</strong>, tap <strong className="font-semibold text-foreground">+</strong> to add a seat, then enter their email and tap <strong className="font-semibold text-foreground">Invite</strong>. They get an email to join. No charge for added seats during your trial.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The company plans. Without `onSelect` it only shows them (the Pricing page). With `onSelect` (signup and the plan
 * picker) the two starting plans can be picked and the toggle sets the chosen interval. `onStart` adds a trial button
 * to each card; `addOns={false}` leaves website marketing and teammates for the caller to place.
 */
export function CompanyCatalog({ selected, onSelect, onStart, addOns = true }: {
  selected?: PlanChoice;
  onSelect?: (choice: PlanChoice) => void;
  onStart?: (choice: PlanChoice) => void;
  addOns?: boolean;
} = {}) {
  const [ownInterval, setOwnInterval] = useState<'month' | 'year'>('month');
  const choosing = !!onSelect && !!selected;
  const interval = choosing ? selected.interval : ownInterval;
  const yearly = interval === 'year';
  const setInterval = (i: 'month' | 'year') => (choosing ? onSelect({ ...selected, interval: i }) : setOwnInterval(i));
  const isPicked = (ownerScout: boolean) => choosing && selected.ownerScout === ownerScout;
  const pickable = (ownerScout: boolean) => choosing
    ? {
        role: 'button', tabIndex: 0, 'aria-pressed': selected.ownerScout === ownerScout,
        onClick: () => onSelect({ ownerScout, interval }),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ ownerScout, interval }); }
        },
      }
    : {};
  const per = yearly ? 'year' : 'month';
  const unit = (key: ProductKey) => `${formatCents(CATALOG[key][interval])}/${per}`;
  const cardClass = (ownerScout: boolean) =>
    `flex flex-col rounded-xl p-5 sm:p-6 gap-4 relative text-sm bg-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      isPicked(ownerScout) ? 'border-2 border-primary' : 'border border-border'
    }${choosing ? ' cursor-pointer hover:border-primary/70' : ''}`;
  const pickedMark = (ownerScout: boolean) =>
    choosing && (
      <span
        aria-hidden
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${isPicked(ownerScout) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'}`}
      >
        {isPicked(ownerScout) && <Check className="h-3 w-3" />}
      </span>
    );
  const startButton = (ownerScout: boolean) => onStart && (
    <Button
      type="button"
      size="lg"
      variant={ownerScout ? 'default' : 'outline'}
      className={`mt-auto w-full ${ownerScout ? 'gradient-primary' : ''}`}
      onClick={(e) => { e.stopPropagation(); onStart({ ownerScout, interval }); }}
    >
      Start free for 14 days
    </Button>
  );

  return <section className="space-y-4 text-left" aria-labelledby="plans-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="plans-heading" className="text-2xl font-bold">{choosing ? 'Simple pricing' : 'Company plans'}</h2>
      <div className="flex gap-1" role="group" aria-label="Billing frequency">
        <Button type="button" variant={interval === 'month' ? 'default' : 'outline'} size="sm" aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>Monthly</Button>
        <Button type="button" variant={interval === 'year' ? 'default' : 'outline'} size="sm" aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>Annual</Button>
      </div>
    </div>

    <div className="grid gap-5 md:grid-cols-2 md:items-stretch">
      {/* Core only */}
      <div className={`${cardClass(false)} order-2 md:order-1`} {...pickable(false)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">Core</h3>
            <p className="text-muted-foreground">Keep your jobs moving and your numbers in view.</p>
          </div>
          {pickedMark(false)}
        </div>
        <div>
          <p className="text-3xl font-black">{unit('core')} <span className="text-sm font-normal text-muted-foreground">per company</span></p>
          {yearly && <p className="text-muted-foreground">Billed annually · ${annualMonthlyEquivalent('core')}/month equivalent</p>}
        </div>
        <ul className="space-y-2">
          <CoreList />
          <Item><span className="text-muted-foreground">Owner account + {CORE_INCLUDED_FIELD_SEATS} field users included</span></Item>
        </ul>
        <p className="text-muted-foreground border-t border-border pt-3">Review and approve your team’s estimates with Core. Add Scout when you need estimating access yourself.</p>
        {startButton(false)}
      </div>

      {/* Recommended: Core + Scout */}
      <div className={`${cardClass(true)} order-1 md:order-2`} {...pickable(true)}>
        <Badge className="gradient-primary text-primary-foreground px-3 absolute -top-3 left-5">Recommended</Badge>
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="min-w-0">
            <h3 className="text-lg font-bold">Core + Scout</h3>
            <p className="text-muted-foreground">Run the business + price the work.</p>
          </div>
          {pickedMark(true)}
        </div>
        <div>
          <p className="text-3xl font-black">{formatCents(RECOMMENDED[interval])}/{per} <span className="text-sm font-normal text-muted-foreground">per company</span></p>
          {yearly && <p className="text-muted-foreground">Billed annually · {formatCents(Math.floor(RECOMMENDED.year / 12))}/month equivalent</p>}
        </div>
        <ul className="space-y-2 text-muted-foreground">
          <Item><strong className="font-semibold text-foreground">Everything in Core</strong> — Jobs, Subs, Pulse</Item>
          <ScoutList />
          <Item>Owner account + {CORE_INCLUDED_FIELD_SEATS} field users included</Item>
          <Item>Scout estimating access for 1 person — use it yourself or assign it to a teammate</Item>
        </ul>
        <ScoutLearnMore />
        {startButton(true)}
      </div>
    </div>

    {addOns && (
      <>
        <DmaAddOn interval={interval} />
        <TeammatesInfo interval={interval} />
      </>
    )}

    <p className="text-sm text-muted-foreground">Subcontractor accounts are free. Prices before tax.</p>
  </section>;
}
