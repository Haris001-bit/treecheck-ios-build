// Starts the one 14-day company trial for a signed-in owner who hasn't had one (Free owners mostly). Until the company
// plans open (billing_rollout, payments milestone) the trial starts here with no card, exactly like signup does. Once
// they're open on a live key, the website answers { plan_picker: true }: the owner chooses a plan and the 14 days run
// in Stripe Checkout with the card (company-billing). The phone apps keep the no-card trial. A trial never restarts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { trialTakesCard, TRIAL_DAYS_WITHOUT_CARD } from '../_shared/stripeMode.ts';
import { billingRollout, plansOpenFor } from '../_shared/billingRollout.ts';
import { fromNativeApp } from '../_shared/nativeClient.ts';
import { companyPlan, companyTrialUsed } from '../_shared/freePlan.ts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const header = req.headers.get('Authorization');
    const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!header || !url || !key) return json({ error: 'Please sign in again.' }, 401);
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data: auth } = await db.auth.getUser(header.replace(/^Bearer\s+/i, ''));
    if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: me } = await db.from('profiles').select('id, account_type, parent_contractor_id').eq('id', auth.user.id).maybeSingle();
    // Subcontractors never pay and never start a trial; team members can't start one for the company.
    if (!me || me.account_type !== 'company' || me.parent_contractor_id) return json({ error: 'Only the company owner can start the trial.' }, 403);
    const owner = me.id;
    const plan = await companyPlan(db, owner);
    if (plan === 'trialing' || plan === 'paid') return json({ error: 'Your company already has full access.' }, 409);
    if (await companyTrialUsed(db, owner)) return json({ error: 'Your company has already used its 14-day trial. Upgrade to keep full access.', code: 'trial_used' }, 409);
    if (!fromNativeApp(req) && trialTakesCard(Deno.env.get('STRIPE_SECRET_KEY'), plansOpenFor(await billingRollout(db), owner))) return json({ plan_picker: true });

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS_WITHOUT_CARD * 86_400_000).toISOString();
    const { data: billing } = await db.from('company_billing').select('pricing_version').eq('owner_id', owner).maybeSingle();
    if (billing?.pricing_version === '2026-10') {
      const { error } = await db.from('company_billing').update({ status: 'trialing', trial_ends_at: trialEndsAt, updated_at: new Date().toISOString() }).eq('owner_id', owner);
      if (error) throw error;
    }
    const { error } = await db.from('profiles').update({ subscription_tier: 'demo_trial', trial_ends_at: trialEndsAt }).eq('id', owner);
    if (error) throw error;
    return json({ trial_started: true, trial_ends_at: trialEndsAt });
  } catch (error) {
    console.error('company-start-trial failed', error instanceof Error ? error.message : error);
    return json({ error: 'Could not start your trial. Please try again.' }, 500);
  }
});
