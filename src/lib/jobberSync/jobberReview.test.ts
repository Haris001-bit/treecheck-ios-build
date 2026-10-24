// Jobber App Review (2026-10-22): connecting from Jobber's App Marketplace, an in-app Disconnect that uses
// Jobber's appDisconnect, no Scout-approval push through the retired send-to-jobber, and the "Sync from
// Jobber now" import on Jobber's current API version. The edge functions are read as source, so a later
// edit that drops one of these fails the suite (as guards.test.ts does).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Line endings normalised: a Windows checkout has CRLF, the repo has LF.
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
const fn = (name: string) => read("supabase", "functions", name, "index.ts");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("connecting from Jobber's App Marketplace", () => {
  const callback = fn("jobber-oauth-callback");
  it("a redirect with a code and no state goes to TreeCheck's Jobber page, before any code exchange", () => {
    const handoff = callback.indexOf('if (code && !state) return back({ from: "jobber" });');
    expect(handoff).toBeGreaterThan(-1);
    expect(handoff).toBeLessThan(callback.indexOf("await fetch(JOBBER_TOKEN_URL"));
    expect(handoff).toBeLessThan(callback.indexOf('jobber_error: "Jobber did not return an authorization code."'));
  });
  it("the Jobber page starts the normal connection once for whoever is signed in", () => {
    const page = read("src", "pages", "JobberIntegration.tsx");
    expect(page).toContain("const fromJobber = params.get('from') === 'jobber';");
    expect(page).toContain("if (!fromJobber || !user || marketplaceStarted.current) return;");
    expect(page).toContain("next.delete('from');");
    expect(page).toContain("void connect();");
  });
});

describe("Disconnect Jobber", () => {
  const code = fn("jobber-disconnect");
  it("tells Jobber with appDisconnect on the current API version", () => {
    expect(code).toContain('const APP_DISCONNECT = "mutation TC_AppDisconnect { appDisconnect { app { id } userErrors { message } } }";');
    expect(code).toContain("jobberGraphql(token, APP_DISCONNECT, {}, PULSE_JOBBER_VERSION)");
  });
  it("is owner only, checked before any Jobber call", () => {
    const owner = code.indexOf("if (prof?.parent_contractor_id)");
    expect(owner).toBeGreaterThan(-1);
    expect(owner).toBeLessThan(code.indexOf("getJobberToken(admin, ownerId)"));
    expect(code).toContain('if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);');
  });
  it("clears the stored sign-in as the APP_DISCONNECT webhook does, even when Jobber can't be told", () => {
    const told = code.indexOf("jobberGraphql(token, APP_DISCONNECT");
    const cleared = code.indexOf('.from("jobber_tokens").update({');
    expect(cleared).toBeGreaterThan(told);
    for (const field of ['access_token: ""', 'refresh_token: ""', "disconnected_at: now"]) expect(code).toContain(field);
    // The Jobber call sits in its own try, so its failure never skips the clear.
    expect(code.slice(told, cleared)).toContain("} catch (e) {");
  });
  it("the Jobber page offers it with a confirm step", () => {
    const page = read("src", "pages", "JobberIntegration.tsx");
    expect(page).toContain("supabase.functions.invoke('jobber-disconnect', { body: {} })");
    expect(page).toContain("Disconnect Jobber");
    expect(page).toContain("<AlertDialogTitle>Disconnect Jobber?</AlertDialogTitle>");
  });
});

describe("send-to-jobber is gone", () => {
  it("the function no longer exists", () => {
    expect(existsSync(join(process.cwd(), "supabase", "functions", "send-to-jobber"))).toBe(false);
  });
  it("no web app file or edge function calls it", () => {
    const files = [...filesUnder(join(process.cwd(), "src")), ...filesUnder(join(process.cwd(), "supabase", "functions"))]
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("jobberReview.test.ts"));
    const callers = files.filter((f) => /["'`/]send-to-jobber["'`]/.test(readFileSync(f, "utf8")));
    expect(callers).toEqual([]);
  });
});

describe("Sync from Jobber now (jobber-backfill)", () => {
  const code = fn("jobber-backfill");
  it("reads Jobber on the current API version, not the retired 2024-04-01", () => {
    expect(code).not.toMatch(/["'`]2024-04-01["'`]/);
    expect(code).toContain("jobberGraphql(token, JOBS_QUERY, { first: PAGE_SIZE, after }, PULSE_JOBBER_VERSION)");
    expect(code).toContain("amounts { total }");
  });
  it("matches leads and closeouts within the company only", () => {
    expect(code).toMatch(/\.eq\("owner_contractor_id", contractorId\)\s*\.eq\("jobber_job_id", job\.id\)/);
    expect(code).toMatch(/\.eq\("contractor_id", contractorId\)\s*\.eq\("jobber_job_id", job\.id\)/);
  });
  it("writes only columns that exist (live check 2026-10-22: no leads.state, leads.zip_code or lead_purchases.price_paid)", () => {
    expect(code).not.toMatch(/\b(state|zip_code|price_paid):/);
    expect(code).toContain("lead_id: lead.id, contractor_id: contractorId, purchase_amount: 0,");
    expect(code).toContain('if (pErr) throw new Error("purchase insert: " + pErr.message);');
  });
  it("shows a plain message on failure, never Jobber's raw error", () => {
    expect(code).not.toContain("json({ error: String(e) }");
    expect(code).toContain('"Couldn\'t read your Jobber jobs. Please try again in a minute."');
  });
});
