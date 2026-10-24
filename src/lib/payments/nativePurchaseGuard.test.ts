// Payments milestone, step 0 (2026-10-21): with Stripe on a live key, the phone apps must not start a Stripe purchase,
// and the two broken legacy checkouts answer plainly. These read the functions' source, the same way as
// src/lib/onboarding/signupGuards.test.ts, so a later edit that drops a guard fails the suite.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromNativeApp, NATIVE_PURCHASE_REFUSAL } from "../../../supabase/functions/_shared/nativeClient";

const FUNCTIONS = join(process.cwd(), "supabase", "functions");
// Line endings normalised: a Windows checkout has CRLF, the repo has LF.
const source = (fn: string) => readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8").replace(/\r\n/g, "\n");
const request = (origin?: string) => ({
  headers: { get: (name: string) => (name.toLowerCase() === "origin" ? origin ?? null : null) },
});

describe("fromNativeApp", () => {
  it("treats a request with no Origin as the app, because CapacitorHttp sends none", () => {
    expect(fromNativeApp(request())).toBe(true);
    expect(fromNativeApp(request(""))).toBe(true);
  });
  it("treats the WebView origins as the app", () => {
    expect(fromNativeApp(request("https://localhost"))).toBe(true);
    expect(fromNativeApp(request("capacitor://localhost"))).toBe(true);
    expect(fromNativeApp(request(" Capacitor://Localhost "))).toBe(true);
  });
  it("lets the web app, Lovable's preview and a local dev server through", () => {
    expect(fromNativeApp(request("https://app.treecheck.ai"))).toBe(false);
    expect(fromNativeApp(request("https://id-preview--e3013694-b5da-43cc-b585-a322f76f581c.lovable.app"))).toBe(false);
    expect(fromNativeApp(request("http://localhost:8080"))).toBe(false);
  });
  it("doesn't point anyone to another place to pay", () => {
    expect(NATIVE_PURCHASE_REFUSAL).not.toMatch(/web|site|online|\.ai|\.com/i);
  });
});

// Every function that starts a Stripe charge or checkout asks fromNativeApp before its handler's first Stripe call.
const GUARDED = [
  "create-scout-checkout",
  "create-pro-checkout",
  "buy-credits",
  "create-marketing-checkout",
  "create-dma-subscription",
  "setup-payment-method",
  "manage-team-seat",
  "company-billing",
  "purchase-lead",
];
const STRIPE_CALL = /new Stripe\(|stripe\.[a-zA-Z]+\.[a-zA-Z]+\(/;

describe("payment functions refuse the phone apps before touching Stripe", () => {
  for (const fn of GUARDED) {
    it(fn, () => {
      const code = source(fn);
      expect(code).toMatch(/from ['"]\.\.\/_shared\/nativeClient\.ts['"]/);
      const handler = code.search(/(Deno\.)?serve\(/);
      expect(handler).toBeGreaterThan(0);
      const guard = code.indexOf("fromNativeApp(req)", handler);
      const firstStripe = handler + code.slice(handler).search(STRIPE_CALL);
      expect(guard).toBeGreaterThan(handler);
      expect(firstStripe).toBeGreaterThan(handler);
      expect(guard).toBeLessThan(firstStripe);
    });
  }

  it("company-billing refuses only checkout, paid upgrades and the Stripe portal, so status and seat assignment still work in the apps", () => {
    expect(source("company-billing")).toMatch(
      /\(body\.action === 'checkout' \|\| body\.action === 'confirm_purchase' \|\| body\.action === 'portal'\) && fromNativeApp\(req\)/,
    );
  });
  it("manage-team-seat refuses only adding seats from the apps", () => {
    expect(source("manage-team-seat")).toContain("fromNativeApp(req) && desiredQty > (existing?.seat_quantity ?? 0)");
  });
  it("purchase-lead keeps credit unlocks in the apps but never charges a card or auto-renews from them", () => {
    const code = source("purchase-lead");
    expect(code).toContain("if (nativeApp && cardChargeCents > 0) return nativePurchaseRefusal(corsHeaders);");
    expect(code).toMatch(/if \(isPremium && newBalance <= 0 && stripe && profile\.stripe_customer_id && !nativeApp\)/);
  });
});

describe("legacy checkouts on the live key", () => {
  it("the $50 + $35 Scout checkout answers plainly instead of failing on test-only prices", () => {
    const code = source("create-scout-checkout");
    const refusal = code.indexOf("if (stripeTakesRealCards(stripeKey)) {");
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(code.indexOf("new Stripe("));
    expect(code.slice(refusal, refusal + 300)).toContain("status: 409");
  });
  it("the $500 Premium checkout stays closed, because nothing grants Premium after it", () => {
    const code = source("create-pro-checkout");
    expect(code).toContain("const PREMIUM_CHECKOUT_OPEN = false;");
    const closed = code.indexOf("if (!PREMIUM_CHECKOUT_OPEN) {");
    expect(closed).toBeGreaterThan(0);
    expect(closed).toBeLessThan(code.indexOf("new Stripe("));
  });
});
