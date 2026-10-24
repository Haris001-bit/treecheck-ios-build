// Whether TreeCheck's Stripe takes real cards (onboarding milestone, 2026-10-13). On a test key Stripe declines every
// real card, so signup can't wait for one: an owner gets a 14-day trial with no card step, and subs aren't charged.
// Pure, no imports, so vitest can run it.

export const TRIAL_DAYS_WITHOUT_CARD = 14;

export function stripeTakesRealCards(secretKey: string | null | undefined): boolean {
  return !!secretKey && !/^(sk|rk)_test_/.test(secretKey.trim());
}

// The live key went in on 2026-10-21. A trial asks for a card only once the company plans are open
// (billing_rollout, _shared/billingRollout.ts) and the key is live; until then trials start with no card.
export function trialTakesCard(secretKey: string | null | undefined, plansOpen: boolean): boolean {
  return plansOpen && stripeTakesRealCards(secretKey);
}
