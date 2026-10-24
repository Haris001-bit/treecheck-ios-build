// The subcontractor membership screen (onboarding milestone): waiting for approval is not a paywall, free areas go
// straight in, and the paywall shows the real local price. Hooks are mocked; the price logic is in crewMarket.test.ts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TIMBER = "705cecc2-5926-48c1-a728-b3ebd6b920a2";
let memberships: { owner_contractor_id: string; status: string }[] = [];
let market: { company_count: number; monthly_price: number; location_label: string | null; network: boolean; billing?: string } | undefined;
let active = new Set<string>();

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ isAdmin: false, effectiveContractorId: null }) }));
vi.mock("@/lib/platform", () => ({ isAppStoreSafeMode: () => false, isNativeStoreBilling: () => false, canUseStorePlans: () => false }));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({ activeProducts: active, isLoading: false, hasProduct: () => false }),
}));
vi.mock("@/hooks/useCrew", () => ({
  useMyCrewMemberships: () => ({ data: memberships, isLoading: false }),
  useMyCrewMarket: () => ({ data: market, isLoading: false }),
}));

import { CrewMembershipGate } from "./PaidFeatureGate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

function show() {
  const client = new QueryClient();
  act(() => root.render(
    <QueryClientProvider client={client}><CrewMembershipGate><div>JOBS TO BID</div></CrewMembershipGate></QueryClientProvider>,
  ));
  return host.textContent ?? "";
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  memberships = [];
  market = undefined;
  active = new Set();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.history.replaceState(null, "", "/");
});

describe("CrewMembershipGate", () => {
  it("tells a climber waiting for approval to wait, with nothing to buy", () => {
    memberships = [{ owner_contractor_id: TIMBER, status: "pending" }];
    market = { company_count: 1, monthly_price: 10, location_label: "Edmond, OK", network: false };
    const text = show();
    expect(text).toContain("Waiting for the company to approve you");
    expect(text).not.toContain("Start 14-day free trial");
  });

  it("lets an approved Timber climber straight in", () => {
    memberships = [{ owner_contractor_id: TIMBER, status: "active" }];
    expect(show()).toContain("JOBS TO BID");
  });

  it("lets a sub in where no tree company participates", () => {
    market = { company_count: 0, monthly_price: 0, location_label: "Boise, ID", network: true };
    expect(show()).toContain("JOBS TO BID");
  });

  it("shows the real local price, not a flat $20", () => {
    market = { company_count: 3, monthly_price: 25, location_label: "Oklahoma City, OK", network: true };
    const text = show();
    expect(text).toContain("$25/month after 14 days free");
    expect(text).toContain("Based on 3 participating tree companies within 30 miles of Oklahoma City, OK.");
    expect(text).not.toContain("$20");
  });

  it("charges a network sub in a paid area even while a company request is pending", () => {
    memberships = [{ owner_contractor_id: "other-company", status: "pending" }];
    market = { company_count: 2, monthly_price: 25, location_label: "Oklahoma City, OK", network: true };
    expect(show()).toContain("$25/month after 14 days free");
  });

  it("waits for Stripe after payment instead of showing the paywall again", () => {
    window.history.replaceState(null, "", "/dashboard/crew-bids?membership=active");
    market = { company_count: 3, monthly_price: 25, location_label: "Oklahoma City, OK", network: true };
    const text = show();
    expect(text).toContain("Starting your membership");
    expect(text).not.toContain("Start 14-day free trial");
  });

  it("lets everyone in while Stripe can't take real cards", () => {
    market = { company_count: 19, monthly_price: 35, location_label: "Oklahoma City, OK", network: true, billing: "test" };
    expect(show()).toContain("JOBS TO BID");
  });

  it("lets a paying member in", () => {
    active = new Set(["crew_membership"]);
    expect(show()).toContain("JOBS TO BID");
  });
});
