// Plaid approved the paid plan on 2026-10-26, which has no limit on bank connections, so Pulse's TreeCheck-wide
// limit (9 on the 10-connection Trial) is off: PRODUCTION_SLOT_CAP is null, plaid-link-token skips its check, and
// plaid-exchange passes null to plaid_reserve_slot, whose "v_team >= p_team_cap" is then never true. Each company's own
// limit (pulse_access.max_items) is unchanged. Read as source, so a later edit that brings back a fixed limit fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const fn = (name: string) => read("supabase", "functions", name, "index.ts");

describe("no TreeCheck-wide bank connection limit on Plaid's paid plan", () => {
  it("the limit is null", () => {
    expect(read("supabase", "functions", "_shared", "plaid.ts")).toContain("export const PRODUCTION_SLOT_CAP: number | null = null;");
  });

  it("plaid-link-token checks the TreeCheck-wide count only when there is a limit, and still checks the company's own", () => {
    const code = fn("plaid-link-token");
    expect(code).toContain('if (env === "production" && PRODUCTION_SLOT_CAP !== null) {');
    expect(code).toContain("if ((live ?? 0) >= access.max_items) {");
  });

  it("plaid-exchange passes the limit to the reservation, which treats null as none", () => {
    expect(fn("plaid-exchange")).toContain("p_team_cap: PRODUCTION_SLOT_CAP,");
    expect(read("drizzle", "migrations", "0024_m4_plaid.sql")).toContain("if v_team >= p_team_cap then");
  });

  it("the admin card shows connections made, with no limit to count down to", () => {
    const screen = read("src", "components", "pulse", "admin", "PulseAdminScreen.tsx");
    expect(screen).toContain("Plaid's paid plan has no limit, so companies can keep linking banks.");
    expect(fn("pulse-admin")).toContain("cap: PRODUCTION_SLOT_CAP, trial_limit: PRODUCTION_SLOT_CAP === null ? null : 10");
  });

  it("the admin page's Bank limit goes up to 10, the most the server and the table allow", () => {
    expect(read("src", "components", "pulse", "admin", "PulseAdminScreen.tsx")).toContain("const MAX_LIMIT = 10;");
    expect(fn("pulse-admin")).toContain("(body.max_items as number) <= 10");
    expect(read("drizzle", "migrations", "0020_m2_pulse_core.sql")).toContain("check (max_items between 0 and 10)");
  });
});
