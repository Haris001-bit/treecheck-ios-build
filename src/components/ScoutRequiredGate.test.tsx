// The owners' Scout gate (Bid Board, My Subs, Pay): in the phone apps it must show no Stripe price, no Stripe button and
// no outside checkout, because Apple rejects non-Apple purchase paths (3.1.1) and Google Play requires its own billing;
// where the apps sell the plans, the owner's one way in is the phone plan screen. The web keeps the Stripe paywall.
// Hooks are mocked.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// safeMode stands for a store build (iPhone, or Android from 1.2); storePlans for one that sells the phone plans.
let safeMode = false;
let storePlans = false;
let hasScout = false;

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ isAdmin: false, effectiveContractorId: "owner-1" }) }));
vi.mock("@/lib/platform", () => ({
  isAppStoreSafeMode: () => safeMode, isNativeStoreBilling: () => safeMode, canUseStorePlans: () => storePlans,
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({ activeProducts: new Set<string>(), isLoading: false, hasProduct: (p: string) => hasScout && p === "scout" }),
}));
vi.mock("@/hooks/useCrew", () => ({
  useMyCrewMemberships: () => ({ data: [], isLoading: false }),
  useMyCrewMarket: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/hooks/useCompanyBilling", () => ({ useCompanyBilling: () => ({ isLoading: false, data: { billing: null } }) }));
vi.mock("@/hooks/useCompanyPermission", () => ({ useCompanyPermission: () => ({ isLoading: false, data: false }) }));

import { ScoutRequiredGate } from "./PaidFeatureGate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

function show() {
  const client = new QueryClient();
  act(() => root.render(
    <QueryClientProvider client={client}><MemoryRouter><ScoutRequiredGate><div>BID BOARD</div></ScoutRequiredGate></MemoryRouter></QueryClientProvider>,
  ));
  return host.textContent ?? "";
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  safeMode = false;
  storePlans = false;
  hasScout = false;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ScoutRequiredGate", () => {
  it("in a phone app that sells no plans, shows an owner without Scout no price, no button and no checkout", () => {
    safeMode = true;
    const text = show();
    expect(text).toContain("Scout isn't active on this account");
    expect(text).not.toContain("Start 14-day free trial");
    expect(text).not.toContain("$");
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
  });

  it("in a phone app that sells the plans, sends the owner to the phone plan screen, with no Stripe price", () => {
    safeMode = true;
    storePlans = true;
    const text = show();
    expect(text).toContain("The Bid Board is part of TreeCheck's plans");
    expect(text).not.toContain("$");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/plan");
  });

  it("keeps the web paywall as it was", () => {
    const text = show();
    expect(text).toContain("The Bid Board is part of Scout");
    expect(text).toContain("$50/month");
    expect(text).toContain("Start 14-day free trial");
  });

  it("lets an owner with Scout straight in, on iPhone and on the web", () => {
    hasScout = true;
    expect(show()).toContain("BID BOARD");
    safeMode = true;
    expect(show()).toContain("BID BOARD");
  });
});
