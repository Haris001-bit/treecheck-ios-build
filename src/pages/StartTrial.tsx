import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import treecheckLogo from '@/assets/treecheck-logo-dark.png';
import { AppStoreSafeWall } from '@/components/AppStoreSafeWall';
import { canUseStorePlans, isStrictSafeMode, storeName } from '@/lib/platform';
import { useIapRestore } from '@/hooks/useRevenueCat';
import { reportSeriousError } from '@/lib/errorReporter';
import { CompanyCatalog } from '@/components/CompanyCatalog';
import { planPrice, type PlanChoice } from '@/lib/pricing/planChoice';
import { FreeVsTrial } from '@/components/free/FreeVsTrial';
import { useBillingRollout } from '@/hooks/useBillingRollout';
import { startCompanyCheckout } from '@/lib/billing/companyCheckout';
import { formatCents } from '@/lib/pricing/catalog';

/** Free is offered only to Oklahoma companies; the server checks the real state on the map before creating the account. */
const looksLikeOklahoma = (state: string) => /^(ok|okla|oklahoma)\.?$/i.test(state.trim());

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
  // Company plans (payments milestone): once billing_rollout opens them, the website signup picks a plan and the card
  // starts the 14-day trial in Stripe Checkout. Before that, and in the phone apps, signup keeps the no-card trial.
  const rollout = useBillingRollout();
  const plans = !store && !Capacitor.isNativePlatform() && rollout.data?.webLive === true;
  const newPricing = import.meta.env.DEV || plans || store;
  const [choice, setChoice] = useState<PlanChoice>({ ownerScout: true, interval: 'month' });
  const priceAfterTrial = `${formatCents(planPrice(choice))}/${choice.interval === 'year' ? 'year' : 'mo'}`;

  const onChange = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (store) {
        const { data, error } = await supabase.functions.invoke('create-ios-register', {
          body: { ...form, start_demo_iap: true },
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
      const { data, error } = await supabase.functions.invoke('create-trial-signup', { body: { ...form, ...(free ? { start: 'free' } : {}), ...(plans && !free ? { plan: choice } : import.meta.env.DEV && !free ? { pricing_version: '2026-10' } : {}) } });
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

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <img src={treecheckLogo} alt="TreeCheck" className="h-16 w-auto mx-auto mb-4" />
          <h1 className="text-3xl sm:text-4xl font-black mb-2">Start your 14-day free trial</h1>
          <p className="text-muted-foreground">Scout in the field. Approve from the office. Close more jobs.</p>
        </div>

        {!store && plans && <CompanyCatalog selected={choice} onSelect={setChoice} />}
        {!store && !plans && import.meta.env.DEV && <CompanyCatalog />}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>What's included</CardTitle>
              <CardDescription>Scout plan — owner account included</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                'Field rep captures tree photo + voice notes',
                'AI generates instant estimate (price, risk, difficulty)',
                'Private climber, stump grinder and crane offers',
                'Owner or office teammate chooses the customer quote',
                'Jobber quote handoff and job scheduling',
              ].map((f) => (
                <div key={f} className="flex gap-2"><Check className="h-4 w-4 text-primary mt-0.5 shrink-0" /><span>{f}</span></div>
              ))}
              <div className="border-t pt-3 mt-4 text-xs text-muted-foreground space-y-1">
                <p>
                  <strong>Free for 14 days.</strong>{' '}
                  {store
                    ? `You choose your plan next, in ${storeName()}. New subscribers get 14 days free, then the plan renews unless you cancel it in your subscription settings.`
                    : plans ? `Then ${priceAfterTrial} for the plan you chose above. Your card starts the trial, nothing is charged for 14 days, and if you cancel before day 15 you won't be charged.`
                    : import.meta.env.DEV ? 'Your trial includes one Scout license, assignable to you or another estimator. After the trial, choose Core + 1 Scout ($128/mo) or Core-only ($79/mo) at the prices above. No payment is taken during your trial.' : "Then $50/mo. Cancel before day 15 and you won't be charged."}
                </p>
                {!newPricing && <p>DMA, postcards, and the lead marketplace are not included on the demo plan.</p>}
                <p>{newPricing ? 'Two Field users are included with Core. Manager and Scout seats are assigned separately.' : 'Additional office teammates are $35/month each.'}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create your account</CardTitle>
              <CardDescription>
                {store
                  ? `You'll choose your plan in ${storeName()} next`
                  : 'Takes about a minute'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div><Label htmlFor="st-company">Company name</Label><Input id="st-company" autoComplete="organization" required value={form.company_name} onChange={onChange('company_name')} /></div>
                <div><Label htmlFor="st-name">Your name (owner)</Label><Input id="st-name" autoComplete="name" required value={form.full_name} onChange={onChange('full_name')} /></div>
                <div><Label htmlFor="st-email">Email</Label><Input id="st-email" type="email" autoComplete="email" required value={form.email} onChange={onChange('email')} /></div>
                <div><Label htmlFor="st-phone">Phone (optional)</Label><Input id="st-phone" type="tel" autoComplete="tel" value={form.phone} onChange={onChange('phone')} /></div>
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <div><Label htmlFor="st-city">Business city</Label><Input id="st-city" autoComplete="address-level2" value={form.city} onChange={onChange('city')} /></div>
                  <div><Label htmlFor="st-state">State</Label><Input id="st-state" autoComplete="address-level1" value={form.state} onChange={onChange('state')} placeholder="OK" maxLength={40} /></div>
                </div>
                <div><Label htmlFor="st-password">Password</Label><Input id="st-password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={onChange('password')} placeholder="At least 8 characters" /></div>
                <Button type="submit" className="w-full gradient-primary" disabled={loading} onClick={() => setStartFree(false)}>
                  {loading && !startFree ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {store ? 'Continue to choose your plan' : plans ? 'Continue to secure checkout' : 'Start my 14-day free trial'}
                </Button>
                {!store && looksLikeOklahoma(form.state) && (
                  <>
                    <Button type="submit" variant="outline" className="w-full" disabled={loading} onClick={() => setStartFree(true)}>
                      {loading && startFree ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Start free
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">Start free now and you can still start your 14-day trial later.</p>
                  </>
                )}
              </form>
              {store && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2"
                  disabled={iapRestore.isPending}
                  onClick={() => iapRestore.mutate()}
                >
                  Restore Purchases
                </Button>
              )}
              <p className="text-center text-sm text-muted-foreground mt-4">
                Already have an account?{' '}
                <Link to="/login" className="text-primary underline">Sign in</Link>
              </p>
            </CardContent>
          </Card>
        </div>
        {!store && looksLikeOklahoma(form.state) && (
          <section className="mt-6 space-y-3" aria-label="Free versus 14-day trial">
            <h2 className="text-xl font-black">Oklahoma tree companies can also start free</h2>
            <p className="text-sm text-muted-foreground">Here's the difference between the two:</p>
            <FreeVsTrial trialNote={plans ? `Your card starts the trial and nothing is charged for 14 days. Then ${priceAfterTrial}, or cancel before day 15 and stay on Free.` : import.meta.env.DEV ? 'No payment is taken during your trial. After 14 days, choose a plan or stay on Free.' : "Then $50/mo. Cancel before day 15 and you won't be charged; you'll stay on Free."} />
          </section>
        )}
      </div>
    </div>
  );
}
