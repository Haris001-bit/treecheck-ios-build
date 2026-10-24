import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/hooks/useProfile';
import { DEMO_TRIAL_INCLUDES } from '@/lib/subscriptions';
import { useCompanyBilling } from '@/hooks/useCompanyBilling';
import { useCompanyPermission } from '@/hooks/useCompanyPermission';

export type Product =
  | 'scout'
  | 'dma'
  | 'dma_basic'
  | 'dma_basic_demo'
  | 'dma_web'
  | 'google_reviews'
  | 'lsa'
  | 'leads'
  | 'team_seats'
  | 'crew_membership';

export interface ProductEntitlement {
  product: Product;
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  seat_count: number;
  current_period_end: string | null;
}

/**
 * Marketing product pages on tradesmarketing.ai.
 * Tapping a locked menu item opens these in the in-app browser.
 */
export const PRODUCT_MARKETING_URLS: Record<Product, string> = {
  scout: 'https://tradesmarketing.ai/scout',
  dma: 'https://tradesmarketing.ai/dma',
  dma_basic: 'https://tradesmarketing.ai/dma',
  dma_basic_demo: 'https://tradesmarketing.ai/dma',
  dma_web: 'https://tradesmarketing.ai/dma-web',
  google_reviews: 'https://tradesmarketing.ai/google-reviews',
  lsa: 'https://tradesmarketing.ai/lsa',
  leads: 'https://tradesmarketing.ai/leads',
  team_seats: 'https://tradesmarketing.ai/scout',
  crew_membership: 'https://tradesmarketing.ai/scout',
};

/**
 * Per-product gating mode.
 *  - 'strict'  → must have an active entitlement row (or be admin, or be on
 *                the trial and this product is in DEMO_TRIAL_INCLUDES) to access
 *  - 'legacy'  → keep existing access logic intact (no entitlement required yet)
 *
 * Keep Scout legacy-accessible for existing contractor accounts while Stripe
 * entitlement backfill catches up. Flip products to 'strict' only when all
 * existing paid/trial users have reliable entitlement rows.
 */
export const PRODUCT_GATES: Record<Product, 'strict' | 'legacy'> = {
  scout: 'strict',
  dma: 'legacy',
  dma_basic: 'legacy',
  dma_basic_demo: 'legacy',
  dma_web: 'legacy',
  google_reviews: 'legacy',
  lsa: 'legacy',
  leads: 'legacy',
  team_seats: 'legacy',
  crew_membership: 'strict',
};

export function useEntitlements() {
  const { user, isAdmin } = useAuth();
  const { data: profile } = useProfile();
  const company = useCompanyBilling();
  const scoutPermission = useCompanyPermission('createScout');
  const dmaPermission = useCompanyPermission('dmaManage');

  const query = useQuery({
    queryKey: ['product-entitlements', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<ProductEntitlement[]> => {
      const { data, error } = await supabase
        .from('product_entitlements')
        .select('product, status, seat_count, current_period_end');
      if (error) throw error;
      return (data ?? []) as ProductEntitlement[];
    },
  });

  const activeProducts = new Set<Product>(
    (query.data ?? [])
      .filter(
        (e) =>
          (e.status === 'active' || e.status === 'trialing') &&
          (!e.current_period_end || new Date(e.current_period_end) > new Date()),
      )
      .map((e) => e.product),
  );

  // Demo-trial users get the trial bundle for free until trial ends.
  const trialActive =
    profile?.subscription_tier === 'demo_trial' &&
    (!profile?.trial_ends_at || new Date(profile.trial_ends_at) > new Date());

  /** True when the user can access the product. Admins bypass all gates. */
  function hasProduct(product: Product): boolean {
    if (company.data?.billing?.pricing_version === '2026-10') {
      if (product === 'scout') return scoutPermission.data === true;
      if (product === 'dma' || product === 'dma_web') return dmaPermission.data === true;
    }
    if (isAdmin) return true;
    if (trialActive && (DEMO_TRIAL_INCLUDES as readonly string[]).includes(product)) return true;
    if (PRODUCT_GATES[product] === 'legacy') return true;
    return activeProducts.has(product);
  }

  return {
    entitlements: query.data ?? [],
    activeProducts,
    hasProduct,
    isLoading: query.isLoading || company.isLoading || (company.data?.billing?.pricing_version === '2026-10' && (scoutPermission.isLoading || dmaPermission.isLoading)),
    trialActive,
  };
}
