// Payments milestone, website (PR 1): the company plans run on the live Stripe key behind the billing_rollout switch.
// Pure helpers are tested directly; the edge functions are checked by reading their source, as in signupGuards.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plansOpenFor, ROLLOUT_CLOSED } from "../../../supabase/functions/_shared/billingRollout";
import { companyPriceIds, COMPANY_PRICE_IDS, COMPANY_PRICE_IDS_LIVE } from "../../../supabase/functions/_shared/companyPriceIds";
import { billingBannerKind } from "@/lib/billing/bannerKind";
import { plansOpenOnWeb } from "@/hooks/useBillingRollout";

const FUNCTIONS = join(process.cwd(), "supabase", "functions");
const source = (fn: string) => readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8").replace(/\r\n/g, "\n");
const shared = (file: string) => readFileSync(join(FUNCTIONS, "_shared", file), "utf8").replace(/\r\n/g, "\n");
const OWNER = "aaaaaaaa-0000-0000-0000-000000000001";

describe("the switch", () => {
  it("is closed by default, even for a known owner", () => {
    expect(plansOpenFor(ROLLOUT_CLOSED, OWNER)).toBe(false);
    expect(plansOpenFor(ROLLOUT_CLOSED, null)).toBe(false);
  });
  it("opens for a listed test owner only, before web_live", () => {
    const rollout = { ...ROLLOUT_CLOSED, testOwnerIds: [OWNER] };
    expect(plansOpenFor(rollout, OWNER)).toBe(true);
    expect(plansOpenFor(rollout, "bbbbbbbb-0000-0000-0000-000000000002")).toBe(false);
    expect(plansOpenFor(rollout, null)).toBe(false);
  });
  it("opens for everyone, new signups included, with web_live", () => {
    expect(plansOpenFor({ ...ROLLOUT_CLOSED, webLive: true }, null)).toBe(true);
  });
  it("never opens in the phone apps", () => {
    expect(plansOpenOnWeb({ webLive: true, testOwner: true }, true)).toBe(false);
    expect(plansOpenOnWeb({ webLive: true, testOwner: false }, false)).toBe(true);
    expect(plansOpenOnWeb(undefined, false)).toBe(false);
  });
});

describe("prices follow the key's mode", () => {
  it("picks live prices on a live key and test prices on a test key", () => {
    expect(companyPriceIds(true)).toBe(COMPANY_PRICE_IDS_LIVE);
    expect(companyPriceIds(false)).toBe(COMPANY_PRICE_IDS);
  });
  it("the two maps share no price", () => {
    const ids = (m: typeof COMPANY_PRICE_IDS | typeof COMPANY_PRICE_IDS_LIVE) => [...Object.values(m.month), ...Object.values(m.year)];
    expect(ids(COMPANY_PRICE_IDS).filter((id) => ids(COMPANY_PRICE_IDS_LIVE).includes(id))).toEqual([]);
  });
  it("company-billing and reconcile use the mode's map, never the test map directly", () => {
    const billing = source("company-billing");
    expect(billing).toContain("const PRICE_IDS = companyPriceIds(live);");
    expect(billing).not.toMatch(/COMPANY_PRICE_IDS\b/);
    expect(shared("companyReconcile.ts")).toContain("companyPriceIds(sub.livemode)");
  });
});

describe("company-billing on the live key", () => {
  const code = source("company-billing");
  it("has no test-only lock left", () => {
    expect(code).not.toContain("sk_test_");
    expect(code).not.toContain("available for Stripe test accounts only");
    expect(code).not.toContain("environment: 'sandbox'");
    expect(code).not.toMatch(/\b(sub|current|price)\.livemode \|\|/);
  });
  it("charges only a row on the key's own mode", () => {
    expect(code).toContain("if (!key || billing.environment !== env)");
  });
  it("gives Stripe a trial end it accepts and cancels a trial left without a card", () => {
    expect(code).toContain("const trialEnd = checkoutTrialEnd(billing.trial_ends_at, Date.now());");
    expect(code).toContain("trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }");
    expect(code).not.toContain("Convert after it ends");
  });
  it("moves an owner to the plans only when they choose to pay, and never a protected, Apple or team company", () => {
    const convert = code.slice(code.indexOf("async function convertToPlans"), code.indexOf("Deno.serve"));
    expect(convert).toContain("plansOpenFor(await billingRollout(admin), owner)");
    for (const guard of ["owner === TIMBER_OWNER", "profile.is_founder", "profile.stripe_subscription_id", "from('iap_events')", "eq('parent_contractor_id', owner)", "from('product_entitlements')"]) {
      expect(convert).toContain(guard);
    }
    expect(code).toContain("if (body.action === 'checkout' && !profile.is_sandbox && (!billing || billing.pricing_version !== '2026-10'))");
  });
  it("a new plan choice gets a fresh Stripe page: open old pages are expired, never reopened", () => {
    const checkout = code.slice(code.indexOf("if (body.action === 'checkout') {"), code.indexOf("if (body.action === 'remove') {"));
    expect(checkout).not.toContain("return json({ url: oldSession.url })");
    expect(checkout).toContain("try { await stripe.checkout.sessions.expire(oldSession.id); continue; }");
    expect(checkout.indexOf("sessions.expire(oldSession.id)")).toBeLessThan(checkout.indexOf("stripe.checkout.sessions.create("));
  });
  it("a page paid just before it could be expired is confirmed, not charged twice", () => {
    const checkout = code.slice(code.indexOf("if (body.action === 'checkout') {"), code.indexOf("if (body.action === 'remove') {"));
    const raced = checkout.indexOf("oldSession = await stripe.checkout.sessions.retrieve(oldSession.id);");
    expect(raced).toBeGreaterThan(0);
    expect(raced).toBeLessThan(checkout.indexOf("return json({ error: 'Your subscription is already confirmed. Refresh the Team page.' }, 409);"));
    expect(checkout).toContain("if (oldSession.status !== 'complete' || typeof oldSession.subscription !== 'string') throw err;");
  });
  it("the card portal offers card, invoices and cancel at period end only", () => {
    const portal = code.slice(code.indexOf("async function portalConfiguration"), code.indexOf("async function convertToPlans"));
    expect(portal).toContain("payment_method_update: { enabled: true }");
    expect(portal).toContain("subscription_cancel: { enabled: true, mode: 'at_period_end' }");
    expect(portal).toContain("subscription_update: { enabled: false }");
  });
});

describe("stripe-webhook on the live key", () => {
  const code = source("stripe-webhook");
  it("answers 200 to events it can't use, so Stripe never disables the endpoint", () => {
    expect(code).toContain("if (event.livemode !== stripeTakesRealCards(stripeKey)) {");
    expect(code).toContain("if (err instanceof ReconcileSkip) {");
    expect(code).not.toContain("Test company billing cannot process live events.");
  });
  it("reconcile skips, instead of failing on, a missing row, the other mode or another company's subscription", () => {
    const reconcile = shared("companyReconcile.ts");
    expect(reconcile).toContain(".maybeSingle();");
    expect(reconcile).toContain("if (!billing) throw new ReconcileSkip(");
    expect(reconcile).toContain("billing.environment !== env");
  });
});

describe("delete-account stops the charges first", () => {
  it("cancels the account's subscriptions before deleting anything, and stops if Stripe fails", () => {
    const code = source("delete-account");
    const cancel = code.indexOf("if (!(await cancelOwnSubscriptions(admin, userId))) {");
    expect(cancel).toBeGreaterThan(0);
    expect(cancel).toBeLessThan(code.indexOf("admin.auth.admin.deleteUser(userId)"));
    expect(cancel).toBeLessThan(code.indexOf("account_deletion_feedback"));
  });
});

describe("billing-reminders", () => {
  const code = source("billing-reminders");
  it("claims each reminder before sending it, so a rerun never repeats one", () => {
    expect(code.indexOf('await claim(admin, t.owner_id, "B1", t.trial_ends_at)')).toBeLessThan(code.indexOf('kind: "B1"'));
    expect(code.indexOf('await claim(admin, owner.id, "B2", trialEndsAt)')).toBeLessThan(code.indexOf('kind: "B2", role: "owner" })) count = 1;'));
  });
  it("asks for a card only once the plans are open", () => {
    expect(code).toContain("plansOpenFor(rollout, t.owner_id)");
    expect(code).toContain("!plansOpenFor(rollout, p.id)");
  });
  it("uses no dashes in any text", () => {
    expect(code).not.toMatch(/[–—]/);
  });
});

describe("billing banner", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  it("asks for a new card when a renewal failed, whatever the switch", () => {
    expect(billingBannerKind({ pricing_version: "2026-10", status: "past_due" }, undefined, false, now)).toBe("past_due");
  });
  it("shows nothing about trials until the plans are open", () => {
    expect(billingBannerKind(undefined, { subscription_tier: "demo_trial", trial_ends_at: "2026-10-30T00:00:00Z" }, false, now)).toBeNull();
  });
  it("asks a no-card trial to choose a plan, and a half-done signup to add its card", () => {
    expect(billingBannerKind(undefined, { subscription_tier: "demo_trial", trial_ends_at: "2026-10-30T00:00:00Z" }, true, now)).toBe("choose_plan");
    expect(billingBannerKind({ pricing_version: "2026-10", status: "trialing", stripe_subscription_id: null }, undefined, true, now)).toBe("choose_plan");
    expect(billingBannerKind({ pricing_version: "2026-10", status: "incomplete", stripe_subscription_id: null }, undefined, true, now)).toBe("finish_signup");
  });
  it("stays quiet for a trial with a card, a paying company and an ended no-card trial", () => {
    expect(billingBannerKind({ pricing_version: "2026-10", status: "trialing", stripe_subscription_id: "sub_1" }, undefined, true, now)).toBeNull();
    expect(billingBannerKind({ pricing_version: "2026-10", status: "active", stripe_subscription_id: "sub_1" }, undefined, true, now)).toBeNull();
    expect(billingBannerKind(undefined, { subscription_tier: "demo_trial", trial_ends_at: "2026-10-20T00:00:00Z" }, true, now)).toBeNull();
  });
  it("stays quiet for a phone plan and the old $50 iPhone trial: the store runs those trials (Part B)", () => {
    expect(billingBannerKind({ pricing_version: "2026-10", provider: "app_store", status: "trialing", stripe_subscription_id: null }, undefined, true, now)).toBeNull();
    expect(billingBannerKind({ pricing_version: "2026-10", provider: "play_store", status: "past_due" }, undefined, true, now)).toBeNull();
    expect(billingBannerKind(undefined, { subscription_tier: "demo_trial", trial_ends_at: "2026-10-30T00:00:00Z", storeTrial: true }, true, now)).toBeNull();
  });
});
