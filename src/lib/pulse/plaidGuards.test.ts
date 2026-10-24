// Financial Pulse guard tests (A14): Plaid data never reaches an AI service, and a Plaid access
// token is never sent back to a browser. These read the source files, so a later edit that breaks
// either rule fails the test suite.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FUNCTIONS = join(process.cwd(), "supabase", "functions");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Every file that handles Plaid data: the Plaid and Pulse functions and their shared code. */
const plaidTouching = (): string[] => {
  const dirs = readdirSync(FUNCTIONS).filter((d) => /^(plaid-|pulse-)/.test(d)).map((d) => join(FUNCTIONS, d));
  return [
    ...dirs.flatMap(filesUnder),
    join(FUNCTIONS, "_shared", "plaid.ts"),
    join(FUNCTIONS, "_shared", "pulseHttp.ts"),
    ...filesUnder(join(FUNCTIONS, "_shared", "pulse")),
  ];
};

describe("Plaid guards", () => {
  it("finds the Plaid functions (so the guards cannot pass on an empty list)", () => {
    const files = plaidTouching().map((f) => f.replace(/\\/g, "/"));
    for (const expected of ["plaid-link-token/index.ts", "plaid-exchange/index.ts", "plaid-webhook/index.ts", "plaid-sync/index.ts", "_shared/plaid.ts"]) {
      expect(files.some((f) => f.endsWith(expected)), expected).toBe(true);
    }
  });

  it("never references an AI service or automation webhook in code that handles Plaid data", () => {
    // Real usage (keys, API hosts, calls to other functions), not names: a merchant list may name
    // an AI company as a software vendor.
    const banned =
      /LOVABLE_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_AI|ai\.gateway|gateway\.lovable|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|functions\/v1\/scout|functions\.invoke\(\s*["']scout|n8n\.|webhook\.site/i;
    for (const f of plaidTouching()) {
      const text = readFileSync(f, "utf8");
      expect(banned.test(text), `${f} mentions an AI or automation service`).toBe(false);
    }
  });

  it("never puts an access token in a response body", () => {
    for (const f of plaidTouching()) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/json\(\s*\{[^)]*\}/g)) {
        expect(/access_token|accessToken/.test(m[0]), `${f}: ${m[0].slice(0, 80)}`).toBe(false);
      }
    }
  });
});
