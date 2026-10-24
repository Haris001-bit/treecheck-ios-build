import Stripe from 'https://esm.sh/stripe@18.5.0?target=deno';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { quote, NO_PERMISSIONS } from '../_shared/companyCatalog.ts';
import { companyPriceIds } from '../_shared/companyPriceIds.ts';
import { checkoutTrialEnd, validateAssignment, availableCapacity, captureSlotsRemaining } from '../_shared/companyLifecycle.ts';
import { reconcileCompany } from '../_shared/companyReconcile.ts';
import { fromNativeApp, NATIVE_PURCHASE_REFUSAL } from '../_shared/nativeClient.ts';
import { stripeTakesRealCards, TRIAL_DAYS_WITHOUT_CARD } from '../_shared/stripeMode.ts';
import { billingRollout, plansOpenFor } from '../_shared/billingRollout.ts';
import { openCompanyPlan } from '../_shared/companyPlanOpen.ts';
import { LEGACY_DEMO_PRODUCT, planRunning } from '../_shared/storePlans.ts';
import { storePlanBlocker } from '../_shared/storePlanBlocker.ts';

const TIMBER_OWNER = '705cecc2-5926-48c1-a728-b3ebd6b920a2';
const PORTAL_TAG = 'treecheck-company-v1';
const APP = 'https://app.treecheck.ai';
const RETURN_PATHS = { team: '/dashboard/team', start: '/dashboard/start', plans: '/dashboard/plans', profile: '/dashboard/profile' } as const;

const permissions = z.object(Object.fromEntries(Object.keys(NO_PERMISSIONS).map(k => [k, z.boolean()]))).strict();
const bodySchema = z.object({
  action: z.enum(['status', 'checkout', 'portal', 'preview', 'confirm_purchase', 'save_access', 'remove', 'schedule_renewal', 'cancel_renewal', 'cancel_subscription']),
  returnTo: z.enum(['team', 'start', 'plans', 'profile']).optional(),
  interval: z.enum(['month', 'year']).optional(), ownerScout: z.boolean().optional(), dma: z.boolean().optional(),
  memberId: z.string().uuid().optional(), email: z.string().email().optional(),
  seat: z.enum(['scout', 'manager', 'field']).nullable().optional(),
  kind: z.enum(['employee', 'capture', 'subcontractor']).optional(), permissions: permissions.optional(),
  requestKey: z.string().uuid().optional(),
  changeId: z.string().uuid().optional(),
  capacity: z.object({ scout: z.number().int().min(0).max(500), manager: z.number().int().min(0).max(500), field: z.number().int().min(2).max(500) }).optional(),
  storeCheck: z.boolean().optional(),
}).strict();
// What a phone plan (App Store or Google Play) still does here: seat assignment within what it includes.
const STORE_PLAN_ACTIONS = new Set(['status', 'preview', 'save_access', 'remove']);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// The card-update portal (payments milestone): update card, invoices and cancel at period end only, so seat and plan
// changes stay in this function. Created on first use and found again by its metadata.
async function portalConfiguration(stripe: Stripe): Promise<string> {
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const found = existing.data.find((c: Stripe.BillingPortal.Configuration) => c.metadata?.treecheck === PORTAL_TAG);
  if (found) return found.id;
  const created = await stripe.billingPortal.configurations.create({
    name: 'TreeCheck company plans',
    business_profile: { headline: 'TreeCheck billing' },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
      customer_update: { enabled: false },
    },
    metadata: { treecheck: PORTAL_TAG },
  }, { idempotencyKey: PORTAL_TAG });
  return created.id;
}

// An owner leaving the no-card trial (or a free owner choosing a plan) moves to the 2026-10 plans only when they
// choose to pay, never in bulk: the move switches on the new permission rules for the whole company. Paid, protected,
// Apple and team companies stay where they are. Null when the move is done.
// deno-lint-ignore no-explicit-any
async function convertToPlans(admin: any, owner: string, profile: any, env: 'live' | 'sandbox', body: { ownerScout?: boolean; interval?: 'month' | 'year' }): Promise<string | null> {
  if (!plansOpenFor(await billingRollout(admin), owner)) return 'The new TreeCheck plans open for payment in the next few days.';
  if (owner === TIMBER_OWNER || profile.is_founder || profile.stripe_subscription_id || !['free', 'demo_trial', null].includes(profile.subscription_tier ?? null)) return 'Your existing agreement is protected. New-price billing changes are not enabled for this account.';
  const [{ count: paid }, { count: apple }, { count: team }] = await Promise.all([
    admin.from('product_entitlements').select('contractor_id', { count: 'exact', head: true }).eq('contractor_id', owner).in('status', ['active', 'trialing', 'past_due']),
    admin.from('iap_events').select('id', { count: 'exact', head: true }).eq('contractor_id', owner),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('parent_contractor_id', owner),
  ]);
  if (paid) return 'Your existing agreement is protected. New-price billing changes are not enabled for this account.';
  if (apple) return 'This account subscribes through the App Store. Manage it in the iPhone app.';
  // Converting would cut off teammates who have no team_member_access row yet; those companies are moved by hand.
  if (team) return 'Contact us to move your team to the new plans.';
  const { data: trialUsed, error } = await admin.rpc('company_trial_used', { p_owner: owner });
  if (error) throw error;
  const running = profile.trial_ends_at && Date.parse(profile.trial_ends_at) > Date.now();
  return openCompanyPlan(admin, owner, {
    env, ownerScout: body.ownerScout ?? true, interval: body.interval ?? 'month',
    // A no-card trial keeps its access and end date; an owner who never had a trial gets 14 days with the card.
    status: running ? 'trialing' : 'incomplete',
    trialEndsAt: running ? profile.trial_ends_at : trialUsed ? null : new Date(Date.now() + TRIAL_DAYS_WITHOUT_CARD * 86_400_000).toISOString(),
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let admin: ReturnType<typeof createClient> | undefined;
  let owner: string | undefined;
  let lock: string | undefined;
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Sign in first.' }, 401);
    admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Sign in first.' }, 401);
    const user = auth.user;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: 'Invalid billing request.' }, 400);
    const body = parsed.data;
    // Checkout, paid upgrades and the Stripe billing portal are not for the phone apps (_shared/nativeClient.ts).
    if ((body.action === 'checkout' || body.action === 'confirm_purchase' || body.action === 'portal') && fromNativeApp(req)) return json({ error: NATIVE_PURCHASE_REFUSAL }, 409);
    const { data: profile, error: profileError } = await admin.from('profiles').select('id,parent_contractor_id,account_type,is_sandbox,is_founder,trial_ends_at,subscription_tier,stripe_subscription_id').eq('id', user.id).single();
    if (profileError || !profile || profile.parent_contractor_id || profile.account_type !== 'company') return json({ error: 'Only the company owner controls billing and team access.' }, 403);
    owner = user.id;
    // The key's mode decides everything: live rows and live prices on a live key, sandbox ones on a test key.
    const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    const live = stripeTakesRealCards(key);
    const env = live ? 'live' : 'sandbox';
    const PRICE_IDS = companyPriceIds(live);
    let { data: billing, error: billingError } = await admin.from('company_billing').select('*').eq('owner_id', owner).maybeSingle();
    if (billingError) throw billingError;
    if (body.action === 'status') {
      // Only a website plan is reconciled with Stripe; a phone plan's row is written by revenuecat-webhook.
      if (billing?.pricing_version === '2026-10' && billing.provider === 'stripe' && billing.environment === env) {
        if (key) {
          const stripe = new Stripe(key, { apiVersion: '2025-08-27.basil' });
          if (billing.stripe_subscription_id) await reconcileCompany(admin, stripe, owner, billing.stripe_subscription_id);
          else {
            const { data: checkouts } = await admin.from('company_billing_changes').select('preview').eq('owner_id', owner).eq('action', 'checkout').order('created_at', { ascending: false }).limit(5);
            for (const c of checkouts ?? []) {
              const sessionId = c.preview?.sessionId;
              if (!sessionId) continue;
              const session = await stripe.checkout.sessions.retrieve(sessionId);
              if (session.status === 'complete' && typeof session.subscription === 'string') {
                await reconcileCompany(admin, stripe, owner, session.subscription);
                break;
              }
            }
          }
          const { data: fresh } = await admin.from('company_billing').select('*').eq('owner_id', owner).single();
          if (fresh) Object.assign(billing, fresh);
        }
      }
      const { data: members, error } = await admin.from('team_member_access').select('*').eq('owner_id', owner).neq('status', 'removed');
      if (error) throw error;
      const onPlans = billing?.pricing_version === '2026-10';
      // The phone plan screen asks whether a company not on the plans yet may take one (_shared/storePlanBlocker.ts).
      const storeBlocker = body.storeCheck && !onPlans ? await storePlanBlocker(admin, owner) : null;
      // A trial of the old $50 iPhone plan converts in the App Store, so the website shows it no trial banner.
      let appleTrial = false;
      if (!onPlans && profile.subscription_tier === 'demo_trial') {
        const { count, error: iapError } = await admin.from('iap_events').select('id', { count: 'exact', head: true }).eq('contractor_id', owner).eq('product_id', LEGACY_DEMO_PRODUCT);
        if (iapError) throw iapError;
        appleTrial = !!count;
      }
      return json({ billing: billing ?? { pricing_version: 'legacy' }, members: members ?? [], ...(body.storeCheck ? { storeBlocker } : {}), ...(appleTrial ? { appleTrial } : {}) });
    }
    // Choosing a plan moves a no-card trial (or free) owner onto the 2026-10 plans first, when they're eligible.
    if (body.action === 'checkout' && !profile.is_sandbox && (!billing || billing.pricing_version !== '2026-10')) {
      const refusal = await convertToPlans(admin, owner, profile, env, body);
      if (refusal) return json({ error: refusal }, 409);
      ({ data: billing, error: billingError } = await admin.from('company_billing').select('*').eq('owner_id', owner).single());
      if (billingError) throw billingError;
    }
    if (!billing || billing.pricing_version !== '2026-10') return json({ error: 'Your existing agreement is protected. New-price billing changes are not enabled for this account.' }, 409);
    // A phone plan is billed by its store: nothing here charges, cancels or opens a card portal for it, while the seats
    // it includes can still be assigned. Once it has ended, the website checkout takes the company over.
    let store: string | null = billing.provider;
    if (store === 'stripe') store = null;
    if (store) {
      if (body.action === 'checkout' && !planRunning(billing, Date.now())) {
        const { error } = await admin.from('company_billing').update({ provider: 'stripe', environment: env, pending_renewal: null, updated_at: new Date().toISOString() }).eq('owner_id', owner).eq('provider', store);
        if (error) throw error;
        Object.assign(billing, { provider: 'stripe', environment: env, pending_renewal: null });
        store = null;
      } else if (!STORE_PLAN_ACTIONS.has(body.action)) {
        return json({ error: `Your plan is billed through ${store === 'play_store' ? 'Google Play' : 'the App Store'}. Manage it in your phone's subscription settings.` }, 409);
      }
    }
    if (!store) {
      // A row set up under the other Stripe mode (Lovable preview test signups) is never charged on this key.
      if (!key || billing.environment !== env) return json({ error: 'Billing for this company is set up in a different mode. Contact us.' }, 409);
    }
    if (profile.is_sandbox) return json({ error: 'Signup demonstration accounts cannot make purchases or invite real people.' }, 403);
    if (body.action === 'portal') {
      if (!billing.stripe_customer_id) return json({ error: 'Your company has no card on file yet. Choose a plan first.' }, 409);
      const portalStripe = new Stripe(key, { apiVersion: '2025-08-27.basil' });
      const session = await portalStripe.billingPortal.sessions.create({
        customer: billing.stripe_customer_id, configuration: await portalConfiguration(portalStripe),
        return_url: `${APP}${RETURN_PATHS[body.returnTo ?? 'team']}`,
      });
      return json({ url: session.url });
    }
    lock = crypto.randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc('company_billing_claim', { p_owner: owner, p_token: lock });
    if (claimError) throw claimError;
    if (!claimed) return json({ error: 'Another team change is in progress. Try again shortly.' }, 409);
    const stripe = new Stripe(key, { apiVersion: '2025-08-27.basil' });
    const interval = billing.billing_interval === 'year' ? 'year' : 'month';
    const capacity = billing.capacity as { scout: number; manager: number; field: number; ownerScout?: boolean };
    const plan = { ownerScout: !!capacity.ownerScout, scoutSeats: capacity.scout, managerSeats: capacity.manager, fieldUsers: capacity.field, dma: billing.dma_source === 'paid' ? 'paid' as const : billing.dma_source === 'website' ? 'website' as const : 'none' as const };
    if (body.action === 'cancel_renewal' || body.action === 'cancel_subscription') {
      if (!billing.stripe_subscription_id || !body.requestKey) return json({ error: 'A confirmed subscription change is required.' }, 400);
      const sub = await stripe.subscriptions.retrieve(billing.stripe_subscription_id);
      if (sub.livemode !== live || sub.metadata.user_id !== owner || sub.metadata.pricing_version !== '2026-10') throw new Error('Subscription identity mismatch.');
      const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
      if (scheduleId) await stripe.subscriptionSchedules.release(scheduleId, {}, { idempotencyKey: `release:${owner}:${body.requestKey}` });
      if (body.action === 'cancel_subscription') await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true }, { idempotencyKey: `cancel:${owner}:${body.requestKey}` });
      const { error } = await admin.from('company_billing').update({ pending_renewal: body.action === 'cancel_subscription' ? { cancellation: true, effectiveAt: sub.items.data[0]?.current_period_end } : null }).eq('owner_id', owner);
      if (error) throw error;
      await reconcileCompany(admin, stripe, owner, sub.id);
      return json({ success: true, amountDue: 0 });
    }
    if (body.action === 'schedule_renewal') {
      if (!billing.stripe_subscription_id || !body.capacity || !body.requestKey) return json({ error: 'A subscription and confirmed renewal capacity are required.' }, 400);
      const { data: assigned, error: assignedError } = await admin.from('team_member_access').select('seat_type').eq('owner_id', owner).neq('status', 'removed').eq('member_kind', 'employee');
      if (assignedError) throw assignedError;
      for (const seat of ['scout', 'manager', 'field'] as const) {
        if (body.capacity[seat] > capacity[seat]) return json({ error: 'Renewal reductions cannot purchase new capacity.' }, 400);
        if (body.capacity[seat] < (assigned ?? []).filter(m => m.seat_type === seat).length) return json({ error: 'Remove or reassign occupied seats before reducing capacity.' }, 409);
      }
      const sub = await stripe.subscriptions.retrieve(billing.stripe_subscription_id);
      if (sub.livemode !== live || sub.metadata.user_id !== owner || sub.metadata.pricing_version !== '2026-10' || sub.pending_update) throw new Error('Subscription cannot be changed now.');
      const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
      const schedule = scheduleId ? await stripe.subscriptionSchedules.retrieve(scheduleId) : await stripe.subscriptionSchedules.create({ from_subscription: sub.id }, { idempotencyKey: `renewal-schedule:${owner}:${body.requestKey}` });
      const phase = schedule.phases[0];
      if (!phase) throw new Error('Current subscription phase missing.');
      const nextInterval = body.interval ?? interval;
      const nextPlan = { ...plan, scoutSeats: body.capacity.scout, managerSeats: body.capacity.manager, fieldUsers: body.capacity.field };
      const nextLines = quote(nextPlan, nextInterval).lines;
      await stripe.subscriptionSchedules.update(schedule.id, { end_behavior: 'release', proration_behavior: 'none', phases: [
        { start_date: phase.start_date, end_date: phase.end_date, items: sub.items.data.map(i => ({ price: i.price.id, quantity: i.quantity ?? 1 })), ...(sub.trial_end && sub.trial_end > Math.floor(Date.now()/1000) ? { trial_end: sub.trial_end } : {}), proration_behavior: 'none' },
        { start_date: phase.end_date, items: nextLines.map(l => ({ price: PRICE_IDS[nextInterval][l.key], quantity: l.quantity })), iterations: 1, proration_behavior: 'none', metadata: sub.metadata },
      ] }, { idempotencyKey: `renewal-update:${owner}:${body.requestKey}` });
      const { error: pendingError } = await admin.from('company_billing').update({ pending_renewal: { capacity: body.capacity, interval: nextInterval, total: quote(nextPlan,nextInterval).total, effectiveAt: phase.end_date } }).eq('owner_id', owner);
      if (pendingError) throw pendingError;
      return json({ success: true, amountDue: 0, renewalTotal: quote(nextPlan,nextInterval).total });
    }
    if (body.action === 'confirm_purchase') {
      if (!body.changeId) return json({ error: 'Preview the invoice first.' }, 400);
      const { data: change, error } = await admin.from('company_billing_changes').select('*').eq('id', body.changeId).eq('owner_id', owner).single();
      if (error || !change || Date.parse(change.expires_at) < Date.now()) return json({ error: 'This invoice preview expired. Preview again.' }, 409);
      if (change.status === 'complete') return json({ success: true, alreadyCompleted: true });
      if (!billing.stripe_subscription_id) throw new Error('Company subscription missing.');
      const saved = change.payload as { items: Stripe.SubscriptionUpdateParams.Item[]; prorationDate: number; subscriptionId: string };
      if (saved.subscriptionId !== billing.stripe_subscription_id) throw new Error('Subscription changed; preview again.');
      const current = await stripe.subscriptions.retrieve(saved.subscriptionId);
      if (billing.pending_renewal) return json({ error: 'Cancel the scheduled renewal change before purchasing more seats.' }, 409);
      if (current.livemode !== live || current.metadata.user_id !== owner || current.metadata.pricing_version !== '2026-10') throw new Error('Subscription identity mismatch.');
      if (current.pending_update) return json({ error: 'An existing payment is pending. Finish it before another upgrade.' }, 409);
      const fresh = await stripe.invoices.createPreview({ customer: current.customer as string, subscription: current.id,
        subscription_details: { items: saved.items, proration_date: saved.prorationDate, proration_behavior: 'always_invoice' } });
      const trialActive = current.status === 'trialing' && !!current.trial_end && current.trial_end > Math.floor(Date.now() / 1000);
      if ((trialActive ? 0 : fresh.amount_due) !== (change.preview as any)?.amountDue) return json({ error: 'The invoice amount changed. Preview again before confirming.' }, 409);
      const updated = await stripe.subscriptions.update(current.id, { items: saved.items, proration_date: saved.prorationDate,
        proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete' }, { idempotencyKey: `company-upgrade:${change.id}` });
      const pending = !!updated.pending_update;
      const { error: changeError } = await admin.from('company_billing_changes').update({ status: pending ? 'payment_pending' : 'complete' }).eq('id', change.id);
      if (changeError) throw changeError;
      if (!pending) await reconcileCompany(admin, stripe, owner, current.id);
      return json({ success: !pending, paymentPending: pending, error: pending ? 'Payment is pending. Existing access stays unchanged; the new seat is not assigned yet.' : undefined });
    }
    if (body.action === 'checkout') {
      if (!body.requestKey) return json({ error: 'A purchase confirmation is required.' }, 400);
      if (billing.stripe_subscription_id) return json({ error: 'This company already has a subscription. Use a renewal-aligned change, not another checkout.' }, 409);
      const { data: openCheckouts } = await admin.from('company_billing_changes').select('preview').eq('owner_id', owner).eq('action', 'checkout').order('created_at', { ascending: false }).limit(5);
      for (const c of openCheckouts ?? []) {
        if (!c.preview?.sessionId) continue;
        let oldSession = await stripe.checkout.sessions.retrieve(c.preview.sessionId);
        // An open page keeps the plan and trial it was made with, so it is expired and the current choice gets a new one.
        if (oldSession.status === 'open') {
          try { await stripe.checkout.sessions.expire(oldSession.id); continue; } catch (err) {
            oldSession = await stripe.checkout.sessions.retrieve(oldSession.id);
            if (oldSession.status === 'expired') continue;
            if (oldSession.status !== 'complete' || typeof oldSession.subscription !== 'string') throw err;
          }
        }
        if (oldSession.status === 'complete' && typeof oldSession.subscription === 'string') {
          await reconcileCompany(admin, stripe, owner, oldSession.subscription);
          return json({ error: 'Your subscription is already confirmed. Refresh the Team page.' }, 409);
        }
      }
      const selectedInterval = body.interval ?? interval;
      const selected = { ...plan, ownerScout: body.ownerScout ?? plan.ownerScout, dma: billing.dma_source === 'website' ? 'website' as const : body.dma ? 'paid' as const : plan.dma };
      const lines = quote(selected, selectedInterval).lines;
      for (const line of lines) {
        const price = await stripe.prices.retrieve(PRICE_IDS[selectedInterval][line.key]);
        if (price.livemode !== live || price.unit_amount !== line.unit || price.recurring?.interval !== selectedInterval) throw new Error('Stripe price does not match the approved catalog.');
      }
      // Keeps the trial's own end; under 48 hours left moves it to 49 hours out (Stripe's minimum); an ended trial pays now.
      const trialEnd = checkoutTrialEnd(billing.trial_ends_at, Date.now());
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription', customer: billing.stripe_customer_id ?? undefined,
        customer_email: billing.stripe_customer_id ? undefined : user.email,
        line_items: lines.map(l => ({ price: PRICE_IDS[selectedInterval][l.key], quantity: l.quantity })),
        subscription_data: { ...(trialEnd ? { trial_end: trialEnd } : {}), trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }, metadata: { user_id: owner, pricing_version: '2026-10', environment: env, owner_scout: String(selected.ownerScout) } },
        metadata: { user_id: owner, pricing_version: '2026-10', environment: env },
        payment_method_collection: 'always',
        payment_method_types: ['card'], adaptive_pricing: { enabled: false },
        success_url: `${APP}${RETURN_PATHS[body.returnTo ?? 'team']}?checkout=returned`, cancel_url: `${APP}${RETURN_PATHS[body.returnTo ?? 'team']}`,
      }, { idempotencyKey: `company-checkout:${owner}:${body.requestKey}` });
      const { error: storeError } = await admin.from('company_billing_changes').insert({ owner_id: owner, request_key: body.requestKey, action: 'checkout', payload: selected, preview: { sessionId: session.id } });
      if (storeError) { await stripe.checkout.sessions.expire(session.id); throw storeError; }
      return json({ url: session.url });
    }
    if (body.action === 'remove') {
      if (!body.memberId) return json({ error: 'Select a team member.' }, 400);
      const { data: member } = await admin.from('team_member_access').select('*').eq('owner_id', owner).eq('id', body.memberId).single();
      if (!member) return json({ error: 'Team member not found.' }, 404);
      const { error } = await admin.from('team_member_access').update({ status: 'removed', permissions: NO_PERMISSIONS }).eq('id', member.id).eq('owner_id', owner);
      if (error) throw error;
      // Capacity remains prepaid and reusable. Renewal reduction is a separate owner action.
      await admin.from('company_access_audit').insert({ owner_id: owner, actor_id: owner, action: 'remove_member', details: { member_id: member.id } });
      return json({ success: true, billingChange: false });
    }
    if (!body.permissions || !body.kind || body.seat === undefined || !body.email) return json({ error: 'Choose a member, seat and permissions.' }, 400);
    const assignment = { kind: body.kind, seat: body.seat, permissions: { ...NO_PERMISSIONS, ...body.permissions }, active: true };
    validateAssignment(assignment);
    const { data: members, error: membersError } = await admin.from('team_member_access').select('*').eq('owner_id', owner).neq('status', 'removed');
    if (membersError) throw membersError;
    const existing = body.memberId ? (members ?? []).find(m => m.id === body.memberId) : (members ?? []).find(m => m.email === body.email?.toLowerCase());
    if (body.memberId && (!existing || existing.email !== body.email.toLowerCase())) return json({ error: 'Member identity changed. Select the member again.' }, 409);
    const others = (members ?? []).filter(m => m.id !== existing?.id).map(m => ({ seat: m.seat_type, kind: m.member_kind, permissions: m.permissions, active: true }));
    const available = availableCapacity(capacity, others, billing.complimentary);
    if (body.kind === 'capture' && (billing.dma_source === 'none' || captureSlotsRemaining(others) <= 0)) return json({ error: billing.dma_source === 'none' ? 'Your company needs DMA for capture contributors.' : 'All 10 capture slots are used. Contact support.' }, 409);
    const needsPurchase = !!assignment.seat && available[assignment.seat] < 1;
    if (needsPurchase) {
      if (store) return json({ error: 'Your phone plan includes the owner and two Field users. More seats are not available on phone plans yet.' }, 409);
      if (billing.pending_renewal) return json({ error: 'A renewal change is scheduled. Cancel it before purchasing or reassigning affected capacity.' }, 409);
      if (!billing.stripe_subscription_id) return json({ error: 'Activate the company subscription before adding paid capacity.' }, 409);
      const sub = await stripe.subscriptions.retrieve(billing.stripe_subscription_id);
      if (sub.livemode !== live || sub.metadata.pricing_version !== '2026-10' || sub.metadata.user_id !== owner) throw new Error('Subscription identity did not match this company.');
      const seat = assignment.seat;
      if (!seat) throw new Error('Seat required.');
      const price = PRICE_IDS[interval][seat];
      const item = sub.items.data.find(i => i.price.id === price);
      const prorationDate = Math.floor(Date.now() / 1000);
      const items: Stripe.SubscriptionUpdateParams.Item[] = [{ ...(item ? { id: item.id } : {}), price, quantity: (item?.quantity ?? 0) + 1 }];
      // A paid lower seat upgrade credits its unused value in the same invoice, not a second charge.
      if (existing?.seat_type && existing.seat_type !== seat && (existing.seat_type !== 'field' || capacity.field > 2)) {
        const oldPrice = PRICE_IDS[interval][existing.seat_type as 'scout' | 'manager' | 'field'];
        const oldItem = sub.items.data.find(i => i.price.id === oldPrice);
        if (oldItem) items.push((oldItem.quantity ?? 0) > 1 ? { id: oldItem.id, quantity: (oldItem.quantity ?? 0) - 1 } : { id: oldItem.id, deleted: true });
      }
      const preview = await stripe.invoices.createPreview({ customer: sub.customer as string, subscription: sub.id,
        subscription_details: { proration_behavior: 'always_invoice', proration_date: prorationDate, items } });
      const amountDue = sub.status === 'trialing' && sub.trial_end && sub.trial_end > prorationDate ? 0 : preview.amount_due;
      const nextPlan = { ...plan, ...(seat === 'scout' ? { scoutSeats: plan.scoutSeats + 1 } : seat === 'manager' ? { managerSeats: plan.managerSeats + 1 } : { fieldUsers: plan.fieldUsers + 1 }) };
      if (existing?.seat_type && existing.seat_type !== seat) {
        if (existing.seat_type === 'scout') nextPlan.scoutSeats--;
        if (existing.seat_type === 'manager') nextPlan.managerSeats--;
        if (existing.seat_type === 'field' && capacity.field > 2) nextPlan.fieldUsers--;
      }
      const { data: change, error: changeError } = await admin.from('company_billing_changes').insert({ owner_id: owner, request_key: body.requestKey ?? crypto.randomUUID(), action: 'seat_upgrade', payload: { items, prorationDate, subscriptionId: sub.id }, preview: { amountDue } }).select('id').single();
      if (changeError) throw changeError;
      return json({ changeId: change.id, requiresPurchase: true, amountDue, currency: preview.currency, renewalDate: billing.current_period_end,
        renewalTotal: quote(nextPlan, interval).total,
        error: body.action === 'save_access' ? 'Confirm the invoice preview before granting access.' : undefined });
    }
    const summary = { billingChange: false, amountDue: 0, renewalTotal: quote(plan, interval).total, renewalDate: billing.current_period_end, available: assignment.seat ? available[assignment.seat] : null };
    if (body.action === 'preview') return json(summary);
    if (!existing?.user_id) {
      if (body.kind === 'subcontractor') return json({ error: 'Invite subcontractors through Subs; they never join the office team.' }, 409);
      const cleanEmail = body.email.toLowerCase();
      const { data: existingProfile, error: lookupError } = await admin.from('profiles').select('id,parent_contractor_id,account_type').eq('email', cleanEmail).maybeSingle();
      if (lookupError) throw lookupError;
      if (existingProfile?.account_type === 'subcontractor' || existingProfile?.parent_contractor_id) return json({ error: 'This login is already linked to a team or subcontractor account.' }, 409);
      if (existing?.invitation_id) {
        const { data: invite } = await admin.from('team_invitations').select('invite_token,expires_at').eq('id', existing.invitation_id).single();
        if (invite && Date.parse(invite.expires_at) > Date.now()) {
          const { error: reservationUpdateError } = await admin.from('team_member_access').update({ seat_type: assignment.seat, member_kind: assignment.kind, permissions: assignment.permissions }).eq('id', existing.id).eq('owner_id', owner);
          if (reservationUpdateError) throw reservationUpdateError;
          return json({ ...summary, success: true, inviteUrl: `https://app.treecheck.ai/accept-invite?team_token=${invite.invite_token}` });
        }
      }
      const { data: invite, error: inviteError } = await admin.from('team_invitations').insert({ parent_contractor_id: owner, email: cleanEmail }).select('id,invite_token').single();
      if (inviteError) throw inviteError;
      const { error: reservationError } = await admin.from('team_member_access').upsert({ owner_id: owner, email: cleanEmail, invitation_id: invite.id, seat_type: assignment.seat, member_kind: assignment.kind, permissions: assignment.permissions, status: 'invited' }, { onConflict: 'owner_id,email' });
      if (reservationError) throw reservationError;
      return json({ ...summary, success: true, inviteUrl: `https://app.treecheck.ai/accept-invite?team_token=${invite.invite_token}`, notificationsSent: false });
    }
    const { error: saveError } = await admin.from('team_member_access').update({ seat_type: assignment.seat, member_kind: assignment.kind, permissions: assignment.permissions }).eq('id', existing.id).eq('owner_id', owner);
    if (saveError) throw saveError;
    const { error: auditError } = await admin.from('company_access_audit').insert({ owner_id: owner, actor_id: owner, action: 'update_permissions', details: { member_id: existing.id, permissions: assignment.permissions, seat: assignment.seat } });
    if (auditError) throw auditError;
    return json({ ...summary, success: true });
  } catch (error) {
    console.error('company-billing failed', error instanceof Error ? error.message : 'unknown error');
    return json({ error: error instanceof Error ? error.message : 'Billing request failed.' }, 400);
  } finally {
    if (admin && owner && lock) await admin.from('company_billing_locks').delete().eq('owner_id', owner).eq('token', lock);
  }
});