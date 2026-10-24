import { Navigate } from 'react-router-dom';
import { useEntitlements, type Product, PRODUCT_MARKETING_URLS } from '@/hooks/useEntitlements';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, ExternalLink } from 'lucide-react';
import { canUseStorePlans, isAppStoreSafeMode, isNativeStoreBilling } from '@/lib/platform';
import { SafeModeSubscriptionNotice } from '@/components/SafeModeSubscriptionNotice';
import { ScoutUpsell } from '@/components/ScoutUpsell';
import { StorePlanPrompt } from '@/components/billing/StorePlanPrompt';
import { useFreePlan } from '@/hooks/useFreePlan';
import { useAuth } from '@/lib/auth';

interface Props {
  product: Product;
  children: React.ReactNode;
  /** When true, render an in-page upsell instead of redirecting away. */
  showUpsell?: boolean;
  /** A Free-plan owner gets the preview version (Scout: the estimate stays hidden server-side). */
  allowFree?: boolean;
}

/**
 * Blocks access to a feature unless the user (or their account owner) has
 * an active entitlement for the product. Non-entitled users see an upsell
 * card pointing to the marketing page on tradesmarketing.ai — except in iOS
 * App Store Safe Mode, where we show a neutral Spotify-style notice with no
 * external purchase link.
 */
export function EntitlementGate({ product, children, showUpsell = true, allowFree = false }: Props) {
  const { hasProduct, isLoading, entitlements } = useEntitlements();
  const free = useFreePlan();
  const { isTeamMember } = useAuth();

  if (allowFree && free.data?.plan === 'free' && free.data.is_owner) return <>{children}</>;
  if (isLoading || (allowFree && free.isLoading)) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (hasProduct(product)) {
    const trialing = entitlements.find((e) => e.product === product && e.status === 'trialing');
    const daysLeft = trialing?.current_period_end
      ? Math.max(0, Math.ceil((new Date(trialing.current_period_end).getTime() - Date.now()) / 86_400_000))
      : null;

    if (daysLeft !== null && !isAppStoreSafeMode()) {
      return (
        <>
          <div className="bg-primary/10 text-sm px-4 py-2 text-center">
            Free trial — {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left. Your subscription starts
            automatically unless you cancel.
          </div>
          {children}
        </>
      );
    }
    return <>{children}</>;
  }

  if (!showUpsell) {
    return <Navigate to="/dashboard" replace />;
  }

  const productLabel: Record<Product, string> = {
    scout: 'Scout',
    crew_membership: 'Subcontractor membership',
    dma: 'Digital Marketing Agent',
    dma_basic: 'DMA Postcards',
    dma_basic_demo: 'DMA Demo Post',
    dma_web: 'DMA Website Publishing',
    google_reviews: 'Google Reviews',
    lsa: 'LSA Leads',
    leads: 'Lead Marketplace',
    team_seats: 'Team Seats',
  };

  // Phone apps: no Stripe purchase language, no external link. Where they sell the plans, an owner locked out of Scout
  // gets the phone plan screen (the plans include Scout, not DMA or the other products).
  if (isNativeStoreBilling()) {
    if (product === 'scout' && canUseStorePlans() && !isTeamMember) {
      return <StorePlanPrompt title="Scout is part of TreeCheck's plans" body="Photograph a tree and get a price in seconds, then send the quote." />;
    }
    return (
      <SafeModeSubscriptionNotice
        body={`${productLabel[product]} is not active on this account. All subscription and account changes are handled through your TreeCheck account, outside the app.`}
      />
    );
  }

  // Scout sells itself in-app (web only) with a 14-day trial.
  if (product === 'scout') {
    const lapsed = entitlements.some(
      (e) => e.product === 'scout' && (e.status === 'canceled' || e.status === 'past_due'),
    );
    return <ScoutUpsell lapsed={lapsed} />;
  }

  const url = PRODUCT_MARKETING_URLS[product];

  const openMarketing = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <Card>
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
            <Lock className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-bold">{productLabel[product]} is not active</h2>
          <p className="text-muted-foreground">
            Your account doesn't have an active {productLabel[product]} subscription.
            Learn more and sign up on our website.
          </p>
          <Button onClick={openMarketing} className="gap-2">
            Learn more <ExternalLink className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
