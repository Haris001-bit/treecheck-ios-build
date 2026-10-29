// The demo company's off switch (milestone 2). A sandbox company (profiles.is_sandbox) never reaches anyone outside
// itself: these functions ask tcNotify's companyMode before they link, invite or text anyone. The checks read the
// source, so a later edit that drops or moves a check fails the suite.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FUNCTIONS = join(process.cwd(), "supabase", "functions");

// For each function: the calls that reach or bring in people outside the company, and the companyMode answers it acts on.
// Network linking needs a confirmed live company; everything else is skipped or refused only for a confirmed sandbox,
// so a failed read never stops a real company's messages. bid-request-create does both: it links only for a confirmed
// live company, and since Lovable's 2026-10-28 demo change it also skips its texts for a confirmed sandbox.
const GATES: { fn: string; outward: string[]; acts: ("live" | "sandbox")[] }[] = [
  { fn: "bid-request-create", outward: ["linkNetworkSubs(", "notifyBidRequest(admin"], acts: ["live", "sandbox"] },
  { fn: "network-connect", outward: ['from("crew_members").insert(', "sendSms("], acts: ["sandbox"] },
  { fn: "crew-join", outward: ["createUser(", 'from("crew_members").insert(', "sendSms("], acts: ["sandbox"] },
  { fn: "crew-invite", outward: ["createUser(", 'from("crew_members").insert(', "sendSms("], acts: ["sandbox"] },
  { fn: "invite-team-member", outward: ['from("team_invitations")', "sendEmail(", "sendSms("], acts: ["sandbox"] },
  { fn: "job-visit-text", outward: ["sendSms(", "sendPush("], acts: ["sandbox"] },
  { fn: "send-review-request", outward: ["api.twilio.com"], acts: ["sandbox"] },
  { fn: "scout-submit", outward: ["api.twilio.com", "+13036693816"], acts: ["sandbox"] },
];

/** The request handler only: helpers defined above it may mention the same calls. */
function handler(fn: string): string {
  const src = readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8");
  const start = src.indexOf("Deno.serve(");
  expect(start, `${fn} has a Deno.serve handler`).toBeGreaterThan(0);
  return src.slice(start);
}

describe("the demo company's off switch", () => {
  for (const { fn, outward, acts } of GATES) {
    it(`${fn} asks companyMode before it reaches anyone outside the company`, () => {
      const code = handler(fn);
      const check = code.indexOf("companyMode(");
      expect(check, `${fn} calls companyMode`).toBeGreaterThan(0);
      for (const marker of outward) {
        const at = code.indexOf(marker);
        expect(at, `${fn} still contains ${marker}`).toBeGreaterThan(0);
        expect(check, `${fn}: companyMode comes before ${marker}`).toBeLessThan(at);
      }
    });

    it(`${fn} acts only on a confirmed ${acts.map((a) => `"${a}"`).join(" or ")} answer`, () => {
      const answers = [...handler(fn).matchAll(/companyMode\([^)]*\)\)\s*===\s*["'](\w+)["']/g)].map((m) => m[1]);
      expect(answers.length, `${fn} compares companyMode's answer`).toBeGreaterThan(0);
      expect(new Set(answers)).toEqual(new Set(acts));
    });
  }

  it("bid-request-create links network subs only for a confirmed live company, and texts no one for a demo", () => {
    const code = handler("bid-request-create");
    const live = code.indexOf('companyMode(admin, ownerId)) === "live"');
    const link = code.indexOf("linkNetworkSubs(");
    expect(live).toBeGreaterThan(0);
    expect(live).toBeLessThan(link);
    expect(link - live, "the live check guards the linking itself").toBeLessThan(400);
    const demoReturn = code.indexOf("if (demoCompany) {");
    expect(demoReturn).toBeGreaterThan(0);
    expect(demoReturn).toBeLessThan(code.indexOf("notifyBidRequest(admin"));
  });

  it("imports companyMode from the shared tcNotify module in every gated function", () => {
    for (const { fn } of GATES) {
      const src = readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8");
      expect(src, fn).toMatch(/import \{ companyMode \} from ["']\.\.\/_shared\/tcNotify\.ts["'];/);
    }
  });
});
