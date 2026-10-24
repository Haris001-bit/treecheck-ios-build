import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Loader2, CheckCircle2, Camera, Globe, Sparkles,
  Facebook, ArrowRight, ArrowLeft, ExternalLink, AlertCircle
} from 'lucide-react';
import googleReviewBadge from '@/assets/google-review-badge.png';
import fbIgBadge from '@/assets/fb-ig-badge.png';
import googleSearchBadge from '@/assets/google-search-badge.png';
import DMAJobSubmission from '@/components/DMAJobSubmission';
import DMAPublishedPosts from '@/components/DMAPublishedPosts';
import DMADemoPreview from '@/components/DMADemoPreview';
import DMANotConnected from '@/components/DMANotConnected';
import DMAEmailWorkspace from '@/components/DMAEmailWorkspace';
import DMASetupForm from '@/components/DMASetupForm';
import { useDMASetup } from '@/hooks/useDMASetup';

import {
  useDMASubscription,
  useCreateDMASubscription,
  useDMAIntegration,
  useUpsertDMAIntegration,
  useDMAReviewTemplate,
  useUpsertDMAReviewTemplate,
} from '@/hooks/useDMA';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { AppStoreSafeWall } from '@/components/AppStoreSafeWall';
import { canUseAppleIAP, isNativeStoreBilling, isStrictSafeMode } from '@/lib/platform';
import { useIapSubscribeDma, useIapRestore } from '@/hooks/useRevenueCat';

type SetupStep = 'landing' | 'billing' | 'meta' | 'google' | 'website' | 'review' | 'done';

export default function DMA() {
  if (isStrictSafeMode()) return <AppStoreSafeWall />;
  const iap = canUseAppleIAP();
  const { isAdmin } = useAuth();
  const marketingSetup = useDMASetup();
  const [editingMarketingSetup, setEditingMarketingSetup] = useState(false);
  const { data: subscription, isLoading: subLoading } = useDMASubscription();
  const { data: profile } = useProfile();
  const { data: integration, isLoading: integrationLoading } = useDMAIntegration();
  const { data: reviewTemplate } = useDMAReviewTemplate();
  const createSub = useCreateDMASubscription();
  const iapSubscribe = useIapSubscribeDma();
  const iapRestore = useIapRestore();
  const upsertIntegration = useUpsertDMAIntegration();
  const upsertTemplate = useUpsertDMAReviewTemplate();

  // Beta access: inherited from parent contractor for team members (resolved server-side in check-dma-subscription).
  // Falls back to own profile flag while subscription query is loading.
  const hasBetaAccess = subscription?.beta_enabled === true || profile?.dma_beta_enabled === true;
  const isDevPreview = hasBetaAccess || new URLSearchParams(window.location.search).get('preview') === '1';
  const isSubscribed = subscription?.subscribed === true || isDevPreview;

  // Determine initial step based on existing data
  const [step, setStep] = useState<SetupStep>('landing');
  const [templateText, setTemplateText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Once profile loads and dev preview is active, jump to the agent view
  useEffect(() => {
    if (isDevPreview && step === 'landing') {
      setStep('meta');
    }
  }, [isDevPreview]);

  // Initialize template text from saved data or default
  useEffect(() => {
    if (reviewTemplate?.template_text) {
      setTemplateText(reviewTemplate.template_text);
    } else {
      setTemplateText(
        'Hi {customer_name}, thanks for choosing {company_name}! If we earned it, would you leave us a quick Google review? {review_link} — {contractor_first_name}'
      );
    }
  }, [reviewTemplate]);

  // If subscribed and has completed setup, show dashboard
  const hasCompletedSetup = integration && (
    integration.facebook_page_id || integration.google_account_id
  );

  // The server matches the publisher's actual tenant configuration, not paid status or a URL.
  const isDMAConnected = marketingSetup.data?.connected === true;


  if (subLoading || integrationLoading || marketingSetup.isLoading) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (marketingSetup.error) return <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-4"><h1 className="text-2xl font-bold">Digital Marketing Agent</h1><p role="alert" className="text-destructive">{marketingSetup.error.message}</p><Button variant="outline" onClick={() => marketingSetup.refetch()}>Try again</Button></div>;

  if (editingMarketingSetup && marketingSetup.data) return <div className="p-4 sm:p-8 max-w-2xl mx-auto"><DMASetupForm status={marketingSetup.data} onDone={() => setEditingMarketingSetup(false)} /></div>;

  // --- NOT SET UP: promotional copy + free demo booking ---
  if (!isDMAConnected) {
    return (
      <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Digital Marketing Agent</h1>
          <p className="text-muted-foreground">Post a completed job — we handle the rest.</p>
        </div>
        <DMAEmailWorkspace />
      </div>
    );
  }



  // Show just the job submission form for quick preview
  if (isDevPreview && step === 'meta') {
    return (
      <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground mb-1">Digital Marketing Agent</h1>
          <p className="text-muted-foreground">Post a completed job — we handle the rest.</p>
        </div>
        <DMAJobSubmission />
        <DMAPublishedPosts />
        <Button variant="outline" onClick={() => setEditingMarketingSetup(true)}>Brand voice & marketing setup</Button>

      </div>
    );
  }

  // --- SUBSCRIBED DASHBOARD-LITE VIEW ---
  if (isSubscribed && (step === 'landing' || step === 'done') && hasCompletedSetup) {
    return <><div className="max-w-2xl mx-auto px-4 sm:px-8 pt-4"><Button variant="outline" onClick={() => setEditingMarketingSetup(true)}>Brand voice & marketing setup</Button></div><DMADashboard integration={integration} reviewTemplate={reviewTemplate} /></>;
  }

  // --- SETUP WIZARD STEPS ---
  if (isSubscribed && step !== 'landing') {
    return (
      <div className="p-4 sm:p-8 max-w-2xl mx-auto">
        {step === 'billing' && (
          <BillingStep
            subscription={subscription}
            createSub={createSub}
            iapSubscribe={iap ? iapSubscribe : null}
            iapRestore={iap ? iapRestore : null}
            onNext={() => setStep('meta')}
          />
        )}
        {step === 'meta' && (
          <MetaStep
            upsertIntegration={upsertIntegration}
            onNext={() => setStep('google')}
            onBack={() => setStep('billing')}
          />
        )}
        {step === 'google' && (
          <GoogleStep
            upsertIntegration={upsertIntegration}
            onNext={() => setStep('website')}
            onBack={() => setStep('meta')}
          />
        )}
        {step === 'website' && (
          <WebsiteStep
            upsertIntegration={upsertIntegration}
            onNext={() => setStep('review')}
            onBack={() => setStep('google')}
          />
        )}
        {step === 'review' && (
          <ReviewStep
            templateText={templateText}
            setTemplateText={setTemplateText}
            textareaRef={textareaRef}
            profile={profile}
            integration={integration}
            upsertTemplate={upsertTemplate}
            onNext={() => setStep('done')}
            onBack={() => setStep('website')}
          />
        )}
        {step === 'done' && (
          <DoneStep integration={integration} reviewTemplate={reviewTemplate} />
        )}
      </div>
    );
  }

  // --- DEMO PREVIEW (non-beta users) ---
  // Show the same agent UI beta users see, but interactions open a demo video.
  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground mb-1">Digital Marketing Agent</h1>
        <p className="text-muted-foreground">Post a completed job — we handle the rest.</p>
      </div>
      <DMADemoPreview />
    </div>
  );
}

// --- BILLING STEP ---
function BillingStep({
  subscription,
  createSub,
  iapSubscribe,
  iapRestore,
  onNext,
}: {
  subscription: any;
  createSub: any;
  iapSubscribe: any;
  iapRestore: any;
  onNext: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const useIap = !!iapSubscribe;

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      if (useIap) {
        await iapSubscribe.mutateAsync();
      } else {
        await createSub.mutateAsync();
      }
      onNext();
    } catch {
      setConfirming(false);
    }
  };

  const cardDisplay = subscription.card_brand && subscription.card_last4
    ? `${subscription.card_brand.charAt(0).toUpperCase() + subscription.card_brand.slice(1)} ending in ${subscription.card_last4}`
    : 'Card on file';

  return (
    <div className="space-y-6">
      <StepHeader step={1} total={5} title="Confirm billing" />
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <div className="p-2 rounded bg-primary/10">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{useIap ? 'Apple In-App Purchase' : cardDisplay}</p>
              <p className="text-sm text-muted-foreground">
                {useIap
                  ? 'Subscribe via the App Store (DMA monthly)'
                  : '$250/month, starting today'}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {useIap
              ? 'Payment is handled by Apple. You can manage or cancel in Settings → Subscriptions.'
              : "You'll be charged today and every month until you cancel."}
          </p>
          {(createSub.isError || iapSubscribe?.isError) && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                {iapSubscribe?.error?.message ||
                  createSub.error?.message ||
                  'Payment failed. Please try again.'}
              </span>
            </div>
          )}
          <Button
            onClick={handleConfirm}
            disabled={confirming}
            className="w-full gradient-primary"
          >
            {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {useIap ? 'Subscribe with Apple' : 'Confirm & Continue'}
          </Button>
          {useIap && iapRestore && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={iapRestore.isPending}
              onClick={() => iapRestore.mutate()}
            >
              Restore Purchases
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- META STEP (STUB) ---
function MetaStep({
  upsertIntegration,
  onNext,
  onBack,
}: {
  upsertIntegration: any;
  onNext: () => void;
  onBack: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    // STUB: Simulate OAuth — will be replaced when OAUTH_MODE=live
    await new Promise((r) => setTimeout(r, 1500));
    await upsertIntegration.mutateAsync({
      facebook_page_id: 'stub_page_id',
      facebook_page_name: 'My Tree Service',
      instagram_business_account_id: 'stub_ig_id',
      instagram_handle: '@mytreeservice',
    });
    setConnected(true);
    setConnecting(false);
  };

  return (
    <div className="space-y-6">
      <StepHeader step={2} total={5} title="Connect Facebook & Instagram" />
      <Card>
        <CardContent className="p-6 space-y-4">
          <p className="text-muted-foreground">
            Your Digital Marketing Agent needs permission to post to your Facebook business page and Instagram business account.
          </p>
          {!connected ? (
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full bg-[#1877F2] hover:bg-[#166FE5] text-white"
              size="lg"
            >
              {connecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Facebook className="mr-2 h-5 w-5" />
              )}
              Connect with Facebook
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Facebook page: My Tree Service</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Instagram: @mytreeservice</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <WizardNav onBack={onBack} onNext={onNext} canNext={connected} />
    </div>
  );
}

// --- GOOGLE STEP (STUB) ---
function GoogleStep({
  upsertIntegration,
  onNext,
  onBack,
}: {
  upsertIntegration: any;
  onNext: () => void;
  onBack: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    // STUB: Simulate Google OAuth
    await new Promise((r) => setTimeout(r, 1500));
    await upsertIntegration.mutateAsync({
      google_account_id: 'stub_account',
      google_location_id: 'stub_location',
      google_business_name: 'My Tree Service LLC',
      google_review_link: 'https://search.google.com/local/writereview?placeid=STUB_PLACE_ID',
    });
    setConnected(true);
    setConnecting(false);
  };

  return (
    <div className="space-y-6">
      <StepHeader step={3} total={5} title="Connect Google Business Profile" />
      <Card>
        <CardContent className="p-6 space-y-4">
          <p className="text-muted-foreground">
          Your Digital Marketing Agent uses this to send your customers review requests after every job.
          </p>
          {!connected ? (
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full bg-white hover:bg-gray-50 text-gray-700 border border-gray-300"
              size="lg"
            >
              {connecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              Connect with Google
            </Button>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span>My Tree Service LLC — review link ready</span>
            </div>
          )}
        </CardContent>
      </Card>
      <WizardNav onBack={onBack} onNext={onNext} canNext={connected} />
    </div>
  );
}

// --- WEBSITE STEP (STUB) ---
function WebsiteStep({
  upsertIntegration,
  onNext,
  onBack,
}: {
  upsertIntegration: any;
  onNext: () => void;
  onBack: () => void;
}) {
  // STUB: First Impression detection — always show upsell for now
  const hasFirstImpression = false;

  const handleSkip = async () => {
    await upsertIntegration.mutateAsync({ has_first_impression: false, website_url: null });
    onNext();
  };

  return (
    <div className="space-y-6">
      <StepHeader step={4} total={5} title="Website connection" />
      {hasFirstImpression ? (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span>Connected to yoursite.com</span>
            </div>
            <p className="text-sm text-muted-foreground">
              DMA will publish featured projects to your site automatically.
            </p>
            <Button onClick={onNext} className="w-full gradient-primary" size="lg">
              Continue <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-lg">Want your Digital Marketing Agent to post to your website too?</h3>
            <p className="text-muted-foreground text-sm">
              Your Digital Marketing Agent works best when it can publish featured project pages to your website. First Impression is our AI-powered website built for tree service contractors.
            </p>
            <Button
              variant="outline"
              className="w-full border-primary text-primary hover:bg-primary/5"
              size="lg"
              onClick={() => {
                // Placeholder for First Impression upsell flow
                window.open('https://treecheck.ai', '_blank');
              }}
            >
              <Globe className="mr-2 h-4 w-4" />
              Add First Impression — $199/mo
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={handleSkip}
            >
              Skip for now (social only)
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>
    </div>
  );
}

// --- REVIEW TEMPLATE STEP ---
function ReviewStep({
  templateText,
  setTemplateText,
  textareaRef,
  profile,
  integration,
  upsertTemplate,
  onNext,
  onBack,
}: {
  templateText: string;
  setTemplateText: (t: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  profile: any;
  integration: any;
  upsertTemplate: any;
  onNext: () => void;
  onBack: () => void;
}) {
  const mergeFields = [
    '{customer_name}',
    '{company_name}',
    '{review_link}',
    '{contractor_first_name}',
  ];

  const insertMergeField = (field: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newText = templateText.slice(0, start) + field + templateText.slice(end);
    setTemplateText(newText);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + field.length, start + field.length);
    });
  };

  const renderPreview = () => {
    const firstName = profile?.full_name?.split(' ')[0] || 'Mark';
    return templateText
      .replace(/\{customer_name\}/g, 'Sarah Miller')
      .replace(/\{company_name\}/g, profile?.company_name || 'Your Company')
      .replace(/\{review_link\}/g, integration?.google_review_link || 'https://g.co/review/...')
      .replace(/\{contractor_first_name\}/g, firstName);
  };

  const handleSaveAndContinue = async () => {
    await upsertTemplate.mutateAsync(templateText);
    onNext();
  };

  return (
    <div className="space-y-6">
      <StepHeader step={5} total={5} title="Your review request text" />
      <Card>
        <CardContent className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            We'll send this text to every customer 10 minutes after you mark a job complete.
          </p>
          <div>
            <Label htmlFor="review-template">Template</Label>
            <Textarea
              ref={textareaRef}
              id="review-template"
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              rows={4}
              className="mt-1"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {mergeFields.map((field) => (
              <button
                key={field}
                onClick={() => insertMergeField(field)}
                className="px-2 py-1 text-xs font-mono rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                {field}
              </button>
            ))}
          </div>
          <div className="p-4 rounded-lg bg-muted/50 border border-border">
            <Label className="text-xs text-muted-foreground mb-2 block">Preview</Label>
            <p className="text-sm">{renderPreview()}</p>
          </div>
        </CardContent>
      </Card>
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button
          onClick={handleSaveAndContinue}
          disabled={upsertTemplate.isPending}
          className="flex-1 gradient-primary"
        >
          {upsertTemplate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// --- DONE STEP ---
function DoneStep({
  integration,
  reviewTemplate,
}: {
  integration: any;
  reviewTemplate: any;
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="text-5xl mb-2">🎉</div>
      <h1 className="text-3xl font-display font-bold text-foreground">You're all set</h1>
      <p className="text-muted-foreground">
        Your Digital Marketing Agent is ready to go. The next time you finish a TreeCheck job, we'll walk you through posting it.
      </p>
      <Card>
        <CardContent className="p-6 space-y-3 text-left">
          <StatusRow
            label={`Facebook: ${integration?.facebook_page_name || 'Not connected'}`}
            connected={!!integration?.facebook_page_id}
          />
          <StatusRow
            label={`Instagram: ${integration?.instagram_handle || 'Skipped'}`}
            connected={!!integration?.instagram_business_account_id}
          />
          <StatusRow
            label={`Google Business: ${integration?.google_business_name || 'Not connected'}`}
            connected={!!integration?.google_account_id}
          />
          <StatusRow
            label={`Website: ${integration?.website_url || (integration?.has_first_impression ? 'Connected' : 'Skipped')}`}
            connected={!!integration?.has_first_impression}
          />
          <StatusRow
            label="Review template saved"
            connected={!!reviewTemplate?.template_text}
          />
        </CardContent>
      </Card>
      <Button
        onClick={() => window.location.href = '/dashboard'}
        className="gradient-primary"
        size="lg"
      >
        Back to TreeCheck
      </Button>
    </div>
  );
}

// --- SUBSCRIBED DASHBOARD-LITE VIEW ---
function DMADashboard({
  integration,
  reviewTemplate,
}: {
  integration: any;
  reviewTemplate: any;
}) {
  const upsertIntegration = useUpsertDMAIntegration();
  const [reviewLink, setReviewLink] = useState(integration?.google_review_link || '');
  const [savingLink, setSavingLink] = useState(false);
  useEffect(() => {
    setReviewLink(integration?.google_review_link || '');
  }, [integration?.google_review_link]);

  const saveReviewLink = async () => {
    setSavingLink(true);
    try {
      await upsertIntegration.mutateAsync({ google_review_link: reviewLink.trim() || null });
    } finally {
      setSavingLink(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Digital Marketing Agent</h1>
          <p className="text-sm text-muted-foreground mt-1">Your automated marketing is running</p>
        </div>
        <Badge className="bg-primary/10 text-primary border-0">
          <span className="inline-block h-2 w-2 rounded-full bg-primary mr-2 animate-pulse" />
          Active
        </Badge>
      </div>

      <DMAJobSubmission />

      <DMAPublishedPosts />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Connections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusRow
            label={`Facebook: ${integration?.facebook_page_name || 'Not connected'}`}
            connected={!!integration?.facebook_page_id}
          />
          <StatusRow
            label={`Instagram: ${integration?.instagram_handle || 'Not connected'}`}
            connected={!!integration?.instagram_business_account_id}
          />
          <StatusRow
            label={`Google Business: ${integration?.google_business_name || 'Not connected'}`}
            connected={!!integration?.google_account_id}
          />
          <StatusRow
            label={`Website: ${integration?.website_url || (integration?.has_first_impression ? 'Connected' : 'Not connected')}`}
            connected={!!integration?.has_first_impression}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Google Review Link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="google-review-link">
            Paste the URL customers use to leave you a Google review
          </Label>
          <input
            id="google-review-link"
            type="url"
            value={reviewLink}
            onChange={(e) => setReviewLink(e.target.value)}
            placeholder="https://g.page/r/..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Find it in your Google Business Profile → "Ask for reviews" → Share. This link is used by Closeout and the review request flow.
          </p>
          <Button
            onClick={saveReviewLink}
            disabled={savingLink || reviewLink === (integration?.google_review_link || '')}
            className="w-full"
          >
            {savingLink ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save review link
          </Button>
        </CardContent>
      </Card>

      {reviewTemplate?.template_text && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Review Template</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
              {reviewTemplate.template_text}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stripe's customer portal: never in the phone apps, where purchases go through Apple or Google (3.1.1). */}
      {!isNativeStoreBilling() && (
        <Button
          variant="outline"
          onClick={async () => {
            const { data, error } = await supabase.functions.invoke('customer-portal');
            if (!error && data?.url) window.location.href = data.url;
          }}
          className="w-full"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Manage subscription
        </Button>
      )}
    </div>
  );
}

// --- SHARED COMPONENTS ---
function StepHeader({ step, total, title }: { step: number; total: number; title: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-1">Step {step} of {total}</p>
      <h2 className="text-2xl font-display font-bold text-foreground">{title}</h2>
    </div>
  );
}

function StatusRow({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {connected ? (
        <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
      ) : (
        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
      )}
      <span className={connected ? '' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

function WizardNav({
  onBack,
  onNext,
  canNext,
}: {
  onBack: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  return (
    <div className="flex gap-3">
      <Button variant="outline" onClick={onBack} className="flex-1">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>
      <Button
        onClick={onNext}
        disabled={!canNext}
        className="flex-1 gradient-primary"
      >
        Continue <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
