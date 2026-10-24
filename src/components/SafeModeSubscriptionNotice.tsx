/**
 * SafeModeSubscriptionNotice
 *
 * iOS App Store Safe Mode notice — Spotify-style. Shown anywhere the app would
 * normally surface an upgrade, subscribe, register, or purchase CTA. It carries
 * NO link to a paid destination, NO pricing, and NO purchase language — just a
 * neutral message that subscription changes are handled outside the app.
 *
 * Use this on every paid-service surface (Scout upgrade, DMA, LSA, Marketing,
 * Team seats, wallet, credits, registration prompts) when isAppStoreSafeMode().
 */

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import treecheckLogo from '@/assets/treecheck-logo-dark.png';

interface Props {
  /** Optional headline override. Defaults to the Spotify-style copy. */
  title?: string;
  /** Optional body override. */
  body?: string;
  /** Optional dismiss handler; when provided, renders a "Got it" button. */
  onDismiss?: () => void;
  className?: string;
}

export function SafeModeSubscriptionNotice({
  title = 'Subscription changes happen outside the app',
  body = 'All subscription and account changes are handled through your TreeCheck account, outside the app.',
  onDismiss,
  className,
}: Props) {
  return (
    <div className={className ?? 'p-4 lg:p-8 max-w-lg mx-auto'}>
      <Card className="border-border/60">
        <CardContent className="pt-8 pb-8 text-center space-y-5">
          <div className="flex items-center justify-center gap-2">
            <img
              src={treecheckLogo}
              alt=""
              aria-hidden
              className="h-6 w-auto object-contain opacity-90"
            />
            <span className="text-sm font-semibold text-primary">TREECHECK</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-semibold text-foreground leading-snug">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {body}
          </p>
          {onDismiss ? (
            <div className="pt-2">
              <Button
                onClick={onDismiss}
                className="rounded-full px-8 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Got it
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
