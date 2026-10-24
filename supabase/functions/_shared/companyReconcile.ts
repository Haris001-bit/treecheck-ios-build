import { companyPriceIds } from './companyPriceIds.ts';

// A Stripe event that this company's row can't take: no row (the account was deleted), a row on the other Stripe mode,
// or a subscription that isn't this company's. Retrying won't change it, so the webhook logs it and answers 200.
export class ReconcileSkip extends Error {}

// Retrieve current Stripe state rather than applying stale webhook payloads.
export async function reconcileCompany(admin: any, stripe: any, owner: string, subscriptionId: string) {
  const { data: billing, error } = await admin.from('company_billing').select('*').eq('owner_id', owner).maybeSingle();
  if (error) throw error;
  if (!billing) throw new ReconcileSkip('No company billing row.');
  // A phone plan (App Store or Google Play) owns the row; an old website subscription's events never overwrite it.
  if (billing.provider && billing.provider !== 'stripe') throw new ReconcileSkip('Company plan is billed by a store.');
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const env = sub.livemode ? 'live' : 'sandbox';
  if (billing.pricing_version !== '2026-10' || billing.environment !== env || sub.metadata?.user_id !== owner || sub.metadata?.pricing_version !== '2026-10') throw new ReconcileSkip('Company subscription identity mismatch.');
  if (billing.stripe_subscription_id && billing.stripe_subscription_id !== sub.id) throw new ReconcileSkip('Company already has another subscription.');
  // Typed so the check below narrows it to 'month' | 'year' (Stripe's object is untyped here).
  const interval: string | undefined = sub.items.data[0]?.price.recurring?.interval;
  if (interval !== 'month' && interval !== 'year') throw new Error('Unexpected billing interval.');
  const ids = companyPriceIds(sub.livemode)[interval];
  if (!sub.items.data.some((i: any) => i.price.id === ids.core && i.quantity === 1)) throw new Error('Core subscription item missing.');
  if (sub.items.data.some((i: any) => !Object.values(ids).includes(i.price.id))) throw new Error('Unexpected company subscription price.');
  const count = (key: keyof typeof ids) => sub.items.data.find((i: any) => i.price.id === ids[key])?.quantity ?? 0;
  const previous = billing.capacity;
  const ownerScout = sub.metadata?.owner_scout === 'true';
  const currentEnd = sub.items.data[0]?.current_period_end ?? sub.current_period_end;
  const currentStart = sub.items.data[0]?.current_period_start ?? sub.current_period_start;
  // pending_if_incomplete leaves the purchased items untouched until payment succeeds.
  const status = sub.status;
  const capacity = status === 'active' || status === 'trialing'
    ? { scout: Math.max(0, count('scout') - Number(ownerScout)), manager: count('manager'), field: 2 + count('field'), ownerScout }
    : previous;
  const { error: updateError } = await admin.from('company_billing').update({
    stripe_subscription_id: sub.id, stripe_customer_id: sub.customer, billing_interval: interval, status,
    capacity, dma_source: billing.dma_source === 'website' ? 'website' : count('dma') ? 'paid' : 'none',
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : billing.trial_ends_at,
    current_period_end: currentEnd ? new Date(currentEnd * 1000).toISOString() : null, updated_at: new Date().toISOString(),
    ...(billing.pending_renewal?.effectiveAt && currentStart >= billing.pending_renewal.effectiveAt ? { pending_renewal: null } : {}),
  }).eq('owner_id', owner);
  if (updateError) throw updateError;
  return sub;
}
