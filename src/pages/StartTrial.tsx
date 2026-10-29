import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ACCOUNT_CONSENT_TEXT, CONSENT_VERSION, MARKETING_CONSENT_TEXT } from '@/lib/consent';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowLeft, Camera, Check, ChevronDown, ClipboardList, LineChart, Loader2, Megaphone } from 'lucide-react';
import { toast } from 'sonner';
import treecheckLogo from '@/assets/treecheck-white-login.png';
import { AppStoreSafeWall } from '@/components/AppStoreSafeWall';
import { canUseStorePlans, isAppStoreSafeMode, isStrictSafeMode, storeName } from '@/lib/platform';
import { useIapRestore } from '@/hooks/useRevenueCat';
import { reportSeriousError } from '@/lib/errorReporter';
import { CompanyCatalog, DEMO_URL, DmaAddOn, TeammatesInfo } from '@/components/CompanyCatalog';
import { planName, planPrice, type PlanChoice } from '@/lib/pricing/planChoice';
import { formatCents } from '@/lib/pricing/catalog';
import { FreeVsTrial } from '@/components/free/FreeVsTrial';
import { useBillingRollout } from '@/hooks/useBillingRollout';
import { startCompanyCheckout } from '@/lib/billing/companyCheckout';
import { GiveawayBanner } from '@/components/giveaway/GiveawayBanner';
import { GiveawayRulesLink } from '@/components/giveaway/GiveawayRulesLink';
import { giveawayOpen } from '@/lib/giveaway';

/** Free is offered only to Oklahoma companies; the server checks the real state on the map before creating the account. */
const looksLikeOklahoma = (state: string) => /^(ok|okla|oklahoma)\.?$/i.test(state.trim());

const OUTCOMES = [
  { icon: ClipboardList, title: 'Run the business.', text: 'Keep jobs, crews, subcontractors, and schedules organized.', names: 'Jobs · Subs' },
  { icon: Camera, title: 'Price the work.', text: 'Estimate from tree photos using AI that adapts to how your company prices jobs.', names: 'Scout' },
  { icon: LineChart, title: 'Know where your money stands.', text: "See whether this month is profitable and whether you're on track for payroll.", names: 'Pulse' },
  { icon: Megaphone, title: "Turn today's job into tomorrow's lead.", text: 'Turn job photos and a voice memo into content for your website.', names: 'Digital Marketing Agent' },
];

export default function StartTrial() {
  if (isStrictSafeMode()) {
    return (
      <AppStoreSafeWall
        title="Sign-up unavailable in the mobile app"
        body="Existing accounts can sign in from the login screen."
      />
    );
  }
  return <StartTrialForm />;
}

// Split from the safe-mode wall above so every hook runs on every render.
function StartTrialForm() {
  // The phone apps: the plan, and its free trial, are chosen in the App Store or Google Play after the account exists.
  const store = canUseStorePlans();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const iapRestore = useIapRestore();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    company_name: '',
    full_name: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    password: '',
  });
  const [startFree, setStartFree] = useState(false);
  // Account messages are required; marketing is optional and starts unchecked (it can't be a condition of signing up).
  const [accountOk, setAccountOk] = useState(false);
  const [marketingOk, setMarketingOk] = useState(false);
  const consent = { version: CONSENT_VERSION, account: accountOk, marketing: marketingOk };
  // Company plans (payments milestone): once billing_rollout opens them, the website signup picks a plan and the card
  // starts the 14-day trial in Stripe Checkout. Before that, and in the phone apps, signup keeps the no-card trial.
  const rollout = useBillingRollout();
  const plans = !store && !Capacitor.isNativePlatform() && rollout.data?.webLive === true;
  // The Ripsaw giveaway shows on the website and in the phone apps (from 1.4) while entries are open. In the apps the trial,
  // and so the entry, starts when the owner picks a plan in the App Store or Google Play (create-ios-register records it).
  const showGiveaway = giveawayOpen();
  const [choice, setChoice] = useState<PlanChoice>({ ownerScout: true, interval: 'month' });

  // Sell first, configure second: the overview explains TreeCheck; the signup steps open only when asked for.
  // This is also the app's first screen. In the phone apps the overview shows no prices (plans are chosen in the store).
  const [mode, setMode] = useState<'overview' | 'signup'>('overview');
  const iphone = isAppStoreSafeMode();
  const steps = store ? ['Account', 'Finish'] : plans ? ['Plan', 'Account', 'Trial'] : ['Account', 'Trial'];
  const [step, setStep] = useState(0);
  const last = steps.length - 1;
  const accountStep = plans ? 1 : 0;
  const accountRef = useRef<HTMLDivElement>(null);

  const openSignup = (at = 0) => {
    setMode('signup');
    setStep(at);
    window.scrollTo({ top: 0 });
  };
  const startWithPlan = (c: PlanChoice) => {
    setChoice(c);
    openSignup(accountStep);
  };

  // Mobile: a quiet sticky trial button appears once the hero's button scrolls away.
  const heroCtaRef = useRef<HTMLDivElement>(null);
  const [heroCtaVisible, setHeroCtaVisible] = useState(true);
  useEffect(() => {
    const el = heroCtaRef.current;
    if (mode !== 'overview' || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setHeroCtaVisible(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [mode]);

  const onChange = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  /** Checks the account fields before moving on; the browser shows its own message on the first missing one. */
  const accountValid = () => {
    const inputs = Array.from(accountRef.current?.querySelectorAll('input') ?? []);
    const bad = inputs.find((i) => !i.checkValidity());
    if (bad) { bad.reportValidity(); return false; }
    return true;
  };
  const next = () => {
    if (step === accountStep && !accountValid()) return;
    setStep((s) => Math.min(s + 1, last));
    window.scrollTo({ top: 0 });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter on an earlier step moves forward instead of signing up.
    if (step < last) { next(); return; }
    if (!accountValid()) { setStep(accountStep); return; }
    if (!accountOk) {
      toast.error('Check the box to agree to account messages about your trial and billing.');
      return;
    }
    setLoading(true);
    try {
      if (store) {
        const { data, error } = await supabase.functions.invoke('create-ios-register', {
          body: { ...form, consent, start_demo_iap: true },
        });
        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        const { error: signInError } = await signIn(form.email, form.password);
        if (signInError) throw signInError;

        // The plan, and its free trial, are chosen next in the App Store or Google Play (the phone plan screen).
        navigate('/plan', { replace: true });
        return;
      }

      const free = startFree && looksLikeOklahoma(form.state);
      const { data, error } = await supabase.functions.invoke('create-trial-signup', { body: { ...form, consent, ...(free ? { start: 'free' } : {}), ...(plans && !free ? { plan: choice } : import.meta.env.DEV && !free ? { pricing_version: '2026-10' } : {}) } });
      if (data?.fixable && data?.error) {
        toast.error(data.error);
        setLoading(false);
        return;
      }
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      // Free plan (Oklahoma): no card and no trial clock; they can start the trial later from inside the app.
      if (data?.free_started) {
        const { error: signInError } = await signIn(form.email, form.password);
        toast.success('Your free account is ready');
        navigate(signInError ? '/login' : '/dashboard/start');
        return;
      }
      // Company plan chosen: sign in, then the card goes into Stripe Checkout and starts the 14-day trial.
      if (data?.checkout_next) {
        const { error: signInError } = await signIn(form.email, form.password);
        if (signInError) {
          navigate('/login');
          return;
        }
        try {
          await startCompanyCheckout(choice, 'start');
        } catch (checkoutError) {
          toast.error(checkoutError instanceof Error ? checkoutError.message : 'Could not open checkout');
          navigate('/dashboard/plans');
        }
        return;
      }
      // No card step while payments aren't live: the trial has already started, so sign straight in.
      if (data?.trial_started) {
        const { error: signInError } = await signIn(form.email, form.password);
        toast.success('Your 14-day free trial has started');
        // New owners start with Scout: photograph a tree and price it.
        navigate(signInError ? '/login?trial=started' : '/dashboard/start');
        return;
      }
      if (!data?.url) throw new Error('Payment setup failed. Please try again.');
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url: data.url });
      } else {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast.error(err.message || 'Signup failed');
      reportSeriousError('company signup or payment setup', err, 'company signup', form.email);
      setLoading(false);
    }
  };

  const afterTrial = plans
    ? choice.interval === 'year' ? `${formatCents(planPrice(choice))}/year, billed annually` : `${formatCents(planPrice(choice))}/month`
    : null;
  const oklahoma = !store && looksLikeOklahoma(form.state);
  const signInLine = (
    <p className="text-center text-sm text-muted-foreground">
      Already have an account? <Link to="/login" className="font-semibold text-primary underline">Sign in</Link>
    </p>
  );

  if (mode === 'overview') {
    return (
      <div className="min-h-screen bg-background pb-24 sm:pb-12">
        {/* 1. Hero */}
        <header className="px-4 pt-10 pb-14 sm:pt-16 sm:pb-20 text-center">
          <div className="mx-auto max-w-2xl">
            <img src={treecheckLogo} alt="TreeCheck" className="h-12 sm:h-14 w-auto mx-auto mb-8" />
            <h1 className="font-display font-black uppercase text-5xl sm:text-7xl leading-[0.9] tracking-tight mb-5">Get your<br />time back.</h1>
            <p className="text-lg text-foreground">Less time in your truck. Less time on your computer. More time back for your life.</p>
            <p className="mt-3 text-muted-foreground">Built for tree companies to estimate work, manage crews, understand profitability, and keep marketing moving.</p>
            <div ref={heroCtaRef} className="mt-8 flex flex-col items-center gap-2">
              <Button size="lg" className="gradient-primary h-12 w-full max-w-sm text-base" onClick={() => openSignup(0)}>
                Start my free 14-day trial
              </Button>
              <p className="text-sm font-medium">Free for 14 days. No charge today.</p>
            </div>
            {/* Subcontractors leave here for their own (free) setup; everyone else stays on the owner page.
                iPhone keeps subs on owner invites (App Store rule in AGENTS.md). */}
            <div className="mt-6">
              {iphone ? (
                <p className="text-sm text-muted-foreground">Subcontractor? Ask the company you work with to send you an invite.</p>
              ) : (
                <Button asChild variant="outline" className="h-11 w-full max-w-sm">
                  <Link to="/crew-join">Want to be included in our subcontractor directory?</Link>
                </Button>
              )}
              {!iphone && <p className="mt-2 text-sm text-muted-foreground">Joining the subcontractor directory is always free.</p>}
            </div>
            <div className="mt-5">{signInLine}</div>
          </div>
        </header>

        <main className="px-4">
          <div className="mx-auto max-w-5xl space-y-16 sm:space-y-20">
            {/* 2. Outcomes first, product names second */}
            <section aria-labelledby="outcomes-heading">
              <h2 id="outcomes-heading" className="text-2xl font-bold text-center mb-8">What TreeCheck does for your company</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {OUTCOMES.map(({ icon: Icon, title, text, names }) => (
                  <div key={title} className="rounded-xl border border-border bg-card p-5 sm:p-6">
                    <Icon className="h-6 w-6 text-primary mb-3" aria-hidden />
                    <h3 className="text-lg font-bold">{title}</h3>
                    <p className="mt-1 text-muted-foreground">{text}</p>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-primary">{names}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. Plans */}
            {plans && <CompanyCatalog selected={choice} onSelect={setChoice} onStart={startWithPlan} addOns={false} />}
            {!plans && import.meta.env.DEV && <CompanyCatalog onStart={() => openSignup(0)} addOns={false} />}

            {/* 4. Giveaway, after TreeCheck is explained */}
            {showGiveaway && <GiveawayBanner onCta={() => openSignup(0)} />}

            {/* 5. Optional website marketing, after the plans */}
            {(plans || import.meta.env.DEV) && (
              <div className="space-y-4">
                <DmaAddOn interval={choice.interval} />
                <TeammatesInfo interval={choice.interval} />
              </div>
            )}

            {/* Closing CTA; the demo stays secondary */}
            <section className="text-center space-y-3 pb-4">
              <h2 className="text-2xl font-bold">Ready to get your time back?</h2>
              <Button size="lg" className="gradient-primary h-12 w-full max-w-sm text-base" onClick={() => openSignup(0)}>
                Start my free 14-day trial
              </Button>
              <p className="text-sm text-muted-foreground">
                Not ready to start?{' '}
                <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">Schedule a demo</a>
              </p>
            </section>
          </div>
        </main>

        {/* Mobile sticky trial button, shown after the hero button scrolls away */}
        {!heroCtaVisible && (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 p-3 backdrop-blur sm:hidden">
            <Button className="gradient-primary h-12 w-full text-base" onClick={() => openSignup(0)}>Start free trial</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center justify-between gap-3">
          <button type="button" onClick={() => (step > 0 ? setStep(step - 1) : setMode('overview'))} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
          <img src={treecheckLogo} alt="TreeCheck" className="h-8 w-auto" />
          <span className="w-12" />
        </div>

        {/* Progress */}
        <ol className="mb-8 flex items-center justify-center gap-2 text-sm" aria-label="Signup progress">
          {steps.map((label, i) => (
            <li key={label} className="flex items-center gap-2" aria-current={i === step ? 'step' : undefined}>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${i < step ? 'bg-primary text-primary-foreground' : i === step ? 'border-2 border-primary text-primary' : 'border border-border text-muted-foreground'}`}>
                {i < step ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
              </span>
              <span className={i === step ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
              {i < last && <span className="mx-1 h-px w-5 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Step: Plan */}
          {plans && (
            <section hidden={step !== 0} className="space-y-4" aria-labelledby="step-plan">
              <h1 id="step-plan" className="text-2xl font-bold">Choose your plan</h1>
              <div className="flex gap-1" role="group" aria-label="Billing frequency">
                <Button type="button" variant={choice.interval === 'month' ? 'default' : 'outline'} size="sm" aria-pressed={choice.interval === 'month'} onClick={() => setChoice({ ...choice, interval: 'month' })}>Monthly</Button>
                <Button type="button" variant={choice.interval === 'year' ? 'default' : 'outline'} size="sm" aria-pressed={choice.interval === 'year'} onClick={() => setChoice({ ...choice, interval: 'year' })}>Annual</Button>
              </div>
              <div role="radiogroup" aria-label="Plan" className="space-y-3">
                {[true, false].map((ownerScout) => {
                  const c = { ownerScout, interval: choice.interval };
                  const picked = choice.ownerScout === ownerScout;
                  return (
                    <button
                      key={String(ownerScout)}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      onClick={() => setChoice(c)}
                      className={`flex w-full items-start gap-3 rounded-xl p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${picked ? 'border-2 border-primary' : 'border border-border hover:border-primary/60'}`}
                    >
                      <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${picked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'}`}>
                        {picked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-bold">{planName(c)}{ownerScout && <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-primary">Recommended</span>}</span>
                          <span className="font-bold">{formatCents(planPrice(c))}/{c.interval === 'year' ? 'year' : 'month'}</span>
                        </span>
                        <span className="block text-sm text-muted-foreground">{ownerScout ? 'Run the business + price the work.' : 'Keep your jobs moving and your numbers in view.'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                <span className="font-semibold text-foreground">{planName(choice)} · {choice.interval === 'year' ? 'Annual' : 'Monthly'}.</span> Free for 14 days, then {afterTrial}.
              </p>
              <Button type="button" size="lg" className="gradient-primary h-12 w-full text-base" onClick={next}>Continue</Button>
            </section>
          )}

          {/* Step: Account */}
          <section hidden={step !== accountStep} aria-labelledby="step-account">
            <div ref={accountRef} className="space-y-4">
              <div>
                <h1 id="step-account" className="text-2xl font-bold">Create your account</h1>
                <p className="text-sm text-muted-foreground">{store ? `You'll choose your plan in ${storeName()} next.` : 'Takes about a minute.'}</p>
              </div>
              <div><Label htmlFor="st-company">Company name</Label><Input id="st-company" className="h-11" autoComplete="organization" required value={form.company_name} onChange={onChange('company_name')} /></div>
              <div><Label htmlFor="st-name">Your name (owner)</Label><Input id="st-name" className="h-11" autoComplete="name" required value={form.full_name} onChange={onChange('full_name')} /></div>
              <div><Label htmlFor="st-email">Email</Label><Input id="st-email" className="h-11" type="email" inputMode="email" autoComplete="email" required value={form.email} onChange={onChange('email')} /></div>
              <div><Label htmlFor="st-phone">Phone <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="st-phone" className="h-11" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={onChange('phone')} /></div>
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <div><Label htmlFor="st-city">Business city</Label><Input id="st-city" className="h-11" autoComplete="address-level2" value={form.city} onChange={onChange('city')} /></div>
                <div><Label htmlFor="st-state">State</Label><Input id="st-state" className="h-11" autoComplete="address-level1" value={form.state} onChange={onChange('state')} placeholder="OK" maxLength={40} /></div>
              </div>
              <div><Label htmlFor="st-password">Password</Label><Input id="st-password" className="h-11" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={onChange('password')} placeholder="At least 8 characters" /></div>
              <Button type="button" size="lg" className="gradient-primary h-12 w-full text-base" onClick={next}>Continue</Button>
            </div>
          </section>

          {/* Step: Trial (or Finish in the phone apps) */}
          <section hidden={step !== last} className="space-y-5" aria-labelledby="step-trial">
            <h1 id="step-trial" className="text-2xl font-bold">{store ? 'Finish creating your account' : 'Start your free trial'}</h1>

            {/* The trial summary reads the same plan choice that checkout charges, so the two can't disagree. */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-2" aria-live="polite" data-testid="trial-summary">
              {store ? (
                <p className="text-sm"><strong>Free for 14 days.</strong> You choose your plan next, in {storeName()}. New subscribers get 14 days free, then the plan renews unless you cancel it in your subscription settings.</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-bold">Today</span>
                    <span className="text-3xl font-black">$0</span>
                  </div>
                  <p className="font-semibold">14-day free trial{plans && <span className="font-normal text-muted-foreground"> · {planName(choice)}, {choice.interval === 'year' ? 'Annual' : 'Monthly'}</span>}</p>
                  {plans ? (
                    <>
                      <p className="text-lg"><span className="font-semibold">After your trial:</span> {afterTrial}</p>
                      <p className="text-sm text-muted-foreground">Card required. No charge during the 14-day trial. Subscription begins after the trial unless canceled.</p>
                    </>
                  ) : import.meta.env.DEV ? (
                    <p className="text-sm text-muted-foreground">Your trial includes one Scout license, assignable to you or another estimator. After the trial, choose Core + Scout ($128/month) or Core ($79/month). No payment is taken during your trial.</p>
                  ) : (
                    <>
                      <p className="text-lg"><span className="font-semibold">After your trial:</span> $50/month</p>
                      <p className="text-sm text-muted-foreground">Cancel before day 15 and you won't be charged. DMA, postcards, and the lead marketplace are not included on the demo plan. Additional office teammates are $35/month each.</p>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Two separate consents: account messages required, marketing optional and unchecked. */}
            <fieldset className="space-y-3 text-xs leading-relaxed">
              <legend className="sr-only">Communication permissions</legend>
              <div className="flex items-start gap-2">
                <Checkbox id="st-consent-account" checked={accountOk} onCheckedChange={(v) => setAccountOk(v === true)} className="mt-0.5" aria-required="true" />
                <label htmlFor="st-consent-account" className="text-muted-foreground cursor-pointer">
                  <span className="text-foreground font-medium">Required.</span> {ACCOUNT_CONSENT_TEXT}
                </label>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id="st-consent-marketing" checked={marketingOk} onCheckedChange={(v) => setMarketingOk(v === true)} className="mt-0.5" />
                <label htmlFor="st-consent-marketing" className="text-muted-foreground cursor-pointer">
                  <span className="text-foreground font-medium">Optional.</span> {MARKETING_CONSENT_TEXT}
                </label>
              </div>
              <p className="text-muted-foreground">
                See our <Link to="/privacy" className="text-primary underline">Privacy Policy</Link> and <Link to="/terms" className="text-primary underline">Terms</Link>
                {showGiveaway && <> · Giveaway <GiveawayRulesLink className="text-primary underline">Official Rules</GiveawayRulesLink></>}.
              </p>
            </fieldset>

            <Button type="submit" size="lg" className="gradient-primary h-12 w-full text-base" disabled={loading} onClick={() => setStartFree(false)}>
              {loading && !startFree ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {store ? 'Continue to choose your plan' : 'Start my 14-day free trial'}
            </Button>

            {oklahoma && (
              <div className="space-y-2">
                <Button type="submit" variant="outline" className="h-11 w-full" disabled={loading} onClick={() => setStartFree(true)}>
                  {loading && startFree ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Start free instead
                </Button>
                <p className="text-xs text-muted-foreground text-center">Oklahoma tree companies can start free and still start the 14-day trial later.</p>
                <Collapsible className="rounded-lg border border-border">
                  <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
                    Compare Free and the 14-day trial
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-4 pb-4">
                    <FreeVsTrial trialNote={plans ? `Your card starts the trial and nothing is charged for 14 days. Then ${afterTrial}. Or cancel before day 15 and stay on Free.` : import.meta.env.DEV ? 'No payment is taken during your trial. After 14 days, choose a plan or stay on Free.' : "Then $50/mo. Cancel before day 15 and you won't be charged; you'll stay on Free."} />
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
          </section>
        </form>

        <div className="mt-6 space-y-2">
          {store && (
            <Button type="button" variant="ghost" size="sm" className="w-full" disabled={iapRestore.isPending} onClick={() => iapRestore.mutate()}>
              Restore Purchases
            </Button>
          )}
          {signInLine}
        </div>
      </div>
    </div>
  );
}
