import { useLeads, useHasPurchasedLead } from '@/hooks/useLeads';
import { useNavigate } from 'react-router-dom';
import { usePaymentMethod, useSetupPaymentMethod, usePurchaseLeadWithStripe, useBuyCredits, useAddCredits } from '@/hooks/usePayment';
import { useSubscription, useUpgradeToPremium } from '@/hooks/useSubscription';
import { getLeadPrice, STANDARD_FEE_RATE, CREDIT_PURCHASE, getStandardRateForLead } from '@/lib/subscriptions';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadPhoto } from '@/components/LeadPhoto';
import { MapPin, DollarSign, Users, Clock, Loader2, CreditCard, AlertCircle, Wallet, Crown, CalendarClock, Lock, SearchX } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useServiceAreas } from '@/hooks/useServiceAreas';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useNewLeadAlert } from '@/hooks/useNewLeadAlert';
import { ExpiringCreditsBanner } from '@/components/ExpiringCreditsBanner';
import { JustMissedSection } from '@/components/JustMissedSection';
import { StreakStatusWidget } from '@/components/StreakStatusWidget';
import { isAppStoreSafeMode, isNativeStoreBilling, canShowPaymentUI, isExternalUnlockAllowed, canUseAppleIAP, canShowCommerceUI } from '@/lib/platform';
import { IOSLeadPreviewCard } from '@/components/IOSLeadPreviewCard';
import { useIapUnlockLead, pickLeadUnlockTier, formatUsd } from '@/hooks/useRevenueCat';
import { useIsCrewOnly } from '@/hooks/useCrew';

function LeadCard({ lead, hasPaymentMethod, onSetupPayment, isPremium, creditBalance, onBuyCredits, discountNextLead, inRotation }: {
  lead: any;
  hasPaymentMethod: boolean;
  onSetupPayment: () => void;
  isPremium: boolean;
  creditBalance: number;
  onBuyCredits: (leadId: string) => void;
  discountNextLead: boolean;
  inRotation: boolean;
}) {
  const navigate = useNavigate();
  const currentRate = getStandardRateForLead(lead.created_at);
  const standardPrice = getLeadPrice(lead.estimated_cost_min, lead.estimated_cost_max, currentRate);
  const discountPrice = getLeadPrice(lead.estimated_cost_min, lead.estimated_cost_max, CREDIT_PURCHASE.discountRate);
  const { data: hasPurchased, isLoading: checkingPurchase } = useHasPurchasedLead(lead.id);
  const purchaseMutation = usePurchaseLeadWithStripe();
  const iapUnlock = useIapUnlockLead();
  const iap = canUseAppleIAP();

  const effectivePrice = isPremium
    ? (inRotation ? standardPrice : discountPrice)
    : (discountNextLead ? Math.min(discountPrice, standardPrice) : standardPrice);
  const fullPrice = getLeadPrice(lead.estimated_cost_min, lead.estimated_cost_max, STANDARD_FEE_RATE);
  const willUseCredits = creditBalance >= effectivePrice;
  const savings = fullPrice - discountPrice;
  const iapTier = pickLeadUnlockTier(effectivePrice);
  const unlockPending = purchaseMutation.isPending || iapUnlock.isPending;

  const handlePurchase = () => {
    if (iap) {
      iapUnlock.mutate({
        leadId: lead.id,
        leadPriceUsd: effectivePrice,
        creditBalance,
        useDiscount: discountNextLead,
      });
      return;
    }
    if (!hasPaymentMethod && creditBalance < effectivePrice) {
      onSetupPayment();
      return;
    }
    purchaseMutation.mutate({ leadId: lead.id, useDiscount: discountNextLead });
  };

  const isSample = lead.is_sample === true;
  const isSoldOut = (lead.purchase_count ?? 0) >= 3 || lead.status === 'sold_out';
  const isAvailable = lead.status === 'available' && !hasPurchased && !isSample && !isSoldOut;
  const showCommerce = canShowCommerceUI();
  const unlockLabel = iap
    ? willUseCredits
      ? `Unlock for ${formatUsd(effectivePrice)} (from credits)`
      : `Unlock for ${formatUsd(iapTier.priceUsd)} (App Store)`
    : `Unlock for $${effectivePrice.toFixed(2)}${willUseCredits ? ' (from credits)' : ''}`;


  return (
    <Card className={cn("overflow-hidden hover:shadow-lg transition-shadow", isSample && "opacity-80", isSoldOut && "opacity-60")}>
      <div className="relative">
        <LeadPhoto photoUrl={lead.photo_url} aspectRatio="4/3" objectFit="contain" />
        {isSample && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-4xl font-bold text-white/60 rotate-[-30deg] select-none tracking-widest uppercase"
              style={{ textShadow: '2px 2px 8px rgba(0,0,0,0.5)' }}>
              SAMPLE
            </span>
          </div>
        )}
        {isSoldOut ? (
          <div className="absolute top-3 right-3">
            <Badge className="bg-destructive text-destructive-foreground">
              Sold Out
            </Badge>
          </div>
        ) : (Date.now() - new Date(lead.created_at).getTime()) < 3 * 24 * 60 * 60 * 1000 && (
          <div className="absolute top-3 right-3">
            <Badge className="gradient-primary text-primary-foreground">
              Fresh New Lead!
            </Badge>
          </div>
        )}
      </div>

      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <MapPin className="w-4 h-4" />
            <span>{lead.city}</span>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {lead.job_type || 'Tree Removal'}
          </span>
        </div>
        {lead.urgency && lead.urgency !== 'Flexible' && (
          <div className="flex items-center gap-1 mt-1">
            <CalendarClock className={cn("w-3.5 h-3.5", (lead.urgency === 'Emergency' || lead.urgency === 'As soon as possible') ? 'text-destructive' : 'text-amber-500')} />
            <span className={cn("text-xs font-medium", (lead.urgency === 'Emergency' || lead.urgency === 'As soon as possible') ? 'text-destructive' : 'text-amber-500')}>
              {lead.urgency === 'Emergency' ? '🚨 Emergency' : lead.urgency}
            </span>
          </div>
        )}
        <CardTitle className="text-lg font-display">
          Estimated: ${lead.estimated_cost_min.toLocaleString()} - ${lead.estimated_cost_max.toLocaleString()}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {lead.purchase_count === 0 && (
          <div className={cn("flex items-center gap-2 text-sm font-medium text-primary")}>
            <Users className="w-4 h-4" />
            <span>Be the first to unlock this lead!</span>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>{formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}</span>
          </div>
        </div>

        {isSoldOut ? (
          <Button disabled className="w-full bg-muted text-muted-foreground cursor-not-allowed">
            <Lock className="mr-2 h-4 w-4" />
            No longer available
          </Button>
        ) : isSample ? (
          <div className="space-y-2">
            <Button disabled className="w-full bg-muted text-muted-foreground cursor-not-allowed">
              Sample lead
            </Button>
          </div>
        ) : hasPurchased ? (
          <Button disabled className="w-full">
            Already in Your Leads
          </Button>
        ) : !showCommerce ? (
          <Button disabled className="w-full bg-muted text-muted-foreground cursor-not-allowed">
            <Lock className="mr-2 h-4 w-4" />
            Not available on mobile
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              onClick={handlePurchase}
              disabled={!isAvailable || unlockPending || checkingPurchase}
              className="w-full gradient-primary"
            >
              {unlockPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <DollarSign className="mr-2 h-4 w-4" />
                  {unlockLabel}
                </>
              )}
            </Button>

            {iap && !willUseCredits && (
              <p className="text-xs text-center text-muted-foreground">
                Or{' '}
                <button
                  type="button"
                  onClick={() => navigate('/dashboard/pricing')}
                  className="underline font-semibold text-primary"
                >
                  buy credits
                </button>{' '}
                to unlock at the web rate ({formatUsd(effectivePrice)}).
              </p>
            )}

            {!iap && isPremium ? (
              <p className="text-xs text-center text-primary-foreground bg-primary/80 rounded-md px-2 py-1">
                <Crown className="inline h-3 w-3 mr-1" />
                {inRotation 
                  ? <>Early access lead — <span className="font-semibold">{Math.round(currentRate * 100)}%</span> rate (${effectivePrice.toFixed(2)})</>
                  : <>Premium rate: <span className="font-semibold">${discountPrice.toFixed(2)}</span> — you save ${savings.toFixed(2)}</>
                }
              </p>
            ) : !iap && creditBalance > 0 ? (
              <p className="text-xs text-center text-primary-foreground bg-primary/80 rounded-md px-2 py-1">
                <Wallet className="inline h-3 w-3 mr-1" />
                {willUseCredits ? `Paying from your credit balance ($${creditBalance.toFixed(2)} available). ` : ''}
                Get this for <span className="font-semibold">${discountPrice.toFixed(2)}</span> when you{' '}
                <button
                  onClick={() => navigate('/dashboard/pricing')}
                  className="underline font-semibold hover:opacity-80"
                >
                  upgrade to Premium
                </button>
              </p>
            ) : !iap ? (
              <p className="text-xs text-center text-destructive-foreground bg-destructive rounded-md px-2 py-1 font-bold">
                Get this lead for ${discountPrice.toFixed(2)} when you{' '}
                <button
                  onClick={() => onBuyCredits(lead.id)}
                  className="underline hover:opacity-80"
                >
                  pre-pay for credits
                </button>
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  useNewLeadAlert();
  const { user } = useAuth();
  const { data: allLeads, isLoading, error } = useLeads();
  const { data: serviceAreas } = useServiceAreas();
  // Assigned website leads live under "Your Leads"; unassigned/public ones belong in Available Leads.
  const leads = allLeads?.filter((l) => !l.owner_contractor_id);
  const { data: paymentStatus, isLoading: loadingPayment } = usePaymentMethod();
  const { data: subscription } = useSubscription();
  const setupPaymentMutation = useSetupPaymentMethod();
  const _buyCredits = useBuyCredits();
  const addCreditsMutation = useAddCredits();
  const upgradeMutation = useUpgradeToPremium();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const isPremium = subscription?.tier === 'premium';
  const creditBalance = subscription?.credit_balance || 0;
  const discountNextLead = subscription?.discount_next_lead ?? false;

  const { data: rotationEntries } = useQuery({
    queryKey: ['premium-rotation', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('premium_rotation')
        .select('lead_id')
        .eq('contractor_id', user!.id);
      return new Set((data || []).map(r => r.lead_id));
    },
    enabled: !!user && isPremium,
  });

  useEffect(() => {
    const setup = searchParams.get('setup');
    const credits = searchParams.get('credits');

    if (setup === 'success') {
      toast.success('Payment method added successfully!');
      queryClient.invalidateQueries({ queryKey: ['payment-method'] });
      setSearchParams({});
    } else if (setup === 'cancelled') {
      toast.info('Payment setup cancelled');
      setSearchParams({});
    } else if (credits === 'success') {
      addCreditsMutation.mutate();
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      setSearchParams({});
    } else if (credits === 'cancelled') {
      toast.info('Credit purchase cancelled');
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, queryClient, addCreditsMutation]);

  const handleSetupPayment = () => setupPaymentMutation.mutate();
  const handleBuyCredits = (_leadId: string) => navigate('/dashboard/pricing');
  const _handleUpgradePremium = () => upgradeMutation.mutate();

  const hasPaymentMethod = paymentStatus?.has_payment_method ?? false;

  const safeMode = isAppStoreSafeMode();
  // Stripe cards, credits and upsells: never in the phone apps (iPhone and Android).
  const hideStripe = isNativeStoreBilling();
  const iap = canUseAppleIAP();
  const externalUnlock = isExternalUnlockAllowed();
  const { isCrew } = useIsCrewOnly();
  const showCommerceBanners = canShowCommerceUI() && !isCrew;

  return (
    <div className="p-4 sm:p-8">
      {/* Expiring Win-Back Credits Banner */}
      {!hideStripe && <ExpiringCreditsBanner />}

      {/* Streak & Status Widget */}
      <StreakStatusWidget />

      {/* Credit Wallet Banner */}
      {showCommerceBanners && creditBalance > 0 && (
        <div className="mb-6 p-3 rounded-lg border border-primary/30 bg-primary/10 flex items-center gap-3">
          <Wallet className="h-5 w-5 text-primary" />
          <p className="text-sm text-foreground">
            <span className="font-medium">Credit Balance: ${creditBalance.toFixed(2)}</span> —
            <span className="text-primary ml-1">Lead unlocks will be deducted from your credits</span>
          </p>
        </div>
      )}

      {/* Premium Upgrade Banner */}
      {showCommerceBanners && !isPremium && (
        <div className="mb-6 p-4 rounded-lg border border-primary/30 bg-primary/5 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <Crown className="h-5 w-5 text-primary flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Upgrade to Premium</p>
            <p className="text-sm text-muted-foreground">Get a 60-minute head start on new leads before anyone else sees them.</p>
          </div>
          <Button
            onClick={() => navigate('/dashboard/pricing')}
            className="gradient-primary"
          >
            <Crown className="mr-2 h-4 w-4" />
            View Plans
          </Button>
        </div>
      )}

      {/* Payment Method Status Banner — Stripe only */}
      {!hideStripe && !isCrew && !loadingPayment && !hasPaymentMethod && creditBalance === 0 && (
        <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-amber-800">Add a payment method</p>
            <p className="text-sm text-amber-700">Add your card once to purchase leads instantly with one click.</p>
          </div>
          <Button
            onClick={handleSetupPayment}
            disabled={setupPaymentMutation.isPending}
            className="gradient-primary"
          >
            {setupPaymentMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="mr-2 h-4 w-4" />
            )}
            Add Card
          </Button>
        </div>
      )}

      {/* Saved Card Indicator */}
      {!hideStripe && !isCrew && !loadingPayment && hasPaymentMethod && paymentStatus?.card && creditBalance === 0 && (
        <div className="mb-6 p-3 rounded-lg border border-primary/30 bg-primary/10 flex items-center gap-3">
          <CreditCard className="h-5 w-5 text-primary" />
          <p className="text-sm text-foreground">
            <span className="font-medium capitalize">{paymentStatus.card.brand}</span> ending in {paymentStatus.card.last4} •
            <span className="text-primary ml-1">Ready for instant purchases</span>
          </p>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-foreground">
          {safeMode && !iap ? 'Leads in Your Area' : 'Available Leads'}
        </h1>
        <p className="text-muted-foreground mt-1">
          {iap
            ? 'Unlock with credits or Apple In-App Purchase'
            : safeMode
              ? 'Tree care leads from your service areas'
              : 'Browse tree removal leads in your service areas'}
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <Skeleton className="aspect-video" />
              <CardHeader>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="p-8 text-center">
          <p className="text-destructive">Failed to load leads. Please try again.</p>
        </Card>
      ) : leads?.length === 0 ? (
        <Card className="p-8 text-center max-w-2xl mx-auto">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <SearchX className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl font-display font-bold text-foreground mb-2">
            What are Available Leads?
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Available Leads is a marketplace of real tree jobs from homeowners in your
            service areas. When a tree job comes in, it appears here with a photo, the
            job details, and an estimated value — you unlock it to get the customer's
            contact information and the full job details, and it moves to Your Leads.
          </p>
          <p className="text-sm font-medium text-foreground mb-1">
            We're not running lead generation in your local market yet.
          </p>
          {serviceAreas && serviceAreas.length > 0 && (
            <p className="text-sm text-muted-foreground mb-4">
              You're set up for:{' '}
              <span className="font-medium text-foreground">
                {serviceAreas.map((a) => a.city + (a.region ? `, ${a.region}` : '')).join(' • ')}
              </span>
            </p>
          )}
          <p className="text-sm text-muted-foreground mb-4">
            We're adding new markets all the time — check back soon. In the meantime,
            make sure your service areas cover everywhere you work.
          </p>
          <Button onClick={() => navigate('/dashboard/service-areas')} variant="outline">
            <MapPin className="mr-2 h-4 w-4" />
            Review my service areas
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {leads?.map((lead) =>
            externalUnlock ? (
              <IOSLeadPreviewCard key={lead.id} lead={lead} isPremium={isPremium} />
            ) : (
              <LeadCard
                key={lead.id}
                lead={lead}
                hasPaymentMethod={hasPaymentMethod}
                onSetupPayment={handleSetupPayment}
                isPremium={isPremium}
                creditBalance={creditBalance}
                onBuyCredits={handleBuyCredits}
                discountNextLead={discountNextLead}
                inRotation={rotationEntries?.has(lead.id!) ?? false}
              />
            ),
          )}
        </div>
      )}

      {/* Just Missed Section — hidden on iOS to avoid pricing/upsell */}
      {!hideStripe && <JustMissedSection />}
    </div>
  );
}
