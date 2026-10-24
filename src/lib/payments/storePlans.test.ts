// Phone plans (payments milestone, Part B): what each RevenueCat event does to the owner's company_billing row, for
// both stores and every event type, plus the old $50 iPhone plan's fixes and the source guards around them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isStorePlanEvent,
  legacyDemoUpdate,
  planRunning,
  STORE_PLAN_PRODUCTS,
  storePlanDecision,
  type StoreBillingRow,
  type StoreEvent,
} from "../../../supabase/functions/_shared/storePlans";
import { STORE_PLANS } from "@/lib/iapProducts";

const FUNCTIONS = join(process.cwd(), "supabase", "functions");
const source = (fn: string) => readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8").replace(/\r\n/g, "\n");
const shared = (file: string) => readFileSync(join(FUNCTIONS, "_shared", file), "utf8").replace(/\r\n/g, "\n");

const NOW = Date.parse("2026-10-22T12:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString();

const apple = (over: Partial<StoreEvent> = {}): StoreEvent => ({
  type: "INITIAL_PURCHASE", store: "APP_STORE", environment: "PRODUCTION", period_type: "TRIAL",
  product_id: "treecheck_core_scout_monthly", expiration_at_ms: NOW + 14 * DAY, ...over,
});
const google = (over: Partial<StoreEvent> = {}): StoreEvent => apple({ store: "PLAY_STORE", product_id: "treecheck_core_scout:monthly", ...over });
const open = { sandboxAllowed: false, blocker: null, now: NOW };

/** An App Store plan row as the webhook leaves it. */
const appleRow = (over: Partial<NonNullable<StoreBillingRow>> = {}): StoreBillingRow => ({
  pricing_version: "2026-10", provider: "app_store", environment: "live", status: "active",
  stripe_subscription_id: null, complimentary: false, trial_ends_at: null, current_period_end: at(NOW + 10 * DAY),
  capacity: { ownerScout: false }, ...over,
});
const write = (d: ReturnType<typeof storePlanDecision>) => {
  if (d.kind !== "write") throw new Error(`expected a write, got ${JSON.stringify(d)}`);
  return d.update;
};

describe("phone plan products", () => {
  it("the server and the app name the same six products with the same seats and billing period", () => {
    const fromApp = Object.values(STORE_PLANS).flatMap((p) => [
      [p.apple, { ownerScout: p.ownerScout, interval: p.interval }],
      [p.google, { ownerScout: p.ownerScout, interval: p.interval }],
    ]);
    expect(Object.fromEntries(fromApp)).toEqual(STORE_PLAN_PRODUCTS);
  });
  it("only plan events are phone plan events; a product change counts when either side is a plan", () => {
    expect(isStorePlanEvent(apple())).toBe(true);
    expect(isStorePlanEvent(google())).toBe(true);
    expect(isStorePlanEvent(apple({ product_id: "treecheck_credits_250" }))).toBe(false);
    expect(isStorePlanEvent(apple({ product_id: "treecheck_demo_monthly" }))).toBe(false);
    expect(isStorePlanEvent(apple({ type: "PRODUCT_CHANGE", product_id: "treecheck_demo_monthly", new_product_id: "treecheck_core_monthly" }))).toBe(true);
    expect(isStorePlanEvent(apple({ type: "PRODUCT_CHANGE", product_id: "treecheck_core_monthly", new_product_id: "treecheck_demo_monthly" }))).toBe(true);
    expect(storePlanDecision(apple({ product_id: "treecheck_dma_monthly" }), null, open)).toEqual({ kind: "not_plan" });
  });
});

describe("purchases and renewals", () => {
  it("an App Store trial puts a new company on the plans, trialing, with the owner's Scout", () => {
    expect(write(storePlanDecision(apple(), null, open))).toEqual({
      pricing_version: "2026-10", provider: "app_store", environment: "live", status: "trialing",
      billing_interval: "month", capacity: { scout: 0, manager: 0, field: 2, ownerScout: true },
      trial_ends_at: at(NOW + 14 * DAY), current_period_end: at(NOW + 14 * DAY), pending_renewal: null,
    });
  });
  it("a paid Google Play purchase of Core yearly is active, yearly, without the owner's Scout", () => {
    const u = write(storePlanDecision(google({ period_type: "NORMAL", product_id: "treecheck_core:yearly", expiration_at_ms: NOW + 365 * DAY }), null, open));
    expect(u).toMatchObject({ provider: "play_store", status: "active", billing_interval: "year", capacity: { ownerScout: false }, current_period_end: at(NOW + 365 * DAY) });
    expect(u).not.toHaveProperty("trial_ends_at");
  });
  it("a renewal makes the plan active to its new end and applies a product chosen for the renewal", () => {
    const row = appleRow({ status: "trialing", trial_ends_at: at(NOW), capacity: { ownerScout: true } });
    const u = write(storePlanDecision(apple({ type: "RENEWAL", period_type: "NORMAL", product_id: "treecheck_core_monthly", expiration_at_ms: NOW + 30 * DAY }), row, open));
    expect(u).toMatchObject({ status: "active", current_period_end: at(NOW + 30 * DAY), capacity: { ownerScout: false }, pending_renewal: null });
  });
  it("environment is always written: live for production, sandbox only for owners on the sandbox list", () => {
    expect(storePlanDecision(apple({ environment: "SANDBOX" }), null, open)).toMatchObject({ kind: "skip" });
    expect(write(storePlanDecision(apple({ environment: "SANDBOX" }), null, { ...open, sandboxAllowed: true }))).toMatchObject({ environment: "sandbox" });
    expect(write(storePlanDecision(apple(), null, open))).toMatchObject({ environment: "live" });
  });
});

describe("one plan per company", () => {
  it("never overwrites a website plan that is running", () => {
    const web = appleRow({ provider: "stripe", stripe_subscription_id: "sub_1", status: "active" });
    expect(storePlanDecision(apple(), web, open)).toEqual({ kind: "skip", reason: "company pays on the website" });
  });
  it("never overwrites the other store's running plan, or a complimentary company", () => {
    expect(storePlanDecision(google(), appleRow(), open)).toEqual({ kind: "skip", reason: "company has a plan in the other store" });
    expect(storePlanDecision(apple(), appleRow({ provider: "stripe", complimentary: true }), open)).toEqual({ kind: "skip", reason: "complimentary company" });
  });
  it("takes over a plan that has ended, and a signup that never paid", () => {
    const ended = appleRow({ provider: "stripe", stripe_subscription_id: "sub_old", status: "canceled", current_period_end: at(NOW - DAY) });
    expect(write(storePlanDecision(google(), ended, open))).toMatchObject({ provider: "play_store", status: "trialing" });
    expect(write(storePlanDecision(apple(), appleRow({ provider: "stripe", status: "incomplete", current_period_end: null }), open))).toMatchObject({ provider: "app_store" });
  });
  it("a company not on the plans yet moves only when nothing blocks it", () => {
    const legacy = { pricing_version: "legacy", provider: "stripe", environment: "sandbox", status: "unconfigured" };
    expect(storePlanDecision(apple(), legacy, { ...open, blocker: "Contact us to move your team to the new plans." }))
      .toEqual({ kind: "skip", reason: "Contact us to move your team to the new plans." });
    expect(write(storePlanDecision(apple(), legacy, open))).toMatchObject({ pricing_version: "2026-10", provider: "app_store" });
  });
  it("events that aren't purchases only touch this store's own row", () => {
    expect(storePlanDecision(apple({ type: "CANCELLATION" }), null, open)).toMatchObject({ kind: "skip" });
    expect(storePlanDecision(google({ type: "EXPIRATION" }), appleRow(), open)).toMatchObject({ kind: "skip" });
    expect(storePlanDecision(apple({ type: "EXPIRATION", environment: "SANDBOX" }), appleRow(), { ...open, sandboxAllowed: true })).toMatchObject({ kind: "skip" });
  });
  it("other stores and unknown events are skipped, never written", () => {
    expect(storePlanDecision(apple({ store: "PROMOTIONAL" }), null, open)).toMatchObject({ kind: "skip" });
    expect(storePlanDecision(apple({ store: "STRIPE" }), null, open)).toMatchObject({ kind: "skip" });
    expect(storePlanDecision(apple({ type: "TRANSFER" }), appleRow(), open)).toMatchObject({ kind: "skip" });
    expect(storePlanDecision(apple({ environment: "UNKNOWN" }), null, open)).toMatchObject({ kind: "skip" });
  });
});

describe("cancellation, billing issues and expiry", () => {
  it("turning auto-renew off keeps access to the end and marks the cancellation", () => {
    const end = NOW + 10 * DAY;
    const u = write(storePlanDecision(apple({ type: "CANCELLATION", period_type: "NORMAL", expiration_at_ms: end }), appleRow(), open));
    expect(u).toEqual({ pending_renewal: { cancellation: true, effectiveAt: Math.floor(end / 1000) }, current_period_end: at(end) });
    expect(planRunning({ ...appleRow(), ...u } as StoreBillingRow, NOW)).toBe(true);
  });
  it("a trial cancelled keeps the trial to its end", () => {
    const u = write(storePlanDecision(apple({ type: "CANCELLATION" }), appleRow({ status: "trialing", trial_ends_at: at(NOW + 14 * DAY) }), open));
    expect(u).toMatchObject({ trial_ends_at: at(NOW + 14 * DAY) });
  });
  it("a refund (a cancellation that expires now) ends access", () => {
    const u = write(storePlanDecision(apple({ type: "CANCELLATION", period_type: "NORMAL", expiration_at_ms: NOW - 1000 }), appleRow(), open));
    expect(planRunning({ ...appleRow(), ...u } as StoreBillingRow, NOW)).toBe(false);
  });
  it("turning auto-renew back on clears the cancellation", () => {
    expect(write(storePlanDecision(apple({ type: "UNCANCELLATION", period_type: "NORMAL" }), appleRow(), open)))
      .toMatchObject({ pending_renewal: null });
  });
  it("a billing issue leaves the status and carries access through the store's grace period", () => {
    const grace = NOW + 16 * DAY;
    const u = write(storePlanDecision(google({ type: "BILLING_ISSUE", period_type: "NORMAL", expiration_at_ms: grace }), appleRow({ provider: "play_store", current_period_end: at(NOW - DAY) }), open));
    expect(u).toEqual({ current_period_end: at(grace) });
    expect(u).not.toHaveProperty("status");
    const trial = write(storePlanDecision(apple({ type: "BILLING_ISSUE", expiration_at_ms: grace }), appleRow({ status: "trialing", trial_ends_at: at(NOW - DAY) }), open));
    expect(trial).toMatchObject({ trial_ends_at: at(grace) });
  });
  it("expiry ends the plan", () => {
    expect(write(storePlanDecision(apple({ type: "EXPIRATION", period_type: "NORMAL", expiration_at_ms: NOW }), appleRow(), open)))
      .toEqual({ status: "canceled", pending_renewal: null, current_period_end: at(NOW) });
  });
});

describe("product changes", () => {
  it("reads the new product: adding the owner's Scout applies at once", () => {
    const change = apple({ type: "PRODUCT_CHANGE", product_id: "treecheck_core_monthly", new_product_id: "treecheck_core_scout_monthly" });
    expect(write(storePlanDecision(change, appleRow(), open))).toEqual({ capacity: { scout: 0, manager: 0, field: 2, ownerScout: true } });
  });
  it("a downgrade or a new billing period waits for the renewal", () => {
    const down = apple({ type: "PRODUCT_CHANGE", product_id: "treecheck_core_scout_monthly", new_product_id: "treecheck_core_monthly" });
    expect(storePlanDecision(down, appleRow({ capacity: { ownerScout: true } }), open)).toMatchObject({ kind: "skip" });
    const yearly = google({ type: "PRODUCT_CHANGE", product_id: "treecheck_core:monthly", new_product_id: "treecheck_core:yearly" });
    expect(storePlanDecision(yearly, appleRow({ provider: "play_store" }), open)).toMatchObject({ kind: "skip" });
  });
  it("a switch from the old $50 iPhone plan moves the company onto the plans, unless something blocks it", () => {
    const fromDemo = apple({ type: "PRODUCT_CHANGE", period_type: "NORMAL", product_id: "treecheck_demo_monthly", new_product_id: "treecheck_core_scout_monthly", expiration_at_ms: NOW + 20 * DAY });
    expect(write(storePlanDecision(fromDemo, null, open))).toMatchObject({ pricing_version: "2026-10", provider: "app_store", status: "active", current_period_end: at(NOW + 20 * DAY) });
    expect(storePlanDecision(fromDemo, null, { ...open, blocker: "blocked" })).toEqual({ kind: "skip", reason: "blocked" });
  });
  it("a switch from a plan to a product outside the plans is logged, not written", () => {
    const out = apple({ type: "PRODUCT_CHANGE", product_id: "treecheck_core_monthly", new_product_id: "treecheck_demo_monthly" });
    expect(storePlanDecision(out, appleRow(), open)).toMatchObject({ kind: "skip" });
  });
});

describe("the old $50 iPhone plan", () => {
  const demo = (over: Partial<StoreEvent> = {}) => apple({ product_id: "treecheck_demo_monthly", ...over });
  it("a trial gets its real end date instead of never expiring", () => {
    expect(legacyDemoUpdate(demo())).toEqual({ profile: { subscription_tier: "demo_trial", is_active: true, trial_ends_at: at(NOW + 14 * DAY) }, entitlements: null });
  });
  it("a renewal grants access through the entitlement rows Stripe writes", () => {
    expect(legacyDemoUpdate(demo({ type: "RENEWAL", period_type: "NORMAL", expiration_at_ms: NOW + 30 * DAY }))).toEqual({
      profile: { subscription_tier: "demo_paid", is_active: true, subscription_ends_at: at(NOW + 30 * DAY) },
      entitlements: { status: "active", current_period_end: at(NOW + 30 * DAY) },
    });
  });
  it("turning auto-renew off no longer takes access away before it expires", () => {
    const paid = legacyDemoUpdate(demo({ type: "CANCELLATION", period_type: "NORMAL", expiration_at_ms: NOW + 9 * DAY }));
    expect(paid.profile).not.toHaveProperty("subscription_tier");
    expect(paid.entitlements).toEqual({ status: "active", current_period_end: at(NOW + 9 * DAY) });
    expect(legacyDemoUpdate(demo({ type: "CANCELLATION" }))).toEqual({ profile: { trial_ends_at: at(NOW + 14 * DAY) }, entitlements: null });
  });
  it("expiry ends it", () => {
    expect(legacyDemoUpdate(demo({ type: "EXPIRATION", period_type: "NORMAL", expiration_at_ms: NOW }))).toEqual({
      profile: { subscription_tier: "free" }, entitlements: { status: "canceled", current_period_end: at(NOW) },
    });
  });
  it("writes nothing without an end date, so no row can last forever", () => {
    expect(legacyDemoUpdate(demo({ type: "RENEWAL", expiration_at_ms: null }))).toEqual({ profile: null, entitlements: null });
  });
});

describe("source guards", () => {
  it("the webhook accepts either secret and refuses everything when neither is set", () => {
    const code = source("revenuecat-webhook");
    expect(code).toContain('Deno.env.get("REVENUECAT_WEBHOOK_SECRET")');
    expect(code).toContain('Deno.env.get("REVENUECAT_WEBHOOK_SECRET_V2")');
    expect(code).toContain('if (!secrets.some((s) => auth === `Bearer ${s}`)) return json({ error: "Unauthorized" }, 401);');
    expect(code).not.toContain("if (secret && auth");
  });
  it("the webhook writes plans only through storePlanDecision, and the old plan no longer revokes on cancellation", () => {
    const code = source("revenuecat-webhook");
    expect(code).toContain("storePlanDecision(event, row, {");
    expect(code).toContain("legacyDemoUpdate(event)");
    expect(code).not.toContain('subscription_tier: type === "INITIAL_PURCHASE" ? "demo_trial" : "demo_paid"');
  });
  it("company-billing guards only Stripe actions for a phone plan, and reconciles only website plans", () => {
    const code = source("company-billing");
    expect(code).toContain("const STORE_PLAN_ACTIONS = new Set(['status', 'preview', 'save_access', 'remove']);");
    expect(code).toContain("billing.provider === 'stripe' && billing.environment === env");
    expect(code).not.toContain("Company seat purchases require Apple configuration");
    expect(code).toContain("if (store) return json({ error: 'Your phone plan includes the owner and two Field users.");
    expect(code).toContain("if (store === 'stripe') store = null;");
  });
  it("reconcile and the reminders leave a phone plan alone", () => {
    expect(shared("companyReconcile.ts")).toContain("if (billing.provider && billing.provider !== 'stripe') throw new ReconcileSkip(");
    expect(source("billing-reminders")).toContain('.eq("provider", "stripe")');
  });
  it("uses no dashes in any new text", () => {
    for (const text of [shared("storePlans.ts"), shared("storePlanBlocker.ts"), source("revenuecat-webhook")]) {
      expect(text).not.toMatch(/[–—]/);
    }
  });
});
