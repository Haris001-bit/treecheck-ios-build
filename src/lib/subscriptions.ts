// TREECHECK Credit & Premium Configuration
// Credit Purchase: prod_Tz3DyKYFwGm1PU / price_1T156kLSrCwArzdgmYvQ1Go5
// Premium Subscription: prod_Tz3DVgO6ky0tP4 / price_1T156zLSrCwArzdgMOajyTKZ

export const CREDIT_PURCHASE = {
  amount: 250, // $250 credit purchase
  priceId: 'price_1T156kLSrCwArzdgmYvQ1Go5',
  productId: 'prod_Tz3DyKYFwGm1PU',
  discountRate: 0.025, // 2.5% on the triggering lead only
} as const;

export const PREMIUM_CREDIT_PURCHASE = {
  amount: 500, // $500 one-time credit purchase
  priceId: 'price_1T4R8fLSrCwArzdgsiAIRFgV',
  productId: 'prod_U2WBkLuTRavcK0',
  discountRate: 0.025, // 2.5% when out of rotation (no early access)
  standardRate: 0.05, // 5% when in rotation (has early access)
  rotationSlots: 3, // 3 premium members get 60-min early access
  rotationMinutes: 60,
} as const;

export const MARKETING_PACKAGE = {
  amount: 99, // $99/month
  priceId: 'price_1T7jxtLSrCwArzdgyNbRR6Ao',
  productId: 'prod_U5vpVsVpLfI1EM',
} as const;

/**
 * Products included FREE during the 14-day demo trial.
 * After the trial converts to paid these same products stay active on the
 * base $50/mo plan; add-ons (postcards, DMA web publish, LSA, Jobber, etc.)
 * are separate purchases.
 */
export const DEMO_TRIAL_INCLUDES = [
  'scout',
  'dma_basic_demo',
  'team_seats',
] as const;

export const TEAM_SEAT = {
  amount: 9,
  priceId: 'price_1TTVwoLSrCwArzdgWcMzk2P7',
} as const;

export const STANDARD_FEE_RATE = 0.05; // 5% of median (first 24 hours)
export const DAY1_FEE_RATE = 0.03; // 3% after 1 day
export const DAY2_FEE_RATE = 0.02; // 2% after 2 days

export type SubscriptionTier = 'free' | 'premium';

/**
 * Returns the standard fee rate based on lead age.
 * 0-24h: 5%, 24-48h: 3%, 48h+: 2%
 */
export function getStandardRateForLead(leadCreatedAt: string): number {
  const ageMs = Date.now() - new Date(leadCreatedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours >= 48) return DAY2_FEE_RATE;
  if (ageHours >= 24) return DAY1_FEE_RATE;
  return STANDARD_FEE_RATE;
}

export function getLeadPrice(minCost: number, maxCost: number, rate: number = STANDARD_FEE_RATE): number {
  const median = (minCost + maxCost) / 2;
  return Math.round(median * rate * 100) / 100;
}
