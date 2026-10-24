// Onboarding milestone: TreeCheck's Stripe was found on a test key (2026-10-13), which declines every real card.
// Signup checks the key's mode, so putting a live key in brings the card step back with no code change.
import { describe, expect, it } from "vitest";
import { stripeTakesRealCards, TRIAL_DAYS_WITHOUT_CARD } from "../../../supabase/functions/_shared/stripeMode";

describe("stripeTakesRealCards", () => {
  it("is false for test keys, secret or restricted", () => {
    expect(stripeTakesRealCards("sk_test_abc")).toBe(false);
    expect(stripeTakesRealCards("rk_test_abc")).toBe(false);
    expect(stripeTakesRealCards(" sk_test_abc ")).toBe(false);
  });
  it("is true for live keys", () => {
    expect(stripeTakesRealCards("sk_live_abc")).toBe(true);
    expect(stripeTakesRealCards("rk_live_abc")).toBe(true);
  });
  it("is false with no key at all", () => {
    expect(stripeTakesRealCards(undefined)).toBe(false);
    expect(stripeTakesRealCards("")).toBe(false);
  });
  it("gives the advertised 14 days", () => {
    expect(TRIAL_DAYS_WITHOUT_CARD).toBe(14);
  });
});

describe("trialTakesCard", () => {
  it("keeps trials card-free until the company plans are open, and only on a live key", async () => {
    const { trialTakesCard } = await import("../../../supabase/functions/_shared/stripeMode");
    expect(trialTakesCard("rk_live_abc", false)).toBe(false);
    expect(trialTakesCard("rk_live_abc", true)).toBe(true);
    expect(trialTakesCard("sk_test_abc", true)).toBe(false);
    expect(trialTakesCard(undefined, true)).toBe(false);
  });
});
