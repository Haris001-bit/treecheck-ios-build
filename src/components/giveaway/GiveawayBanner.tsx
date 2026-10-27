import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import heroShot from '@/assets/ripsaw-hero.jpg.asset.json';
import { GIVEAWAY_COPY, GIVEAWAY_DISCLOSURE } from '@/lib/giveaway';

/** RipSaw giveaway notice. The caller shows it only while entries are open, on the website. */
export function GiveawayBanner({ ctaTo, onCta }: { ctaTo?: string; onCta?: () => void }) {
  const cta = 'Start my 14-day free trial';
  return (
    <section
      aria-labelledby="giveaway-heading"
      className="mx-auto max-w-3xl overflow-hidden rounded-xl border border-primary/40 bg-card grid sm:grid-cols-[minmax(0,13rem)_1fr]"
    >
      {/* Decorative: the heading already names the prize, so screen readers don't hear it twice
          and a slow-loading photo never shows alt text in the layout. */}
      <img
        src={heroShot.url}
        alt=""
        aria-hidden="true"
        width={900}
        height={900}
        loading="lazy"
        className="h-40 w-full object-cover object-[50%_60%] sm:h-full sm:object-center bg-muted"
      />
      <div className="p-5 space-y-2 text-sm">
        <h2 id="giveaway-heading" className="font-display font-black uppercase leading-[0.95] text-2xl">
          Win a Ported <span className="text-primary">RipSaw RS2511</span>
        </h2>
        <p className="text-foreground">{GIVEAWAY_COPY}</p>
        <p className="font-semibold">Ends November 30.</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          {ctaTo ? (
            <Button asChild size="sm" className="gradient-primary"><Link to={ctaTo}>{cta}</Link></Button>
          ) : (
            <Button type="button" size="sm" className="gradient-primary" onClick={onCta}>{cta}</Button>
          )}
          <Link to="/giveaway/rules" className="text-sm font-semibold text-primary underline">See Official Rules</Link>
        </div>
        <p className="text-xs text-muted-foreground">{GIVEAWAY_DISCLOSURE}</p>
      </div>
    </section>
  );
}
