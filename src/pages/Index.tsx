import { Link, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Building2, HardHat, ArrowRight, ShieldCheck } from 'lucide-react';
import treecheckLogo from '@/assets/treecheck-white-login.png';
import { useAuth } from '@/lib/auth';
import { isNativeStoreBilling, isStrictSafeMode } from '@/lib/platform';
import { plansOpenOnWeb, useBillingRollout } from '@/hooks/useBillingRollout';
import { planPrice } from '@/lib/pricing/planChoice';
import { formatCents } from '@/lib/pricing/catalog';

export default function Index() {
  const { user, loading } = useAuth();
  // The 2026-10 company plans (payments milestone): once billing_rollout opens them, the old $50 offer is gone.
  // Until the switch has loaded only "14 days free" shows, so the old price never flashes.
  const rollout = useBillingRollout();
  const plansOpen = plansOpenOnWeb(rollout.data);
  const core = formatCents(planPrice({ ownerScout: false, interval: 'month' }));
  const coreScout = formatCents(planPrice({ ownerScout: true, interval: 'month' }));
  if (loading) return <div className="min-h-screen bg-background" />;
  if (user) return <Navigate to="/dashboard" replace />;
  // The signup page is the first screen on the website and in the phone apps; it routes subcontractors to their own setup.
  // The strict App Store review mode has no signup, so it keeps the sign-in screen.
  if (isStrictSafeMode()) return <Navigate to="/login" replace />;
  if (isNativeStoreBilling() || !new URLSearchParams(window.location.search).has('choose')) return <Navigate to="/start-trial" replace />;
  return <main className="min-h-screen bg-background">
    <header className="max-w-6xl mx-auto px-5 py-5 flex items-center justify-between"><img src={treecheckLogo} alt="TreeCheck" className="h-10 w-auto"/><Button asChild variant="outline"><Link to="/login">Sign in</Link></Button></header>
    <section className="max-w-5xl mx-auto px-5 pt-12 pb-20 text-center"><h1 className="text-4xl sm:text-6xl font-black">TreeCheck</h1><p className="text-lg sm:text-xl text-muted-foreground mt-4 max-w-2xl mx-auto">Choose the experience built for how you work.</p>
      <div className="grid md:grid-cols-2 gap-5 mt-10 text-left">
        <Card className="p-6"><Building2 className="h-9 w-9 text-primary"/><h2 className="text-2xl font-black mt-4">I run a tree company</h2><p className="text-muted-foreground mt-2">Photo and price jobs with Scout, collect private subcontractor offers, choose the customer quote, and move approved work into Jobber.</p><div className="mt-4 font-bold">14 days free{rollout.isLoading ? '' : plansOpen ? `, then from ${core}/month` : ', then $50/month'}</div><div className="text-sm text-muted-foreground">{rollout.isLoading ? ' ' : plansOpen ? `Core is ${core}/month with two Field users included. Core + 1 Scout is ${coreScout}/month. Cancel anytime.` : 'Additional office teammates are $35/month each. Cancel anytime.'}</div><Button asChild className="w-full mt-6"><Link to="/start-trial">Start company trial <ArrowRight className="ml-2 h-4 w-4"/></Link></Button></Card>
        <Card className="p-6"><HardHat className="h-9 w-9 text-primary"/><h2 className="text-2xl font-black mt-4">I work as a subcontractor</h2><p className="text-muted-foreground mt-2">See relevant local jobs, Scout observations and city—never customer pricing or contact details. Send your private pay request and availability.</p><div className="mt-4 font-bold">Free to join</div><div className="text-sm text-muted-foreground">Subcontractors never pay a monthly fee.</div><Button asChild className="w-full mt-6"><Link to="/crew-join">Check my local network <ArrowRight className="ml-2 h-4 w-4"/></Link></Button></Card>
      </div><div className="flex justify-center gap-2 text-sm text-muted-foreground mt-8"><ShieldCheck className="h-5 w-5 text-primary"/>Secure billing. Cancel anytime. Private offers stay private.</div>
    </section>
  </main>;
}
