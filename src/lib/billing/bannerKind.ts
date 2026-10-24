// Which billing banner an owner sees (payments milestone, 2026-10-21); src/components/billing/BillingBanner.tsx shows it.

export type BillingBannerKind = 'past_due' | 'choose_plan' | 'finish_signup' | null;

/**
 * Which banner an owner sees, from their company billing row and profile. Pure, so it can be tested.
 * A phone plan (App Store or Google Play) and a trial of the old $50 iPhone plan (`storeTrial`) get none: the store
 * runs those trials and renewals itself.
 */
export function billingBannerKind(
  billing: { pricing_version?: string; provider?: string; status?: string; stripe_subscription_id?: string | null } | undefined,
  profile: { subscription_tier?: string | null; trial_ends_at?: string | null; storeTrial?: boolean } | undefined,
  plansOpen: boolean,
  now = Date.now(),
): BillingBannerKind {
  const onPlans = billing?.pricing_version === '2026-10';
  if (onPlans && (billing.provider === 'app_store' || billing.provider === 'play_store')) return null;
  if (onPlans && billing.status === 'past_due') return 'past_due';
  if (!plansOpen) return null;
  if (onPlans && billing.status === 'incomplete' && !billing.stripe_subscription_id) return 'finish_signup';
  if (onPlans && billing.status === 'trialing' && !billing.stripe_subscription_id) return 'choose_plan';
  const noCardTrial = !onPlans && profile?.subscription_tier === 'demo_trial' && !profile.storeTrial && !!profile.trial_ends_at && Date.parse(profile.trial_ends_at) > now;
  return noCardTrial ? 'choose_plan' : null;
}
