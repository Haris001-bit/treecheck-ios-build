import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CoreList, Item, ScoutLearnMore, ScoutList } from '@/components/CompanyCatalog';
import { useStorePlanPackages } from '@/hooks/useRevenueCat';
import { storePlanPackage } from '@/lib/revenueCat';
import { CORE_INCLUDED_FIELD_SEATS } from '@/lib/pricing/catalog';
import { freeTrialDays } from '@/lib/billing/storePlanState';
import { storeName } from '@/lib/platform';
import type { StorePlanKey } from '@/lib/iapProducts';

type Offer = { price: string; trial: number | null };

const card = 'flex flex-col rounded-xl p-5 sm:p-6 gap-4 relative text-sm bg-card';

/**
 * The company plans on the phone apps' first screen, laid out like the website's (Mark, 2026-10-29). The apps can't show
 * the website's Stripe prices (Apple 3.1.1, Google Play billing), so these are the plans the store sells, at the store's
 * own prices fetched live, before anyone has an account. The plan is bought in the store after signup (StorePlans).
 * Nothing shows when the store can't be reached.
 */
export function StoreCatalog({ onStart }: { onStart: () => void }) {
  const packages = useStorePlanPackages();
  if (packages.isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading plans" /></div>;
  }
  const list = packages.data ?? [];
  const offer = (key: StorePlanKey): Offer | null => {
    const pkg = storePlanPackage(list, key);
    return pkg ? { price: pkg.product.priceString, trial: freeTrialDays(pkg.product as Parameters<typeof freeTrialDays>[0]) } : null;
  };
  const scout = offer('core_scout_monthly');
  const core = offer('core_monthly');
  const yearly = offer('core_yearly');
  if (!scout && !core && !yearly) return null;

  const price = (o: Offer, per: 'month' | 'year') => (
    <div>
      <p className="text-3xl font-black">{o.price}/{per} <span className="text-sm font-normal text-muted-foreground">per company</span></p>
      <p className="text-muted-foreground">
        {o.trial ? `${o.trial} days free for new subscribers, then ${o.price}/${per}. ` : ''}Renews automatically until you cancel.
      </p>
    </div>
  );
  const start = (o: Offer, primary: boolean) => (
    <Button
      type="button"
      size="lg"
      variant={primary ? 'default' : 'outline'}
      className={`mt-auto w-full ${primary ? 'gradient-primary' : ''}`}
      onClick={onStart}
    >
      {o.trial ? `Start free for ${o.trial} days` : 'Get started'}
    </Button>
  );
  const seats = <Item><span className="text-muted-foreground">Owner account + {CORE_INCLUDED_FIELD_SEATS} field users included</span></Item>;

  return (
    <section className="space-y-4 text-left" aria-labelledby="store-plans-heading">
      <h2 id="store-plans-heading" className="text-2xl font-bold">Simple pricing</h2>
      <div className="grid gap-5 md:grid-cols-2 md:items-stretch">
        {scout && (
          <div className={`${card} border-2 border-primary`}>
            <Badge className="gradient-primary text-primary-foreground px-3 absolute -top-3 left-5">Recommended</Badge>
            <div className="pt-1">
              <h3 className="text-lg font-bold">Core + Scout</h3>
              <p className="text-muted-foreground">Run the business + price the work.</p>
            </div>
            {price(scout, 'month')}
            <ul className="space-y-2 text-muted-foreground">
              <Item><strong className="font-semibold text-foreground">Everything in Core:</strong> Jobs, Subs, Pulse</Item>
              <ScoutList />
              {seats}
              <Item>Scout estimating access for 1 person, for you or a teammate</Item>
            </ul>
            <ScoutLearnMore />
            {start(scout, true)}
          </div>
        )}
        {core && (
          <div className={`${card} border border-border`}>
            <div>
              <h3 className="text-lg font-bold">Core</h3>
              <p className="text-muted-foreground">Keep your jobs moving and your numbers in view.</p>
            </div>
            {price(core, 'month')}
            <ul className="space-y-2">
              <CoreList />
              {seats}
            </ul>
            <p className="text-muted-foreground border-t border-border pt-3">Review and approve your team’s estimates with Core. Add Scout when you need estimating access yourself.</p>
            {start(core, false)}
          </div>
        )}
        {yearly && (
          <div className={`${card} border border-border`}>
            <div>
              <h3 className="text-lg font-bold">Core, yearly</h3>
              <p className="text-muted-foreground">Everything in Core, billed once a year.</p>
            </div>
            {price(yearly, 'year')}
            <ul className="space-y-2">{seats}</ul>
            {start(yearly, false)}
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Prices from {storeName()}. You choose your plan there after creating your account, and you can cancel anytime in your
        subscription settings. Subcontractor accounts are free.
      </p>
      <p className="text-xs text-muted-foreground">
        <Link to="/terms" className="underline">Terms of Use</Link> · <Link to="/privacy" className="underline">Privacy Policy</Link>
      </p>
    </section>
  );
}
