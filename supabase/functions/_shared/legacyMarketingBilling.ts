export const LEGACY_MARKETING_PRICE_ID = 'price_1T7jxtLSrCwArzdgyNbRR6Ao';
export const MARKETING_BILLING_UNAVAILABLE = 'This legacy Marketing Package uses live billing and cannot be checked or purchased while test billing is enabled. No payment has been taken.';
export function canCheckLegacyMarketing(key: string): boolean {
  return key.startsWith('sk_live_') || key.startsWith('rk_live_');
}
export function findLegacyMarketingSubscription<T extends { items: { data: Array<{ price: { id: string } }> } }>(subscriptions: T[]): T | undefined {
  return subscriptions.find(subscription => subscription.items.data.some(item => item.price.id === LEGACY_MARKETING_PRICE_ID));
}