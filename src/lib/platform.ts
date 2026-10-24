/**
 * Platform & payment routing
 *
 * - Web: Stripe Checkout + card unlocks
 * - Native iOS + VITE_IOS_USE_IAP=true: Apple IAP via RevenueCat (no Stripe in-app)
 * - Native iOS without IAP: legacy safe mode (optional US external unlock, or strict wall)
 * - Native Android: no Stripe in-app; the company plans through Google Play via RevenueCat when
 *   VITE_REVENUECAT_ANDROID_API_KEY is set
 */

import { Capacitor } from '@capacitor/core';

const env = (import.meta as any).env ?? {};

const FLAG_EXTERNAL_ALLOWED =
  String(env.VITE_IOS_EXTERNAL_PURCHASE_LINKS_ALLOWED ?? 'true') !== 'false';
const FLAG_REGION = String(env.VITE_IOS_EXTERNAL_PURCHASE_LINK_REGION ?? 'US').toUpperCase();
const FLAG_IOS_IAP = String(env.VITE_IOS_USE_IAP ?? 'false') === 'true';
const ANDROID_RC_KEY = String(env.VITE_REVENUECAT_ANDROID_API_KEY ?? '').trim();
const WEB_BASE_URL = String(
  env.VITE_TREECHECK_WEB_BASE_URL ?? 'https://app.treecheck.ai',
).replace(/\/$/, '');

export function isNativeIOS(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

function isForcedSafeMode(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('forceSafeMode');
    if (q === '1' || q === 'true') {
      localStorage.setItem('tc_force_safe_mode', '1');
      return true;
    }
    if (q === '0' || q === 'false') {
      localStorage.removeItem('tc_force_safe_mode');
      return false;
    }
    return localStorage.getItem('tc_force_safe_mode') === '1';
  } catch {
    return false;
  }
}

/** Native iOS or QA-forced safe mode (blocks Stripe UI). */
export function isAppStoreSafeMode(): boolean {
  return isNativeIOS() || isForcedSafeMode();
}

/** Apple IAP via RevenueCat is available on native iOS when the flag is on. */
export function canUseAppleIAP(): boolean {
  return isNativeIOS() && FLAG_IOS_IAP;
}

/**
 * A store build, iPhone or Android (payments milestone): plans are sold through Apple or Google, so no screen shows a
 * Stripe price, checkout, billing portal or "manage billing" link (Apple 3.1.1, Google Play's payments policy).
 * QA's forced safe mode counts too. Wording that is about Apple only stays on isAppStoreSafeMode().
 */
export function isNativeStoreBilling(): boolean {
  return isAppStoreSafeMode() || isNativeAndroid();
}

/**
 * The company plans in the phone apps: Apple's on iPhone with IAP on, Google Play's on Android with its RevenueCat key
 * (the build's key by default; tests pass one).
 */
export function canUseStorePlans(androidKey: string = ANDROID_RC_KEY): boolean {
  return canUseAppleIAP() || (isNativeAndroid() && androidKey.startsWith('goog_'));
}

/** The store that bills the phone plans on this device, for wording. */
export function storeName(): 'the App Store' | 'Google Play' {
  return isNativeAndroid() ? 'Google Play' : 'the App Store';
}

/**
 * External website unlock (Safari / Browser sheet).
 * Disabled when Apple IAP is enabled.
 */
export function isExternalUnlockAllowed(): boolean {
  if (canUseAppleIAP()) return false;
  if (!isAppStoreSafeMode()) return false;
  return FLAG_EXTERNAL_ALLOWED && FLAG_REGION === 'US';
}

/** Safe mode without external unlock and without IAP commerce. */
export function isStrictSafeMode(): boolean {
  return isAppStoreSafeMode() && !isExternalUnlockAllowed() && !canUseAppleIAP();
}

export function getWebBaseUrl(): string {
  return WEB_BASE_URL;
}

/**
 * Stripe / card payment UI (web only).
 * False in the store builds; use the IAP UI instead when canUseAppleIAP().
 */
export function canShowPaymentUI(): boolean {
  return !isNativeStoreBilling();
}

/** True when the app may show any paid commerce UI (Stripe or Apple IAP). */
export function canShowCommerceUI(): boolean {
  return canShowPaymentUI() || canUseAppleIAP();
}

/**
 * Stripe edge functions blocked on iOS.
 * purchase-lead is allowed when IAP is on (credits-only / post-IAP grant paths).
 */
export function canUsePaymentFunction(functionName?: string): boolean {
  if (!isAppStoreSafeMode()) return true;

  if (
    canUseAppleIAP() &&
    functionName &&
    (functionName === 'purchase-lead' || functionName === 'iap-unlock-lead')
  ) {
    return true;
  }

  if (import.meta.env.DEV && functionName) {
    // eslint-disable-next-line no-console
    console.warn(`[AppStoreSafeMode] Blocked payment function call: ${functionName}`);
  }
  return false;
}

export function shouldHidePurchaseCTA(): boolean {
  if (canUseAppleIAP()) return false;
  return isNativeStoreBilling();
}

export const PAYMENT_EDGE_FUNCTIONS = new Set<string>([
  'company-billing',
  'buy-credits',
  'add-credits',
  'purchase-lead',
  'setup-payment-method',
  'check-payment-method',
  'create-pro-checkout',
  'create-marketing-checkout',
  'create-dma-subscription',
  'check-dma-subscription',
  'check-marketing-subscription',
  'check-subscription',
  'postgrid-send-postcard',
  'manage-team-seat',
  'create-trial-signup',
]);

export function isPaymentEdgeFunction(name: string): boolean {
  return PAYMENT_EDGE_FUNCTIONS.has(name);
}
