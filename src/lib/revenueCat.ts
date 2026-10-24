import { Capacitor } from '@capacitor/core';
import { canUseStorePlans, isNativeAndroid } from '@/lib/platform';
import {
  IAP_OFFERING_DEFAULT,
  IAP_OFFERING_LEAD_UNLOCK,
  IAP_PRODUCTS,
  STORE_PLAN_OFFERING,
  STORE_PLANS,
  pickLeadUnlockTier,
  type StorePlanKey,
} from '@/lib/iapProducts';

type CustomerInfo = import('@revenuecat/purchases-capacitor').CustomerInfo;
type PurchasesPackage = import('@revenuecat/purchases-capacitor').PurchasesPackage;
type PurchasesStoreProduct = import('@revenuecat/purchases-capacitor').PurchasesStoreProduct;
type PurchasesOfferings = import('@revenuecat/purchases-capacitor').PurchasesOfferings;
type LOG_LEVEL = import('@revenuecat/purchases-capacitor').LOG_LEVEL;

let configured = false;

const OFFERINGS_TIMEOUT_MS = 20_000;
const PURCHASE_TIMEOUT_MS = 90_000;

type PluginHeaderMethod = { name: string; rtype?: string };
type PluginHeader = { name: string; methods: PluginHeaderMethod[] };

type CapBridge = {
  PluginHeaders?: PluginHeader[];
  nativePromise?: (pluginName: string, methodName: string, options?: unknown) => Promise<unknown>;
  nativeCallback?: (
    pluginName: string,
    methodName: string,
    options?: unknown,
    callback?: (data: unknown, error: unknown) => void,
  ) => unknown;
};

/** The public RevenueCat SDK key for this platform: appl_ on iOS, goog_ on Android. Never a secret key. */
export type PlatformApiKey = { name: string; key: string; prefix: 'appl_' | 'goog_' };

export function platformApiKey(platform: 'ios' | 'android' = isNativeAndroid() ? 'android' : 'ios'): PlatformApiKey {
  return platform === 'android'
    ? { name: 'VITE_REVENUECAT_ANDROID_API_KEY', key: String(import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY || '').trim(), prefix: 'goog_' }
    : { name: 'VITE_REVENUECAT_IOS_API_KEY', key: String(import.meta.env.VITE_REVENUECAT_IOS_API_KEY || '').trim(), prefix: 'appl_' };
}

function getCapBridge(): CapBridge {
  return (typeof window !== 'undefined' ? (window as unknown as { Capacitor?: CapBridge }).Capacitor : null) ||
    (Capacitor as unknown as CapBridge);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const { name, prefix } = platformApiKey();
      reject(
        new Error(
          `${label} timed out after ${Math.round(ms / 1000)}s. Check the device logs for RevenueCat messages, the store products, and that ${name} starts with ${prefix}.`,
        ),
      );
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function mapIapError(e: unknown): Error {
  const anyErr = e as { code?: string | number; message?: string; errorMessage?: string; userCancelled?: boolean };
  const code = String(anyErr?.code || '');
  const msg = String(anyErr?.message || anyErr?.errorMessage || e || 'Purchase failed');
  if (anyErr?.userCancelled || /cancel/i.test(msg) || code === '1' || code === 'PURCHASE_CANCELLED') {
    return new Error('Purchase cancelled');
  }
  if (code === 'UNIMPLEMENTED' || /unimplemented/i.test(msg)) {
    return new Error(
      'In-app purchase bridge call failed (UNIMPLEMENTED). Confirm the native logs show Purchases registered=true, then delete the app and reinstall a clean build.',
    );
  }
  if (
    code === '23' ||
    /no App Store products registered/i.test(msg) ||
    /offerings.*empty|configured the SDK with an App Store API key/i.test(msg)
  ) {
    return new Error(
      'RevenueCat has no store products in your offerings yet. In RevenueCat: Products → add them, then Offerings → attach packages. Products must also exist in App Store Connect or Play Console. See docs/IAP_SETUP.md.',
    );
  }
  if (/web not supported/i.test(msg)) {
    return new Error('In-app purchases only work in the iPhone or Android app, not in a browser.');
  }
  return e instanceof Error ? e : new Error(msg);
}

export function assertUsableApiKey({ name, key, prefix }: PlatformApiKey): void {
  if (!key) {
    throw new Error(`${name} is missing. Add the public SDK key (${prefix}…) and rebuild.`);
  }
  if (key.startsWith('sk_') || key.startsWith('rcb_')) {
    throw new Error(`${name} must be the public SDK key (${prefix}…), not a secret key.`);
  }
  if (key.startsWith('test_')) {
    throw new Error(`${name} is a Test Store key (test_…). Use the public key (${prefix}…) and rebuild.`);
  }
  if (!key.startsWith(prefix)) {
    throw new Error(`${name} must start with ${prefix} (RevenueCat → Project settings → API keys).`);
  }
}

function getPurchasesHeader(): PluginHeader | undefined {
  return getCapBridge().PluginHeaders?.find((h) => h.name === 'Purchases');
}

/**
 * Call native Purchases via Capacitor.nativePromise directly.
 * Avoids @revenuecat/purchases-capacitor's registerPlugin() proxy, which can
 * permanently close over a null PluginHeader and always throw UNIMPLEMENTED
 * even when the native plugin is registered.
 */
async function purchasesCall<T>(method: string, options: Record<string, unknown> = {}): Promise<T> {
  const cap = getCapBridge();
  const header = getPurchasesHeader();
  if (!header) {
    const names = (cap.PluginHeaders || []).map((h) => h.name);
    console.error('[RevenueCat] PluginHeaders missing Purchases. Have:', names);
    throw mapIapError({ code: 'UNIMPLEMENTED' });
  }
  if (!header.methods.some((m) => m.name === method)) {
    throw new Error(`Purchases.${method} is not exported by the native plugin headers.`);
  }
  if (!cap.nativePromise) {
    throw new Error('Capacitor native bridge is missing nativePromise.');
  }

  // Use nativePromise for all methods — RC plugin methods call resolve() even when
  // declared as CAPPluginReturnNone (e.g. configure / setLogLevel).
  return (await cap.nativePromise('Purchases', method, options)) as T;
}

export async function configureRevenueCat(): Promise<void> {
  if (configured || !canUseStorePlans()) return;
  if (!Capacitor.isNativePlatform()) return;

  const apiKey = platformApiKey();
  if (!apiKey.key) {
    console.warn(`[RevenueCat] ${apiKey.name} is not set`);
    return;
  }
  assertUsableApiKey(apiKey);

  // Verbose SDK logs only in development builds.
  if (import.meta.env.DEV) {
    try {
      const { LOG_LEVEL } = await import('@revenuecat/purchases-capacitor');
      await purchasesCall('setLogLevel', { level: LOG_LEVEL.DEBUG as LOG_LEVEL });
    } catch (e) {
      console.warn('[RevenueCat] setLogLevel optional failed', e);
    }
  }

  try {
    await purchasesCall('configure', { apiKey: apiKey.key });
    configured = true;
    console.log('[RevenueCat] configured via nativePromise', {
      header: !!getPurchasesHeader(),
      apiKeyPrefix: apiKey.key.slice(0, 5),
      pluginNames: (getCapBridge().PluginHeaders || []).map((h) => h.name),
    });
  } catch (e) {
    configured = false;
    console.error('[RevenueCat] configure failed', e);
    throw mapIapError(e);
  }
}

export async function loginRevenueCatUser(appUserId: string): Promise<void> {
  if (!configured) await configureRevenueCat();
  if (!configured) return;
  try {
    await purchasesCall('logIn', { appUserID: appUserId });
  } catch (e) {
    console.error('[RevenueCat] logIn failed', e);
    throw mapIapError(e);
  }
}

export async function logoutRevenueCatUser(): Promise<void> {
  if (!configured) return;
  try {
    await purchasesCall('logOut');
  } catch {
    /* ignore */
  }
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    const result = await purchasesCall<{ customerInfo: CustomerInfo }>('getCustomerInfo');
    return result.customerInfo;
  } catch (e) {
    throw mapIapError(e);
  }
}

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!configured) return null;
  try {
    return await withTimeout(purchasesCall<PurchasesOfferings>('getOfferings'), OFFERINGS_TIMEOUT_MS, 'getOfferings');
  } catch (e) {
    throw mapIapError(e);
  }
}

function findPackageByProductId(
  packages: PurchasesPackage[] | undefined,
  productId: string,
): PurchasesPackage | undefined {
  return packages?.find(
    (p) =>
      p.product.identifier === productId ||
      (p as { product?: { productIdentifier?: string } }).product?.productIdentifier === productId,
  );
}

async function purchaseViaStoreProduct(productId: string): Promise<CustomerInfo> {
  console.log('[RevenueCat] fallback getProducts', productId);
  const { products } = await withTimeout(
    purchasesCall<{ products: PurchasesStoreProduct[] }>('getProducts', {
      productIdentifiers: [productId],
    }),
    OFFERINGS_TIMEOUT_MS,
    'getProducts',
  );
  const product = products?.[0];
  if (!product) {
    throw new Error(
      `Product ${productId} was not returned by the store. Confirm it exists in App Store Connect or Play Console, is in RevenueCat offerings, and the store agreements are active.`,
    );
  }
  console.log('[RevenueCat] purchaseStoreProduct', productId);
  const { customerInfo } = await withTimeout(
    purchasesCall<{ customerInfo: CustomerInfo }>('purchaseStoreProduct', { product }),
    PURCHASE_TIMEOUT_MS,
    'purchaseStoreProduct',
  );
  return customerInfo;
}

export async function purchaseProductById(productId: string): Promise<CustomerInfo> {
  if (!configured) await configureRevenueCat();
  if (!configured) {
    throw new Error('In-app purchases are not available on this device.');
  }
  if (!getPurchasesHeader()) {
    throw mapIapError({ code: 'UNIMPLEMENTED' });
  }

  assertUsableApiKey(platformApiKey());

  try {
    console.log('[RevenueCat] purchase start', productId);

    let pkg: PurchasesPackage | undefined;
    try {
      const offerings = await withTimeout(
        purchasesCall<PurchasesOfferings>('getOfferings'),
        OFFERINGS_TIMEOUT_MS,
        'getOfferings',
      );
      const allPkgs = [
        ...(offerings.current?.availablePackages ?? []),
        ...(offerings.all?.[IAP_OFFERING_DEFAULT]?.availablePackages ?? []),
        ...(offerings.all?.[IAP_OFFERING_LEAD_UNLOCK]?.availablePackages ?? []),
        ...Object.values(offerings.all || {}).flatMap((o) => o.availablePackages ?? []),
      ];
      const availableIds = [
        ...new Set(
          allPkgs.map(
            (p) =>
              p.product?.identifier ||
              (p as { product?: { productIdentifier?: string } }).product?.productIdentifier ||
              '?',
          ),
        ),
      ];
      console.log('[RevenueCat] offerings packages', availableIds);
      pkg = findPackageByProductId(allPkgs, productId);
    } catch (offeringsErr) {
      console.warn('[RevenueCat] getOfferings failed; trying StoreKit product fetch', offeringsErr);
    }

    if (pkg) {
      console.log('[RevenueCat] purchasePackage', productId);
      const { customerInfo } = await withTimeout(
        purchasesCall<{ customerInfo: CustomerInfo }>('purchasePackage', { aPackage: pkg }),
        PURCHASE_TIMEOUT_MS,
        'purchasePackage',
      );
      return customerInfo;
    }

    console.warn('[RevenueCat] product missing from offerings; trying StoreKit fetch', productId);
    return await purchaseViaStoreProduct(productId);
  } catch (e) {
    console.error('[RevenueCat] purchase failed', productId, e);
    throw mapIapError(e);
  }
}

/** The company plans' packages from RevenueCat, with the store's own prices. Empty when the offering isn't set up. */
export async function getStorePlanPackages(): Promise<PurchasesPackage[]> {
  if (!configured) await configureRevenueCat();
  if (!configured) return [];
  const offerings = await getOfferings();
  return offerings?.all?.[STORE_PLAN_OFFERING]?.availablePackages ?? [];
}

/** The package for a plan: by its RevenueCat package id, or by this platform's product id. */
export function storePlanPackage(packages: PurchasesPackage[], plan: StorePlanKey): PurchasesPackage | undefined {
  const { packageId, apple, google } = STORE_PLANS[plan];
  return packages.find((p) => p.identifier === packageId) ?? findPackageByProductId(packages, isNativeAndroid() ? google : apple);
}

/** Buys a company plan through the App Store or Google Play. The webhook then writes the company's plan. */
export async function purchaseStorePlan(plan: StorePlanKey): Promise<CustomerInfo> {
  const packages = await getStorePlanPackages();
  const pkg = storePlanPackage(packages, plan);
  if (!pkg) throw new Error('This plan is not available in the store yet. Please try again later.');
  try {
    const { customerInfo } = await withTimeout(
      purchasesCall<{ customerInfo: CustomerInfo }>('purchasePackage', { aPackage: pkg }),
      PURCHASE_TIMEOUT_MS,
      'purchasePackage',
    );
    return customerInfo;
  } catch (e) {
    console.error('[RevenueCat] plan purchase failed', plan, e);
    throw mapIapError(e);
  }
}

export async function purchaseLeadUnlockTier(leadPriceUsd: number): Promise<{
  customerInfo: CustomerInfo;
  productId: string;
  tierPriceUsd: number;
}> {
  const tier = pickLeadUnlockTier(leadPriceUsd);
  const customerInfo = await purchaseProductById(tier.productId);
  return {
    customerInfo,
    productId: tier.productId,
    tierPriceUsd: tier.priceUsd,
  };
}

export async function restorePurchases(): Promise<CustomerInfo> {
  if (!configured) await configureRevenueCat();
  if (!configured) {
    throw new Error('In-app purchases are not available on this device.');
  }
  try {
    const { customerInfo } = await withTimeout(
      purchasesCall<{ customerInfo: CustomerInfo }>('restorePurchases'),
      OFFERINGS_TIMEOUT_MS,
      'restorePurchases',
    );
    return customerInfo;
  } catch (e) {
    throw mapIapError(e);
  }
}

export async function purchaseCredits250() {
  return purchaseProductById(IAP_PRODUCTS.credits250);
}

export async function purchaseCredits500() {
  return purchaseProductById(IAP_PRODUCTS.credits500);
}

export async function purchaseMarketing() {
  return purchaseProductById(IAP_PRODUCTS.marketingMonthly);
}

export async function purchaseDma() {
  return purchaseProductById(IAP_PRODUCTS.dmaMonthly);
}

export function isRevenueCatNativeReady(): boolean {
  return canUseStorePlans() && Capacitor.isNativePlatform() && !!getPurchasesHeader();
}
