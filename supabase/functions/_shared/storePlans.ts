// Phone plans (payments milestone, Part B): the App Store and Google Play subscriptions RevenueCat reports, written to
// the same company_billing row the website plans use, plus the fixes for the old $50 iPhone plan. Pure, so every
// decision the webhook makes is unit-tested (src/lib/payments/storePlans.test.ts); revenuecat-webhook does the writes.

export type StoreInterval = "month" | "year";
export type StorePlan = { ownerScout: boolean; interval: StoreInterval };
export type StoreProvider = "app_store" | "play_store";

// Apple product ids, and Google's subscriptionId:basePlanId as RevenueCat reports them. Must match src/lib/iapProducts.ts.
export const STORE_PLAN_PRODUCTS: Record<string, StorePlan> = {
  treecheck_core_scout_monthly: { ownerScout: true, interval: "month" },
  treecheck_core_monthly: { ownerScout: false, interval: "month" },
  treecheck_core_yearly: { ownerScout: false, interval: "year" },
  "treecheck_core_scout:monthly": { ownerScout: true, interval: "month" },
  "treecheck_core:monthly": { ownerScout: false, interval: "month" },
  "treecheck_core:yearly": { ownerScout: false, interval: "year" },
};

/** The old $50 iPhone plan (treecheck_demo_monthly), still sold by iPhone 1.1. */
export const LEGACY_DEMO_PRODUCT = "treecheck_demo_monthly";
/** What the $50 plan unlocks, the same rows stripe-webhook writes for it. */
export const LEGACY_DEMO_PRODUCTS = ["scout", "dma_basic_demo", "team_seats"] as const;

export const storePlanFor = (productId: string | null | undefined): StorePlan | null =>
  (productId && STORE_PLAN_PRODUCTS[productId]) || null;

/** Whether an event is about a phone plan (a product change counts when either side is one). */
export const isStorePlanEvent = (event: StoreEvent): boolean =>
  !!storePlanFor(event.type === "PRODUCT_CHANGE" ? event.new_product_id : event.product_id) ||
  (event.type === "PRODUCT_CHANGE" && !!storePlanFor(event.product_id));

/** What a phone plan includes, as companyReconcile writes it: the owner, two Field users and the owner's Scout if bought. */
export const storeCapacity = (plan: StorePlan) => ({ scout: 0, manager: 0, field: 2, ownerScout: plan.ownerScout });

export type StoreEvent = {
  type?: string;
  store?: string;
  environment?: string;
  period_type?: string;
  product_id?: string | null;
  new_product_id?: string | null;
  expiration_at_ms?: number | null;
};

export type StoreBillingRow = {
  pricing_version?: string;
  provider?: string;
  environment?: string;
  status?: string;
  stripe_subscription_id?: string | null;
  complimentary?: boolean;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  capacity?: { ownerScout?: boolean } | null;
} | null;

export type StoreDecision =
  | { kind: "not_plan" }
  | { kind: "skip"; reason: string }
  | { kind: "write"; update: Record<string, unknown> };

const PURCHASE_EVENTS = new Set(["INITIAL_PURCHASE", "RENEWAL"]);

export function storeProvider(store: string | undefined): StoreProvider | null {
  return store === "APP_STORE" ? "app_store" : store === "PLAY_STORE" ? "play_store" : null;
}

export function storeEnvironment(environment: string | undefined): "live" | "sandbox" | null {
  return environment === "PRODUCTION" ? "live" : environment === "SANDBOX" ? "sandbox" : null;
}

const iso = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);
const later = (a: string | null | undefined, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

/** Whether this row's plan still gives access: a running trial, a paid period, or a failed renewal in its grace. */
export function planRunning(row: StoreBillingRow, now: number): boolean {
  if (!row || row.pricing_version !== "2026-10") return false;
  if (row.status === "trialing") return !!row.trial_ends_at && Date.parse(row.trial_ends_at) > now;
  if (row.status === "active") return !!row.current_period_end && Date.parse(row.current_period_end) > now;
  return row.status === "past_due";
}

/**
 * What one RevenueCat event does to the owner's company_billing row.
 * - not_plan: the product isn't a phone plan, so the old product handling applies.
 * - skip: a plan event this row can't take (logged and answered 200, so RevenueCat doesn't retry forever).
 * - write: the fields to upsert on the owner's row.
 * `blocker` is why a company not yet on the plans can't move there (null when it can); `sandboxAllowed` is whether the
 * owner is on billing_rollout.store_sandbox_owner_ids.
 */
export function storePlanDecision(
  event: StoreEvent,
  row: StoreBillingRow,
  ctx: { sandboxAllowed: boolean; blocker: string | null; now: number },
): StoreDecision {
  const type = event.type ?? "";
  // A product change names the new product; every other event the product it is about.
  const plan = storePlanFor(type === "PRODUCT_CHANGE" ? event.new_product_id : event.product_id);
  if (!plan) {
    return type === "PRODUCT_CHANGE" && storePlanFor(event.product_id)
      ? { kind: "skip", reason: "changed from a phone plan to a product outside the plans" }
      : { kind: "not_plan" };
  }
  const provider = storeProvider(event.store);
  if (!provider) return { kind: "skip", reason: `store ${event.store ?? "unknown"} is not sold through the apps` };
  const environment = storeEnvironment(event.environment);
  if (!environment) return { kind: "skip", reason: "unknown store environment" };
  // A sandbox purchase only unlocks the App Review login and Haris's test logins.
  if (environment === "sandbox" && !ctx.sandboxAllowed) return { kind: "skip", reason: "sandbox purchase by an owner not on the sandbox list" };
  if (row?.complimentary) return { kind: "skip", reason: "complimentary company" };

  const onPlans = row?.pricing_version === "2026-10";
  const ours = onPlans && row?.provider === provider && row?.environment === environment;
  const exp = iso(event.expiration_at_ms);
  const fromProduct = { billing_interval: plan.interval, capacity: storeCapacity(plan) };

  // A purchase, a renewal, or a switch from the old $50 iPhone plan in the same Apple subscription, for a row that isn't
  // this store's yet: it takes the row over only when no other plan is running and the company may move to the plans.
  const takeover = PURCHASE_EVENTS.has(type) || (type === "PRODUCT_CHANGE" && !ours);
  if (takeover && !ours) {
    if (onPlans && planRunning(row, ctx.now)) {
      return {
        kind: "skip",
        reason: row?.provider === "stripe" ? "company pays on the website"
          : row?.provider !== provider ? "company has a plan in the other store" : "company has a plan in the other environment",
      };
    }
    if (!onPlans && ctx.blocker) return { kind: "skip", reason: ctx.blocker };
  }
  if (takeover) {
    const base = { pricing_version: "2026-10", provider, environment, ...fromProduct, current_period_end: exp, pending_renewal: null };
    if (type === "INITIAL_PURCHASE" && event.period_type === "TRIAL") return { kind: "write", update: { ...base, status: "trialing", trial_ends_at: exp } };
    return { kind: "write", update: { ...base, status: "active" } };
  }

  if (!ours) return { kind: "skip", reason: `${type || "event"} for a plan this company's row doesn't hold` };
  switch (type) {
    // Auto-renew turned off (or a refund, whose expiration is the refund time): access lasts until the expiration.
    case "CANCELLATION":
      return {
        kind: "write",
        update: {
          pending_renewal: { cancellation: true, effectiveAt: event.expiration_at_ms ? Math.floor(event.expiration_at_ms / 1000) : null },
          current_period_end: exp ?? row?.current_period_end ?? null,
          ...(row?.status === "trialing" ? { trial_ends_at: exp ?? row?.trial_ends_at ?? null } : {}),
        },
      };
    case "UNCANCELLATION":
      return { kind: "write", update: { pending_renewal: null, current_period_end: exp ?? row?.current_period_end ?? null } };
    // The store retries the payment; with its grace period the expiration moves out and access carries on until then.
    case "BILLING_ISSUE":
      return {
        kind: "write",
        update: {
          current_period_end: later(row?.current_period_end, exp),
          ...(row?.status === "trialing" ? { trial_ends_at: later(row?.trial_ends_at, exp) } : {}),
        },
      };
    case "EXPIRATION":
      return { kind: "write", update: { status: "canceled", pending_renewal: null, current_period_end: exp ?? row?.current_period_end ?? null } };
    // An upgrade to the owner's Scout applies at once; a downgrade or a new billing period applies at the renewal,
    // whose RENEWAL event names the new product.
    case "PRODUCT_CHANGE":
      return plan.ownerScout && !row?.capacity?.ownerScout
        ? { kind: "write", update: { capacity: storeCapacity(plan) } }
        : { kind: "skip", reason: "downgrade or billing period change, applied at the renewal" };
    default:
      return { kind: "skip", reason: `${type || "event"} is not handled for phone plans` };
  }
}

export type LegacyDemoUpdate = {
  profile: Record<string, unknown> | null;
  entitlements: { status: "active" | "canceled"; current_period_end: string | null } | null;
};

/**
 * The old $50 iPhone plan: a renewal grants access through the same entitlement rows Stripe writes for it, the trial
 * ends on its real date, and turning off auto-renew no longer takes access away before the paid time runs out.
 */
export function legacyDemoUpdate(event: StoreEvent): LegacyDemoUpdate {
  const exp = iso(event.expiration_at_ms);
  const trial = event.period_type === "TRIAL";
  // An entitlement row with no end date would never expire, so nothing is written without one.
  if (!exp && event.type !== "EXPIRATION") return { profile: null, entitlements: null };
  switch (event.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
      return trial && event.type === "INITIAL_PURCHASE"
        ? { profile: { subscription_tier: "demo_trial", is_active: true, trial_ends_at: exp }, entitlements: null }
        : { profile: { subscription_tier: "demo_paid", is_active: true, subscription_ends_at: exp }, entitlements: { status: "active", current_period_end: exp } };
    case "UNCANCELLATION":
    case "CANCELLATION":
    case "BILLING_ISSUE":
      return trial
        ? { profile: { trial_ends_at: exp }, entitlements: null }
        : { profile: { subscription_ends_at: exp }, entitlements: { status: "active", current_period_end: exp } };
    case "EXPIRATION":
      return { profile: { subscription_tier: "free" }, entitlements: { status: "canceled", current_period_end: exp } };
    default:
      return { profile: null, entitlements: null };
  }
}
