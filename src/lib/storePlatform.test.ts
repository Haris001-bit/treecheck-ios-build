// The store builds (payments milestone, Part B): Android hides Stripe like iPhone does, the phone plans open only with
// the platform's RevenueCat key, and each platform takes only its own public key (appl_ on iOS, goog_ on Android).
import { afterEach, describe, expect, it, vi } from 'vitest';

let platform = 'web';
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => platform !== 'web', getPlatform: () => platform },
}));

const load = () => import('@/lib/platform');

afterEach(() => {
  vi.unstubAllEnvs();
  platform = 'web';
  localStorage.clear();
});

describe('store builds hide Stripe', () => {
  it('the website shows Stripe; iPhone and Android do not', async () => {
    const p = await load();
    expect(p.isNativeStoreBilling()).toBe(false);
    expect(p.canShowPaymentUI()).toBe(true);
    platform = 'android';
    expect(p.isNativeStoreBilling()).toBe(true);
    expect(p.canShowPaymentUI()).toBe(false);
    expect(p.shouldHidePurchaseCTA()).toBe(true);
    // Apple-only wording stays on App Store safe mode.
    expect(p.isAppStoreSafeMode()).toBe(false);
    platform = 'ios';
    expect(p.isNativeStoreBilling()).toBe(true);
    expect(p.canShowPaymentUI()).toBe(false);
  });
  it('Android sells the plans only with its goog_ key; the website never does', async () => {
    const p = await load();
    platform = 'android';
    expect(p.canUseStorePlans('')).toBe(false);
    expect(p.canUseStorePlans('appl_wrong')).toBe(false);
    expect(p.canUseStorePlans('goog_abc')).toBe(true);
    expect(p.storeName()).toBe('Google Play');
    platform = 'web';
    expect(p.canUseStorePlans('goog_abc')).toBe(false);
  });
  it("iPhone sells the plans exactly when Apple IAP is on, and Android never uses Apple's", async () => {
    const p = await load();
    platform = 'ios';
    expect(p.canUseStorePlans('')).toBe(p.canUseAppleIAP());
    expect(p.storeName()).toBe('the App Store');
    platform = 'android';
    expect(p.canUseAppleIAP()).toBe(false);
  });
});

describe('RevenueCat key per platform', () => {
  it('names the right key and prefix for each platform', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_REVENUECAT_IOS_API_KEY', 'appl_ios');
    vi.stubEnv('VITE_REVENUECAT_ANDROID_API_KEY', 'goog_android');
    const rc = await import('@/lib/revenueCat');
    expect(rc.platformApiKey('ios')).toEqual({ name: 'VITE_REVENUECAT_IOS_API_KEY', key: 'appl_ios', prefix: 'appl_' });
    expect(rc.platformApiKey('android')).toEqual({ name: 'VITE_REVENUECAT_ANDROID_API_KEY', key: 'goog_android', prefix: 'goog_' });
  });
  it('accepts only the public key of its own platform', async () => {
    const { assertUsableApiKey } = await import('@/lib/revenueCat');
    const android = (key: string) => ({ name: 'VITE_REVENUECAT_ANDROID_API_KEY', key, prefix: 'goog_' as const });
    const ios = (key: string) => ({ name: 'VITE_REVENUECAT_IOS_API_KEY', key, prefix: 'appl_' as const });
    expect(() => assertUsableApiKey(android('goog_ok'))).not.toThrow();
    expect(() => assertUsableApiKey(ios('appl_ok'))).not.toThrow();
    expect(() => assertUsableApiKey(android('appl_ok'))).toThrow(/must start with goog_/);
    expect(() => assertUsableApiKey(ios('goog_ok'))).toThrow(/must start with appl_/);
    expect(() => assertUsableApiKey(android('sk_secret'))).toThrow(/not a secret key/);
    expect(() => assertUsableApiKey(ios('test_store'))).toThrow(/Test Store key/);
    expect(() => assertUsableApiKey(android(''))).toThrow(/is missing/);
  });
});
