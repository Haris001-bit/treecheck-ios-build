/**
 * RevenueCat product catalog for the phone apps: Apple IAP on iOS, and the company plans on both stores.
 * Product IDs must match App Store Connect, Play Console and RevenueCat exactly.
 */

export const IAP_PRODUCTS = {
  credits250: 'treecheck_credits_250',
  credits500: 'treecheck_credits_500',
  marketingMonthly: 'treecheck_marketing_monthly',
  dmaMonthly: 'treecheck_dma_monthly',
  demoMonthly: 'treecheck_demo_monthly',
} as const;

/** Consumable lead-unlock price ladder (USD). Pick smallest tier >= computed lead fee. */
export const LEAD_UNLOCK_TIERS = [
  { productId: 'treecheck_lead_unlock_5', priceUsd: 4.99 },
  { productId: 'treecheck_lead_unlock_10', priceUsd: 9.99 },
  { productId: 'treecheck_lead_unlock_15', priceUsd: 14.99 },
  { productId: 'treecheck_lead_unlock_25', priceUsd: 24.99 },
  { productId: 'treecheck_lead_unlock_40', priceUsd: 39.99 },
  { productId: 'treecheck_lead_unlock_60', priceUsd: 59.99 },
  { productId: 'treecheck_lead_unlock_100', priceUsd: 99.99 },
] as const;

export const IAP_ENTITLEMENTS = {
  marketing: 'marketing',
  dma: 'dma',
  demo: 'demo',
} as const;

export const IAP_OFFERING_DEFAULT = 'default';
export const IAP_OFFERING_LEAD_UNLOCK = 'lead_unlock';

/**
 * The company plans in the phone apps (payments milestone): one RevenueCat entitlement and one offering for both
 * stores. The server maps each product to the plan's seats (supabase/functions/_shared/storePlans.ts, same ids).
 * Google's ids are subscriptionId:basePlanId, as RevenueCat reports them.
 */
export const STORE_PLAN_ENTITLEMENT = 'company';
export const STORE_PLAN_OFFERING = 'company_plans';

export type StorePlanKey = 'core_scout_monthly' | 'core_monthly' | 'core_yearly';

export const STORE_PLANS: Record<StorePlanKey, {
  packageId: string;
  apple: string;
  google: string;
  ownerScout: boolean;
  interval: 'month' | 'year';
  title: string;
}> = {
  core_scout_monthly: {
    packageId: '$rc_monthly', apple: 'treecheck_core_scout_monthly', google: 'treecheck_core_scout:monthly',
    ownerScout: true, interval: 'month', title: 'Core + 1 Scout',
  },
  core_monthly: {
    packageId: 'core_monthly', apple: 'treecheck_core_monthly', google: 'treecheck_core:monthly',
    ownerScout: false, interval: 'month', title: 'Core',
  },
  core_yearly: {
    packageId: '$rc_annual', apple: 'treecheck_core_yearly', google: 'treecheck_core:yearly',
    ownerScout: false, interval: 'year', title: 'Core, yearly',
  },
};

/** The plan a store product id belongs to, on either store. */
export function storePlanForProduct(productId: string | null | undefined): StorePlanKey | null {
  if (!productId) return null;
  const hit = (Object.keys(STORE_PLANS) as StorePlanKey[]).find(
    (k) => STORE_PLANS[k].apple === productId || STORE_PLANS[k].google === productId,
  );
  return hit ?? null;
}

export const IAP_CREDIT_GRANTS: Record<string, number> = {
  [IAP_PRODUCTS.credits250]: 250,
  [IAP_PRODUCTS.credits500]: 500,
};

export function pickLeadUnlockTier(leadPriceUsd: number) {
  const tier =
    LEAD_UNLOCK_TIERS.find((t) => t.priceUsd >= leadPriceUsd) ??
    LEAD_UNLOCK_TIERS[LEAD_UNLOCK_TIERS.length - 1];
  return tier;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
