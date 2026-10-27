// Jobber sync guards for PR 1 (improve/jobber-foundation). They read the source files, so a later
// edit that breaks a rule fails the test suite. Guards that cannot pass until a later PR are listed
// in docs/jobber-sync/README.md ("Guards") and join this file with that PR.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import * as jobber from "../../../supabase/functions/_shared/jobber";
import {
  buildManifest,
  deployList,
  functionFiles,
  functionNames,
  localImports,
  MANIFEST_PATH,
} from "../../../scripts/jobber-import-graph.mjs";

const ROOT = process.cwd();
const SHARED = join(ROOT, "supabase", "functions", "_shared");

// The modules PR 1 adds. The pure ones must import under vitest: no Deno globals, no network, no clock.
const PURE = ["freeDays.ts", "jobberAddress.ts", "jobberClientMatch.ts", "quoteBuilder.ts", "jobberStatus.ts", "jobberBooking.ts"];
const NEW = [
  ...PURE, "jobberApi.ts", "jobberSwitches.ts", "tcNotify.ts",
  // Added by the quotes and closeout invoices PR.
  "jobberClient.ts", "jobberQuote.ts", "jobberInvoice.ts", "jobberQueries.quote.ts",
  // Added by the free days PR.
  "jobberCalendar.ts", "jobberQueries.calendar.ts",
  // Added by the completion PR.
  "jobberCompletion.ts", "jobberQueries.webhook.ts",
  // Added by the Jobs calendar PR (JS2).
  "jobberVisitDays.ts",
  // Added by the large-company setup (crew estimates in Jobber, 2026-10-26).
  "jobberQueries.production.ts",
];
// TreeCheck's Jobber modules as found in _shared: every jobber*.ts except Financial Pulse's own jobber.ts,
// plus the three named otherwise. One added or renamed without joining NEW fails the coverage check.
const OTHER_SYNC_MODULES = ["freeDays.ts", "quoteBuilder.ts", "tcNotify.ts"];
// Edge functions allowed to import the new modules. Empty in PR 1, which changed no runtime; each
// later PR adds the functions it deploys.
const MAY_IMPORT_NEW: string[] = [
  "bid-award", "quote-pick-alert", "send-closeout-to-jobber",
  "bid-request-create", "bid-submit",
  "jobber-webhook",
  "jobber-free-days",
  // The demo off switch (milestone 2): companyMode from tcNotify.ts.
  "network-connect", "crew-join", "crew-invite", "invite-team-member", "job-visit-text", "send-review-request", "scout-submit",
  // Lovable's review texts (2026-10-17) use the same off switch, so demo reviews text no one.
  "review-submit",
  // Jobber's visit days on the Jobs calendar (JS2).
  "jobber-visit-days",
  // Trial reminders (payments milestone): sendEmail, sendSms and the sandbox off switch from tcNotify.ts.
  "billing-reminders",
  // Mark's text when an owner picks a CRM other than Jobber (2026-10-22): sendSms and the sandbox off switch.
  "crm-interest-alert",
  // The Jobber places limit (JC1, 2026-10-26): Mark's waitlist text and email (sendSms, sendEmail, the sandbox off switch).
  "jobber-connect",
  // The large-company setup's crew estimates in Jobber (2026-10-26), through productionJobber.ts. jobber-webhook reaches
  // them only by calling production-jobber over HTTP, so its own import graph doesn't change.
  "production-estimate", "production-work", "production-jobber",
];
// The only names TreeCheck may take from Financial Pulse's _shared/jobber.ts (plan section 2.1).
const JOBBER_TS_NAMES = ["getJobberToken", "JobberGraphqlError", "JobberReconnectRequired", "JOBBER_GRAPHQL_URL", "ownerIdOf"];

// Built from pieces so this file never contains the strings it bans.
const RETIRED_VERSION = ["2024", "04", "01"].join("-");
const OLD_INPUT_TYPE = "QuoteCreate" + "Input";
const OLD_PRICE_FIELD = "unit" + "Cost:";
// Financial Pulse tables (AGENTS.md). TreeCheck's Jobber modules never read or write them.
const PULSE_TABLE = /\b(plaid_\w+|pulse_\w+|jobber_jobs|jobber_visit_revenue|jobber_payments|jobber_sync_state)\b/;
// An import of a TreeCheck Jobber module (Pulse's jobber.ts and _shared/pulse/ are not matched).
const SYNC_MODULE_IMPORT =
  /supabase\/functions\/_shared\/(freeDays|quoteBuilder|tcNotify|jobber[A-Z]\w*|jobberQueries\.\w+)(\.ts)?["']/;
// What a pure module never uses: Deno, the network, the clock, randomness or the edge runtime's hooks.
const IMPURE = /\bDeno\b|\bfetch\s*\(|\bDate\.now\b|\bnew\s+Date\s*\(\s*\)|\bMath\.random\b|\bEdgeRuntime\b/;

const source = (file: string) => readFileSync(join(SHARED, file), "utf8");
// Code with comments removed, so a comment may name what the code must not do.
const code = (file: string) => source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const firstMatch = (text: string, pattern: RegExp) => text.match(pattern)?.[0];

/** The TreeCheck Jobber modules in _shared, sorted. */
function syncModulesOnDisk(): string[] {
  return readdirSync(SHARED)
    .filter((f) => /^jobber(?!\.ts$).*\.ts$/.test(f) || OTHER_SYNC_MODULES.includes(f))
    .sort();
}

// An import or re-export clause: a default name, "* as name", "{ names }", or a default with either.
const CLAUSE = String.raw`(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)`;
const WITH_CLAUSE = new RegExp(String.raw`\b(?:import|export)\s+(${CLAUSE})\s*from\s*["']([^"']+)["']`, "g");
const SIDE_EFFECT = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * What a _shared module takes from Financial Pulse that plan section 2.1 forbids: a name from
 * _shared/jobber.ts other than the five, the whole of jobber.ts at once, or anything from _shared/pulse/.
 */
function pulseImportProblems(text: string): string[] {
  const problems: string[] = [];
  // Where a relative import from _shared lands, without its .ts ("_shared/jobber", "_shared/pulse/x").
  const target = (spec: string) => (spec.startsWith(".") ? posix.join("_shared", spec).replace(/\.ts$/, "") : spec);
  const isPulse = (spec: string) => target(spec).startsWith("_shared/pulse/");
  const isJobberTs = (spec: string) => target(spec) === "_shared/jobber";
  for (const [, clause, spec] of text.matchAll(WITH_CLAUSE)) {
    if (isPulse(spec)) problems.push(`${spec}: a Financial Pulse module`);
    if (!isJobberTs(spec)) continue;
    const named = /^(?:type\s+)?\{([^}]*)\}$/.exec(clause.trim());
    if (!named) {
      problems.push(`${spec}: takes more than named imports (${clause.trim().replace(/\s+/g, " ")})`);
      continue;
    }
    for (const part of named[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name && !JOBBER_TS_NAMES.includes(name)) problems.push(`${spec}: ${name} is not one of the five allowed names`);
    }
  }
  for (const pattern of [SIDE_EFFECT, DYNAMIC]) {
    for (const [whole, spec] of text.matchAll(pattern)) {
      if (isPulse(spec) || isJobberTs(spec)) problems.push(`${spec}: ${whole.replace(/\s+/g, " ")} takes the whole module`);
    }
  }
  return problems;
}

function webAppFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return webAppFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the five jobber.ts exports TreeCheck may use still exist", () => {
  it("getJobberToken(admin, ownerId) and ownerIdOf(admin, userId)", () => {
    expect(typeof jobber.getJobberToken).toBe("function");
    expect(jobber.getJobberToken.length).toBe(2);
    expect(typeof jobber.ownerIdOf).toBe("function");
    expect(jobber.ownerIdOf.length).toBe(2);
  });

  it("JobberGraphqlError and JobberReconnectRequired are errors", () => {
    const graphql = new jobber.JobberGraphqlError([{ message: "x" }]);
    expect(graphql).toBeInstanceOf(Error);
    expect(graphql.name).toBe("JobberGraphqlError");
    expect(graphql.errors).toEqual([{ message: "x" }]);
    const reconnect = new jobber.JobberReconnectRequired();
    expect(reconnect).toBeInstanceOf(Error);
    expect(reconnect.name).toBe("JobberReconnectRequired");
  });

  it("JOBBER_GRAPHQL_URL is Jobber's GraphQL address", () => {
    expect(jobber.JOBBER_GRAPHQL_URL).toBe("https://api.getjobber.com/api/graphql");
  });

  it("the five names are exactly the ones the import check allows", () => {
    for (const name of JOBBER_TS_NAMES) expect(name in jobber, name).toBe(true);
  });
});

describe("the guards cover every Jobber sync module", () => {
  it("NEW lists exactly the TreeCheck Jobber modules in _shared, so a new or renamed one never goes unchecked", () => {
    expect(syncModulesOnDisk()).toEqual([...NEW].sort());
    for (const file of NEW) expect(existsSync(join(SHARED, file)), `${file} is missing`).toBe(true);
  });
});

describe("the new Jobber sync modules", () => {
  for (const file of NEW) {
    it(`${file}: no retired API version, no ${OLD_INPUT_TYPE}, no ${OLD_PRICE_FIELD}`, () => {
      const text = source(file);
      for (const banned of [RETIRED_VERSION, OLD_INPUT_TYPE, OLD_PRICE_FIELD]) {
        expect(text.includes(banned), `${file} contains ${banned}`).toBe(false);
      }
    });

    it(`${file}: no Financial Pulse table, and jobber_tokens only through getJobberToken`, () => {
      const pulseTable = firstMatch(code(file), PULSE_TABLE);
      expect(pulseTable, `${file} names the Pulse table ${pulseTable}`).toBeUndefined();
      expect(/\bjobber_tokens\b/.test(code(file)), `${file} names jobber_tokens`).toBe(false);
    });

    it(`${file}: takes only the five allowed names from jobber.ts, and nothing from _shared/pulse/`, () => {
      expect(pulseImportProblems(code(file))).toEqual([]);
    });
  }

  for (const file of NEW.filter((f) => f !== "jobberApi.ts")) {
    it(`${file}: leaves Jobber's address to jobberApi.ts`, () => {
      const hit = firstMatch(code(file), /JOBBER_GRAPHQL_URL|api\.getjobber\.com/);
      expect(hit, `${file} references ${hit}`).toBeUndefined();
    });
  }

  for (const file of PURE) {
    it(`${file}: pure, with no Deno globals, no network, no clock and no randomness`, () => {
      const hit = firstMatch(code(file), IMPURE);
      expect(hit, `${file} uses ${hit}`).toBeUndefined();
    });
  }

  it("the Pulse import check catches every way past the five names", () => {
    const sample = [
      'import { getJobberToken, type JobberReconnectRequired as Reconnect } from "./jobber.ts";',
      'import type { JOBBER_GRAPHQL_URL } from "./jobber";',
      'import { samePlace } from "./jobberAddress.ts";',
      'import { jobberGraphql } from "./jobber.ts";',
      'import * as pulseJobber from "./jobber.ts";',
      'import jobberDefault from "../_shared/jobber.ts";',
      'export { jobberHmac } from "./jobber.ts";',
      'import { pulseThing } from "./pulse/jobberSync.ts";',
      'import "./pulse/side.ts";',
      'const lazy = await import("./jobber.ts");',
      "import {\n  ownerIdOf,\n  timingSafeEqual,\n} from \"./jobber.ts\";",
    ].join("\n");
    const problems = pulseImportProblems(sample);
    for (const caught of ["jobberGraphql", "* as pulseJobber", "jobberDefault", "jobberHmac", "./pulse/jobberSync.ts", "./pulse/side.ts", 'import("./jobber.ts")', "timingSafeEqual"]) {
      expect(problems.filter((p) => p.includes(caught)), caught).toHaveLength(1);
    }
    expect(problems).toHaveLength(8);
    for (const allowed of ["getJobberToken", "Reconnect", "JOBBER_GRAPHQL_URL", "samePlace", "ownerIdOf"]) {
      expect(problems.some((p) => p.includes(allowed)), allowed).toBe(false);
    }
  });

  it("the purity check catches a clock, randomness, a runtime hook, Deno or the network", () => {
    for (const impure of ["const now = Date.now();", "const d = new Date();", "Math.random()", "EdgeRuntime.waitUntil(p)", "Deno.env.get(key)", "await fetch(url)"]) {
      expect(firstMatch(impure, IMPURE), impure).toBeDefined();
    }
    for (const pure of ["new Date(ms)", "new Date(noonOf(date))", "Date.parse(iso)", "Date.UTC(2026, 0, 1)"]) {
      expect(firstMatch(pure, IMPURE), pure).toBeUndefined();
    }
  });
});

describe("only the deployed Jobber functions use the new modules", () => {
  it("no other edge function imports a new module, directly or through another file", () => {
    const fresh = NEW.map((f) => `_shared/${f}`);
    const importers = functionNames(ROOT)
      .filter((fn: string) => !MAY_IMPORT_NEW.includes(fn))
      .flatMap((fn: string) =>
        functionFiles(ROOT, fn).filter((f: string) => fresh.includes(f)).map((f: string) => `${fn} imports ${f}`),
      );
    expect(importers).toEqual([]);
  });

  it("no web app file imports a Jobber sync module, so changing one never needs a Publish", () => {
    const importers = webAppFiles(join(ROOT, "src")).filter((f) => SYNC_MODULE_IMPORT.test(readFileSync(f, "utf8")));
    expect(importers).toEqual([]);
  });
});

describe("import-graph manifest (scripts/jobber-import-graph.mjs)", () => {
  const manifest = buildManifest(ROOT);

  it("covers every function and follows imports through other files", () => {
    expect(Object.keys(manifest.functions)).toEqual(functionNames(ROOT));
    expect(manifest.functions["bid-award"]).toContain("_shared/jobber.ts");
    // jobber-webhook reaches jobberRevenue.ts only through _shared/pulse/jobberSync.ts.
    expect(manifest.functions["jobber-webhook"]).toContain("_shared/pulse/jobberRevenue.ts");
    // plaid-sync reaches plaidCrypto.ts only through _shared/plaid.ts.
    expect(manifest.functions["plaid-sync"]).toContain("_shared/pulse/plaidCrypto.ts");
  });

  it("docs/jobber-sync/import-graph.json is current (regenerate: node scripts/jobber-import-graph.mjs)", () => {
    const saved = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"));
    expect(saved).toEqual(manifest);
  });

  it("reads static, multi-line, re-export, side-effect and dynamic imports, and nothing else", () => {
    const sample = [
      'import { a } from "./a.ts";',
      "import type { B } from '../b.ts';",
      "import {",
      "  c,",
      '} from "./c.ts";',
      'export { d } from "./d.ts";',
      'import "./e.ts";',
      'const f = await import("./f.ts");',
      '// import { g } from "./g.ts";',
      ' * import { h } from "./h.ts";',
      'import { createClient } from "npm:@supabase/supabase-js@2";',
      'const generated = `import ${name} from "./pages/${name}";`;',
      'const list = Array.from("./x.ts");',
    ].join("\n");
    expect(localImports(sample)).toEqual(["./a.ts", "../b.ts", "./c.ts", "./d.ts", "./e.ts", "./f.ts"]);
  });
});

describe("deploy list", () => {
  it("names the functions that import a changed shared file, whatever the path style", () => {
    for (const path of ["supabase/functions/_shared/jobber.ts", "_shared/jobber.ts", "supabase\\functions\\_shared\\jobber.ts"]) {
      const list = deployList(ROOT, [path]);
      expect(list).toEqual(expect.arrayContaining(["bid-award", "jobber-webhook", "pulse-get"]));
      expect(list).not.toContain("plaid-sync");
    }
  });

  it("a function's own file deploys only that function; web app files and docs deploy nothing", () => {
    expect(deployList(ROOT, ["supabase/functions/bid-hire/index.ts"])).toEqual(["bid-hire"]);
    expect(deployList(ROOT, ["src/pages/BidBoard.tsx", "docs/jobber-sync/README.md"])).toEqual([]);
  });
});

describe("jobber-webhook's older TreeCheck part", () => {
  it("keeps the older hire-on-approval behind the auto_hire switch, before any Jobber token is fetched", () => {
    const text = readFileSync(join(ROOT, "supabase", "functions", "jobber-webhook", "index.ts"), "utf8");
    const legacy = text.slice(text.indexOf("async function processLegacy("));
    const gate = legacy.indexOf('if (topic.startsWith("QUOTE_") && !switches.autoHire) return');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(legacy.indexOf("getJobberToken("));
    expect(gate).toBeLessThan(legacy.indexOf("/functions/v1/bid-hire"));
  });
});

describe("Jobber visit days on the Jobs calendar (JS2)", () => {
  const fn = (name: string) => readFileSync(join(ROOT, "supabase", "functions", name, "index.ts"), "utf8");

  it("crew-release-holds starts the sync on scheduled runs, with the service key", () => {
    const text = fn("crew-release-holds");
    const call = text.indexOf("/functions/v1/jobber-visit-days");
    expect(call).toBeGreaterThan(0);
    const block = text.slice(text.lastIndexOf("if (!force)", call), call + 300);
    expect(block).toContain("if (!force)");
    expect(block).toContain("Authorization: `Bearer ${SERVICE}`");
  });

  it("crew-release-holds keeps slot counting inside the dispatch loop, so a held job can't crash the run", () => {
    // 2026-10-20: the dispatch loop's slot check was pasted into the bid-request loop, where
    // `claimed` and `d` don't exist, and every scheduled run threw before the sync below.
    const text = fn("crew-release-holds");
    const dispatchLoop = text.indexOf("for (const d of dispatches");
    expect(dispatchLoop).toBeGreaterThan(0);
    const before = text.slice(0, dispatchLoop);
    expect(before).not.toMatch(/\bclaimed\b/);
    expect(before).not.toMatch(/\bd\.slots\b/);
  });

  it("jobber-visit-days refuses anyone but the service key before any work, and honours the kill switch", () => {
    const text = fn("jobber-visit-days");
    const refuse = text.indexOf("if (!SERVICE || bearer !== SERVICE) return json(");
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(text.indexOf("if (killSwitchOn())"));
    expect(text.indexOf("if (killSwitchOn())")).toBeLessThan(text.indexOf("createClient(SUPABASE_URL, SERVICE"));
  });

  it("the sync only reads Jobber and never texts, pushes or writes a job", () => {
    const text = code("jobberVisitDays.ts") + fn("jobber-visit-days");
    for (const banned of ["jobberMutate", "api.twilio.com", "send-push", "sendSms", '.from("bid_requests").update', '.from("bid_requests").insert']) {
      expect(text, banned).not.toContain(banned);
    }
    expect(code("jobberVisitDays.ts")).toContain('admin.rpc("replace_job_jobber_days"');
    expect(code("jobberVisitDays.ts")).toContain('admin.rpc("claim_jobber_visit_days"');
  });
});

describe("send-closeout-to-jobber", () => {
  it("skips leads from before the switch-on and claims the closeout before making an invoice", () => {
    const text = readFileSync(join(ROOT, "supabase", "functions", "send-closeout-to-jobber", "index.ts"), "utf8");
    const make = text.indexOf("await createCloseoutInvoice(");
    for (const step of [
      'from("company_jobber_settings").select("created_at")',
      'reason: "lead_before_jobber_sync"',
      'update({ jobber_sync_status: "syncing"',
      "jobber_sync_status.not.in.(syncing,uncertain)",
    ]) {
      expect(text.indexOf(step), step).toBeGreaterThan(0);
      expect(text.indexOf(step), step).toBeLessThan(make);
    }
    // The error path records the outcome without reading the request body a second time.
    expect(text).not.toContain("req.clone()");
  });
});
