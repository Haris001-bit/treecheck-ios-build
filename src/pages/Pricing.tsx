import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Crown, Wallet, Check, Loader2, Clock, RotateCcw, TrendingDown } from 'lucide-react';
import { useSubscription, useUpgradeToPremium } from '@/hooks/useSubscription';
import { useBuyCredits } from '@/hooks/usePayment';
import { CREDIT_PURCHASE, PREMIUM_CREDIT_PURCHASE } from '@/lib/subscriptions';
import { Navigate } from 'react-router-dom';
import { canUseAppleIAP, isStrictSafeMode } from '@/lib/platform';
import { CompanyCatalog } from '@/components/CompanyCatalog';
import {
  useIapBuyCredits250,
  useIapBuyCredits500,
  useIapRestore,
} from '@/hooks/useRevenueCat';

export default function Pricing() {
  if (isStrictSafeMode()) return <Navigate to="/dashboard/subscription-info" replace />;

  const iap = canUseAppleIAP();
  const { data: subscription } = useSubscription();
  const upgradeMutation = useUpgradeToPremium();
  const buyCredits = useBuyCredits();
  const iap250 = useIapBuyCredits250();
  const iap500 = useIapBuyCredits500();
  const iapRestore = useIapRestore();

  const isPremium = subscription?.tier === 'premium';
  const creditsPending = iap ? iap250.isPending : buyCredits.isPending;
  const premiumPending = iap ? iap500.isPending : upgradeMutation.isPending;

  const standardFeatures = [
    '5% fee per lead unlock',
    'Access to all leads in your service areas',
    'Pay per lead — no commitment',
  ];

  const creditFeatures = [
    `$${CREDIT_PURCHASE.amount} one-time credit purchase`,
    '2.5% rate on the lead that triggered the purchase',
    'Standard 5% rate on all other leads',
    'Credits never expire',
  ];

  const onBuyCredits = () => {
    if (iap) iap250.mutate();
    else buyCredits.mutate(undefined);
  };

  const onBuyPremium = () => {
    if (iap) iap500.mutate();
    else upgradeMutation.mutate();
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-display font-bold text-foreground">
          Choose Your Plan
        </h1>
        <p className="text-muted-foreground mt-2">
          {iap
            ? 'Purchases are processed by Apple In-App Purchase'
            : 'Unlock more leads at better rates'}
        </p>
      </div>

      {!iap && <CompanyCatalog />}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-border">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg font-display">Standard</CardTitle>
            <p className="text-3xl font-bold mt-2">5%</p>
            <p className="text-sm text-muted-foreground">of estimated job value</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-3">
              {standardFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button variant="outline" className="w-full" disabled>
              Current Default
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg font-display">Credit Refill</CardTitle>
            </div>
            <p className="text-3xl font-bold mt-2">${CREDIT_PURCHASE.amount}</p>
            <p className="text-sm text-muted-foreground">one-time purchase</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-3">
              {creditFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Button
              onClick={onBuyCredits}
              disabled={creditsPending}
              className="w-full"
              variant="outline"
            >
              {creditsPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wallet className="mr-2 h-4 w-4" />
              )}
              Buy ${CREDIT_PURCHASE.amount} in Credits
            </Button>
          </CardContent>
        </Card>

        <Card className="border-primary ring-2 ring-primary relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge className="gradient-primary text-primary-foreground px-3">
              Best Value
            </Badge>
          </div>
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg font-display">Premium</CardTitle>
            </div>
            <p className="text-3xl font-bold mt-2">${PREMIUM_CREDIT_PURCHASE.amount}</p>
            <p className="text-sm text-muted-foreground">one-time purchase</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <Clock className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">60-Minute Early Access</p>
                  <p className="text-xs text-muted-foreground">See and unlock new leads before anyone else</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <RotateCcw className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Top 3 Rotation</p>
                  <p className="text-xs text-muted-foreground">Premium members rotate for first dibs on every lead</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                <TrendingDown className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">2.5% When Out of Rotation</p>
                  <p className="text-xs text-muted-foreground">Half-price unlock fee on leads where you didn't get early access</p>
                </div>
              </div>
            </div>

            <ul className="space-y-2 pt-1">
              <li className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <span>${PREMIUM_CREDIT_PURCHASE.amount} added to your credit balance</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <span>Credits never expire</span>
              </li>
            </ul>
            {isPremium ? (
              <Button disabled className="w-full gradient-primary">
                <Crown className="mr-2 h-4 w-4" />
                You're Premium
              </Button>
            ) : (
              <Button
                onClick={onBuyPremium}
                disabled={premiumPending}
                className="w-full gradient-primary"
              >
                {premiumPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Crown className="mr-2 h-4 w-4" />
                )}
                Buy Premium Credits
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {iap && (
        <div className="mt-6 text-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={iapRestore.isPending}
            onClick={() => iapRestore.mutate()}
          >
            {iapRestore.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Restore Purchases
          </Button>
        </div>
      )}

      {subscription && subscription.credit_balance > 0 && (
        <div className="mt-6 p-3 rounded-lg border border-primary/20 bg-primary/5 text-center">
          <p className="text-sm text-foreground">
            <Wallet className="inline h-4 w-4 mr-1" />
            Your current credit balance:{' '}
            <span className="font-semibold">${subscription.credit_balance.toFixed(2)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
