import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn<() => boolean>(() => false),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}));

import { PULSE_NATIVE_ENABLED, isPulseNativePlatform, pulseSetupAllowed, pulseSurfaceAllowed } from "./flags";

describe("Financial Pulse flags", () => {
  beforeEach(() => {
    mocks.isNativePlatform.mockReset();
  });

  it("shows the Pulse screen in the store apps (Haris 2026-10-06, as the agreed scope says)", () => {
    expect(PULSE_NATIVE_ENABLED).toBe(true);
  });

  it("in the apps: the screen shows, but setup, linking and connecting stay on the website", () => {
    mocks.isNativePlatform.mockReturnValue(true);
    expect(isPulseNativePlatform()).toBe(true);
    expect(pulseSurfaceAllowed()).toBe(true);
    expect(pulseSetupAllowed()).toBe(false);
  });

  it("with the switch off, the apps show no Pulse screen and the website still does", () => {
    mocks.isNativePlatform.mockReturnValue(true);
    expect(pulseSurfaceAllowed(false)).toBe(false);
    mocks.isNativePlatform.mockReturnValue(false);
    expect(pulseSurfaceAllowed(false)).toBe(true);
  });

  it("on the website: everything is allowed", () => {
    mocks.isNativePlatform.mockReturnValue(false);
    expect(isPulseNativePlatform()).toBe(false);
    expect(pulseSurfaceAllowed()).toBe(true);
    expect(pulseSetupAllowed()).toBe(true);
  });

  it("treats a Capacitor failure as the website", () => {
    mocks.isNativePlatform.mockImplementation(() => {
      throw new Error("no bridge");
    });
    expect(isPulseNativePlatform()).toBe(false);
    expect(pulseSurfaceAllowed()).toBe(true);
    expect(pulseSetupAllowed()).toBe(true);
  });
});

// Every file under src (tests and the local preview aside) that can start bank linking or connecting Jobber.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "pulse-preview" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path.replace(/\\/g, "/")] : [];
  });
}
const code = (path: string) =>
  readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("only website-only pages can open Plaid's or Jobber's windows", () => {
  const files = sourceFiles("src");
  const starters = files.filter((f) => {
    const c = code(f);
    return /import\s+PlaidLinkButton|from\s+["'][^"']*PlaidLinkButton["']/.test(c) ||
      /\blinkToken\(|\bexchange\(/.test(c) ||
      /invoke\(\s*["']jobber-connect["']|invokePulse\(\s*["']plaid-(link-token|exchange)["']/.test(c);
  }).sort();

  it("the files that can start them are exactly the expected ones", () => {
    expect(starters).toEqual([
      "src/components/pulse/PlaidLinkButton.tsx", // the Plaid Link button itself
      "src/components/pulse/setup/PulseSetupWizard.tsx", // shown only inside PulseSetup (website only)
      "src/components/pulse/setup/SetupParts.tsx", // shown only inside PulseSetup (website only)
      "src/lib/pulse/api.ts", // the function calls
      "src/pages/JobberIntegration.tsx", // TreeCheck's own Jobber page (opens the phone's browser in the apps)
      "src/pages/PulseOAuthReturn.tsx", // website only (pulseSetupAllowed)
      "src/pages/PulseSetup.tsx", // website only (pulseSetupAllowed)
    ]);
  });

  it("the two Pulse pages among them really ask pulseSetupAllowed (in code, not a comment)", () => {
    for (const page of ["src/pages/PulseSetup.tsx", "src/pages/PulseOAuthReturn.tsx", "src/pages/PulseHome.tsx"]) {
      expect(code(page)).toMatch(/pulseSetupAllowed\(\)/);
    }
  });
});
