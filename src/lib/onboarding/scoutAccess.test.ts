// Onboarding milestone: the server's "company with Scout" rule (crew-invite, bid-request-create, trial signup) is
// the app's ScoutRequiredGate rule, so no company the app lets onto the Bid Board is refused by the server.
import { describe, expect, it } from "vitest";
import { BILLING_EXEMPT_OWNER_IDS, hasScoutAccess } from "../../../supabase/functions/_shared/scoutAccess";
import { BILLING_EXEMPT_OWNER_IDS as APP_EXEMPT } from "@/components/PaidFeatureGate";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const owner = "owner-1";
const teammate = "team-1";

describe("hasScoutAccess", () => {
  it("uses the same exempt list as the app", () => {
    expect(BILLING_EXEMPT_OWNER_IDS).toEqual(APP_EXEMPT);
    expect(hasScoutAccess(APP_EXEMPT[0], teammate, [], [], NOW)).toBe(true);
  });
  it("lets an admin caller through", () => {
    expect(hasScoutAccess(owner, teammate, [{ id: teammate, role: "admin" }], [], NOW)).toBe(true);
    expect(hasScoutAccess(owner, teammate, [{ id: owner, role: "admin" }], [], NOW)).toBe(false); // the caller's role
  });
  it("counts a running trial, including one with no end date stored", () => {
    expect(hasScoutAccess(owner, owner, [{ id: owner, subscription_tier: "demo_trial", trial_ends_at: "2026-10-20T00:00:00Z" }], [], NOW)).toBe(true);
    expect(hasScoutAccess(owner, owner, [{ id: owner, subscription_tier: "demo_trial", trial_ends_at: null }], [], NOW)).toBe(true);
    expect(hasScoutAccess(owner, owner, [{ id: owner, subscription_tier: "demo_trial", trial_ends_at: "2026-10-01T00:00:00Z" }], [], NOW)).toBe(false);
  });
  it("counts an active or trialing Scout entitlement that hasn't ended", () => {
    expect(hasScoutAccess(owner, teammate, [], [{ status: "active", current_period_end: null }], NOW)).toBe(true);
    expect(hasScoutAccess(owner, teammate, [], [{ status: "trialing", current_period_end: "2026-10-27T00:00:00Z" }], NOW)).toBe(true);
    expect(hasScoutAccess(owner, teammate, [], [{ status: "canceled", current_period_end: null }], NOW)).toBe(false);
    expect(hasScoutAccess(owner, teammate, [], [{ status: "active", current_period_end: "2026-10-01T00:00:00Z" }], NOW)).toBe(false);
  });
  it("refuses a company login with nothing (a /register login, or a trial abandoned at the card)", () => {
    expect(hasScoutAccess(owner, owner, [{ id: owner, role: "contractor", subscription_tier: "free" }], [], NOW)).toBe(false);
  });
});
