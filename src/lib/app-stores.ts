// Central source of truth for the TREECHECK mobile app store links.

export const APP_STORE_URL = "https://apps.apple.com/us/app/treecheck/id6773013691";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.treecheck.app";

// Set to `true` once the app is actually listed in both stores.
// While false, /get shows a "coming soon" page instead of forwarding.
export const APP_LIVE_IN_STORES = true;

// Public URL the trade-show / desktop QR code encodes.
export const INSTALL_LANDING_URL = "https://app.treecheck.ai/get";

export type StoreDevice = "ios" | "android" | "other";

export function detectStoreDevice(ua: string, maxTouchPoints = 0): StoreDevice {
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  // iPadOS reports itself as Mac; touch points give it away.
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** Store URL to forward to, or null when we should show the buttons page. */
export function storeRedirectFor(device: StoreDevice, live = APP_LIVE_IN_STORES): string | null {
  if (!live) return null;
  if (device === "ios") return APP_STORE_URL;
  if (device === "android") return PLAY_STORE_URL;
  return null;
}
