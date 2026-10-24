import { describe, expect, it } from 'vitest';
import { canCheckLegacyMarketing, findLegacyMarketingSubscription, LEGACY_MARKETING_PRICE_ID } from '../../supabase/functions/_shared/legacyMarketingBilling';
describe('legacy marketing billing isolation', () => {
  it('never checks a live price using a test key', () => {
    expect(canCheckLegacyMarketing('sk_test_fixture')).toBe(false);
    expect(canCheckLegacyMarketing('rk_test_fixture')).toBe(false);
  });
  it('preserves live-key legacy verification', () => {
    expect(canCheckLegacyMarketing('sk_live_fixture')).toBe(true);
    expect(canCheckLegacyMarketing('rk_live_fixture')).toBe(true);
  });
  it('does not grant legacy marketing for another product including DMA', () => {
    expect(findLegacyMarketingSubscription([{ items: { data: [{ price: { id: 'price_dma' } }] } }])).toBeUndefined();
  });
  it('recognizes the unchanged legacy price among multiple subscription items', () => {
    const legacy = { id: 'legacy-sub', items: { data: [{ price: { id: 'price_other' } }, { price: { id: LEGACY_MARKETING_PRICE_ID } }] } };
    expect(findLegacyMarketingSubscription([legacy])).toBe(legacy);
    expect(LEGACY_MARKETING_PRICE_ID).toBe('price_1T7jxtLSrCwArzdgyNbRR6Ao');
  });
});