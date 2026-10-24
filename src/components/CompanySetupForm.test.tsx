// The onboarding wizard's Finish (found in the $128 test, 2026-10-21): "Primarily subcontractors" starts selected and
// skips "How often do you use subcontractors?", so an owner who pressed Continue without tapping it reached Finish with
// no answer saved for that question, and Finish did nothing. Hooks are mocked; nothing reaches a database.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RATE_CARD } from "@/lib/scoutWorksheet";

const saveSettings = vi.fn();
const saveRates = vi.fn();
const query = {
  select: () => query,
  eq: () => query,
  maybeSingle: async () => ({ data: null }),
  upsert: async () => ({ error: null }),
};

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => query } }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
vi.mock("@/hooks/useCompanySettings", () => ({
  useCompanySettings: () => ({ data: null, isLoading: false }),
  useSaveCompanySettings: () => ({ mutateAsync: saveSettings }),
}));
vi.mock("@/hooks/useScoutRates", () => ({
  useScoutRates: () => ({ rates: DEFAULT_RATE_CARD, save: saveRates, loading: false }),
}));
vi.mock("@/components/production/CalibrationWizard", () => ({ CalibrationWizard: () => null }));
vi.mock("@/components/production/CalibrationPanel", () => ({ CALIBRATION_INTRO: "" }));

import { CompanySetupForm } from "./CompanySetupForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const buttons = () => [...host.querySelectorAll("button")];
const button = (label: string) => {
  const found = buttons().find((b) => b.textContent?.trim().startsWith(label));
  if (!found) throw new Error(`No "${label}" button on: ${host.textContent}`);
  return found;
};
const title = () => host.querySelector("h2")?.textContent ?? "";

async function open() {
  await act(async () => root.render(<CompanySetupForm mode="wizard" />));
}

/** Presses Continue until the last question, returning every question title seen on the way. */
async function continueToLast() {
  const seen = [title()];
  while (!buttons().some((b) => b.textContent?.trim() === "Finish")) {
    await act(async () => button("Continue").click());
    seen.push(title());
  }
  return seen;
}

beforeEach(() => {
  sessionStorage.clear();
  saveSettings.mockReset();
  saveRates.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("CompanySetupForm wizard", () => {
  it("finishes when Primarily subcontractors was left as it started, without tapping it", async () => {
    await open();
    expect(title()).toBe("How does your company normally perform tree work?");
    const seen = await continueToLast();
    await act(async () => button("Finish").click());
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      operating_model: "subcontractors", sub_usage: "every_job", auto_broadcast: true,
    }));
    expect(saveRates).toHaveBeenCalled();
    // The same questions as tapping it: a subcontractor company isn't asked about its own crew.
    expect(seen).not.toContain("Who does your own crew include?");
  });

  it("finishes after a reload on the last question with the untapped answer restored", async () => {
    sessionStorage.setItem("onboarding-draft:owner-1", JSON.stringify({
      step: 6,
      s: { sub_usage: null, sub_roles: [], in_house_roles: [], lead_sources: [], crm: "none", crm_other: "", auto_broadcast: false, operating_model: "subcontractors" },
      costs: { laborRate: 25, disposalRate: 150, crewSharePct: 50, ownerMinPct: 30, craneHourly: 350, chipperRate: 0, chipperType: "day", stumpBase: 250 },
      calibrated: false,
    }));
    await open();
    expect(title()).toBe("Your default job costs");
    await act(async () => button("Finish").click());
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sub_usage: "every_job" }));
    expect(sessionStorage.getItem("onboarding-draft:owner-1")).toBeNull();
  });

  it("saves the same answers as tapping Primarily subcontractors", async () => {
    await open();
    await act(async () => button("Primarily subcontractors").click());
    await continueToLast();
    await act(async () => button("Finish").click());
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      operating_model: "subcontractors", sub_usage: "every_job", auto_broadcast: true,
    }));
  });

  it("still asks an employee company how often it uses subcontractors", async () => {
    await open();
    await act(async () => button("Primarily employees").click());
    await act(async () => button("Continue").click());
    await act(async () => button("Skip for Now").click());
    expect(title()).toBe("How often do you use subcontractors?");
    expect(button("Continue").disabled).toBe(true);
  });
});
