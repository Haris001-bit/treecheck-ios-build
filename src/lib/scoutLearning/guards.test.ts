// Guards for Scout learning (the weekly feedback loop). They read the function sources, so a later edit (Lovable's
// included) that drops a hook, or starts sending learning text into the stump scan, fails here before it ships.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const fn = (name: string) => readFileSync(join(ROOT, "supabase", "functions", name, "index.ts"), "utf8");
const shared = (file: string) => readFileSync(join(ROOT, "supabase", "functions", "_shared", file), "utf8");
const CORE = shared("scoutLearningCore.ts");
const IO = shared("scoutLearning.ts");
const WEEKLY = shared("scoutLearningWeekly.ts");
const RUN = shared("scoutLearningRun.ts");

describe("the weekly run's trigger and door", () => {
  it("crew-release-holds starts scout-learning-run on scheduled runs, with the service key", () => {
    const text = fn("crew-release-holds");
    const call = text.indexOf("/functions/v1/scout-learning-run");
    expect(call).toBeGreaterThan(0);
    const block = text.slice(text.lastIndexOf("if (!force)", call), call + 300);
    expect(block).toContain("if (!force)");
    expect(block).toContain("Authorization: `Bearer ${SERVICE}`");
  });
  it("scout-learning-run refuses anyone but the service key, then honours the kill switch, before any work", () => {
    const text = fn("scout-learning-run");
    const refuse = text.indexOf("if (!SERVICE || bearer !== SERVICE) return json(");
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(text.indexOf("if (learningKillSwitchOn())"));
    expect(text.indexOf("if (learningKillSwitchOn())")).toBeLessThan(text.indexOf("createClient(SUPABASE_URL, SERVICE"));
  });
  it("only the run module finishes runs, and only through scout_learning_finish", () => {
    expect(RUN).toContain('admin.rpc("scout_learning_finish"');
    expect(RUN).not.toMatch(/from\("scout_learning_runs"\)\.(insert|upsert|delete)/);
  });
});

describe("scout-submit", () => {
  const text = fn("scout-submit");
  it("sends the company's guidance and marks the callback as Scout's own", () => {
    expect(text).toContain("activeGuidance(admin, companyOwner, 'scout')");
    expect(text).toContain("company_guidance: learning.block");
    expect(text).toContain("/functions/v1/scout-estimate-callback?src=scout");
  });
  it("records what Scout is given before calling Scout, and never for pruning or Free previews", () => {
    const record = text.indexOf("recordScoutSent(admin");
    expect(record).toBeGreaterThan(0);
    expect(record).toBeLessThan(text.indexOf("fetch(N8N_WEBHOOK"));
    expect(text).toContain("const learns = !isPruning && !lockedPreview;");
  });
});

describe("scout-retry-estimate", () => {
  const text = fn("scout-retry-estimate");
  it("does the same as scout-submit", () => {
    expect(text).toContain("/functions/v1/scout-estimate-callback?src=scout");
    expect(text).toContain("company_guidance: learning.block");
    expect(text.indexOf("recordScoutSent(admin")).toBeGreaterThan(0);
    expect(text.indexOf("recordScoutSent(admin")).toBeLessThan(text.indexOf("fetch(N8N_WEBHOOK"));
  });
});

describe("scout-estimate-callback and Request Edit", () => {
  it("records only answers marked src=scout, after the capture is saved", () => {
    const text = fn("scout-estimate-callback");
    const gate = text.indexOf("searchParams.get('src') === 'scout'");
    expect(gate).toBeGreaterThan(text.indexOf(".from('scout_captures').update("));
    expect(text.indexOf("recordScoutResult(admin")).toBeGreaterThan(gate);
  });
  it("Request Edit's callback never carries the marker", () => {
    expect(fn("scout-request-edit")).not.toContain("src=scout");
  });
});

describe("create-personal-lead", () => {
  const text = fn("create-personal-lead");
  it("keeps the learning fields out of the stump scan", () => {
    expect(text).toContain("scan(withoutLearningFields(");
    expect(text).not.toMatch(/scan\(payload\)/);
  });
  it("hands out guidance only for a known private owner's secret", () => {
    const branch = text.indexOf('searchParams.get("guidance") === "website"');
    expect(branch).toBeGreaterThan(0);
    const owner = text.indexOf("resolveOwnerFromSecret(", branch);
    expect(owner).toBeGreaterThan(branch);
    expect(text.indexOf("guidanceOwner.publicMode", branch)).toBeLessThan(text.indexOf("activeGuidance(", branch));
  });
  it("records the website estimate for private leads", () => {
    expect(text).toContain("recordWebsiteEstimate(supabase");
  });
});

describe("the shared modules", () => {
  it("never touch Financial Pulse or production tables", () => {
    for (const src of [CORE, IO]) {
      expect(src).not.toMatch(/plaid_|pulse_|jobber_jobs|jobber_visit_revenue|jobber_payments|production_/);
    }
  });
  it("the pure modules stay pure: no Deno, network, database or clock", () => {
    for (const src of [CORE, WEEKLY]) {
      const code = src.replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/Deno|fetch\(|\.from\(|\.rpc\(|Date\.now|new Date\(\)/);
    }
  });
  it("the weekly run never texts, never calls n8n or Jobber, and touches no Pulse or production table", () => {
    for (const src of [RUN, fn("scout-learning-run")]) {
      expect(src).not.toMatch(/twilio|n8n\.cloud|getJobberToken|jobber_|plaid_|pulse_|production_|send-push|notify/i);
    }
  });
  it("every database helper catches its own errors", () => {
    for (const name of ["companyOf", "activeGuidance", "recordScoutSent", "recordScoutResult", "recordWebsiteEstimate"]) {
      const start = IO.indexOf(`export async function ${name}(`);
      expect(start).toBeGreaterThan(0);
      const next = IO.indexOf("export ", start + 10);
      expect(IO.slice(start, next < 0 ? undefined : next)).toMatch(/try \{[\s\S]*\} catch/);
    }
  });
});

describe("fixes from the 2026-10-22 review", () => {
  it("crew-release-holds keeps its release loops in their own try, so a crash there can't stop the chained jobs", () => {
    const text = fn("crew-release-holds");
    const loops = text.indexOf("// ---- Jobs open for bids ----");
    const reminders = text.indexOf("// Climbers who haven't confirmed days after 24h get one reminder.");
    expect(loops).toBeGreaterThan(0);
    expect(text.slice(0, loops)).toMatch(/try \{\s*$/);
    const between = text.slice(loops, reminders);
    expect(between).toContain("} catch (e) {");
    expect(between).toContain("if (force) throw e;");
    expect(text.indexOf("/functions/v1/scout-learning-run")).toBeGreaterThan(reminders);
  });

  it("scout-learning-photos signs only photos of jobs in the caller's own report, read as the caller", () => {
    const text = fn("scout-learning-photos");
    const report = text.indexOf('asCaller.rpc("scout_learning_report")');
    const sign = text.indexOf("createSignedUrl(");
    expect(text).toContain('return json({ ok: false, error: "Unauthorized" }, 401);');
    expect(text.indexOf("Unauthorized")).toBeLessThan(report);
    expect(report).toBeGreaterThan(0);
    expect(sign).toBeGreaterThan(report);
    expect(text.slice(report, sign)).toContain("shown.has(");
    expect(text).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("the weekly run reads the first and the live run by their own queries, and closes runs that died", () => {
    expect(RUN).toContain('oneRun(admin, company, surface, "initial")');
    expect(RUN).toContain('oneRun(admin, company, surface, "active")');
    expect(RUN).toContain("await closeAbandoned(admin, deps.now);");
  });
});
