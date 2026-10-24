// Website checkout and card management for the company plans (payments milestone, 2026-10-21). Both go through
// company-billing, which builds the Stripe Checkout and the billing portal; the phone apps never call these.
import { companyBillingAction } from '@/hooks/useCompanyBilling';
import type { PlanChoice } from '@/lib/pricing/planChoice';

export type BillingReturn = 'team' | 'start' | 'plans' | 'profile';

/** Opens Stripe Checkout for the chosen plan. Stripe brings the owner back to `returnTo` with ?checkout=returned. */
export async function startCompanyCheckout(choice: PlanChoice, returnTo: BillingReturn): Promise<void> {
  const result = await companyBillingAction({
    action: 'checkout', ownerScout: choice.ownerScout, interval: choice.interval, requestKey: crypto.randomUUID(), returnTo,
  });
  if (!result?.url) throw new Error('Could not open checkout. Please try again.');
  window.location.href = result.url;
}

/** Opens Stripe's billing portal: update the card, see invoices, cancel at the end of the period. */
export async function openCompanyPortal(returnTo: BillingReturn): Promise<void> {
  const result = await companyBillingAction({ action: 'portal', returnTo });
  if (!result?.url) throw new Error('Billing is unavailable. Please try again.');
  window.location.href = result.url;
}
