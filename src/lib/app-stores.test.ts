import { describe, it, expect } from "vitest";
import { detectStoreDevice, storeRedirectFor, APP_STORE_URL, PLAY_STORE_URL } from "./app-stores";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120";

describe("/get store forwarding", () => {
  it("iPhone goes to the App Store when live", () => {
    expect(storeRedirectFor(detectStoreDevice(IPHONE), true)).toBe(APP_STORE_URL);
  });
  it("Android goes to Google Play when live", () => {
    expect(storeRedirectFor(detectStoreDevice(ANDROID), true)).toBe(PLAY_STORE_URL);
  });
  it("desktop is not forwarded", () => {
    expect(storeRedirectFor(detectStoreDevice(DESKTOP), true)).toBeNull();
  });
  it("nothing forwards while the switch is off", () => {
    expect(storeRedirectFor("ios", false)).toBeNull();
    expect(storeRedirectFor("android", false)).toBeNull();
  });
});
