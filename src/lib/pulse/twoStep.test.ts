// Two-step sign-in before bank linking: reading the session level from the access token, and the
// guard that plaid-link-token and plaid-exchange check it before doing anything.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasTwoStep, sessionLevel, TWO_STEP_CODE } from "../../../supabase/functions/_shared/pulse/twoStep";
import { TWO_STEP_CODE as API_TWO_STEP_CODE } from "./api";

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function token(claims: Record<string, unknown>): string {
  return `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}.signature`;
}

describe("sessionLevel", () => {
  it("reads aal2 and aal1 from a bearer header", () => {
    expect(sessionLevel(`Bearer ${token({ sub: "u1", aal: "aal2" })}`)).toBe("aal2");
    expect(sessionLevel(`Bearer ${token({ sub: "u1", aal: "aal1" })}`)).toBe("aal1");
    expect(sessionLevel(`bearer ${token({ aal: "aal2" })}`)).toBe("aal2");
  });

  it("handles base64url characters and non-ASCII claims", () => {
    const t = token({ aal: "aal2", email: "josé@exämple.com", x: "~~~>>>???" });
    expect(t.split(".")[1]).toMatch(/[-_]/);
    expect(sessionLevel(`Bearer ${t}`)).toBe("aal2");
  });

  it("returns null when the level can't be read", () => {
    expect(sessionLevel(`Bearer ${token({ sub: "u1" })}`)).toBeNull();
    expect(sessionLevel(`Bearer ${token({ aal: 2 })}`)).toBeNull();
    expect(sessionLevel("Bearer abc")).toBeNull();
    expect(sessionLevel("Bearer a.%%%.c")).toBeNull();
    expect(sessionLevel(`Bearer x.${base64url("not json")}.y`)).toBeNull();
    expect(sessionLevel(`Bearer x.${base64url("null")}.y`)).toBeNull();
    expect(sessionLevel("")).toBeNull();
    expect(sessionLevel(null)).toBeNull();
    expect(sessionLevel(undefined)).toBeNull();
  });
});

describe("hasTwoStep", () => {
  it("is true only for aal2", () => {
    expect(hasTwoStep(`Bearer ${token({ aal: "aal2" })}`)).toBe(true);
    expect(hasTwoStep(`Bearer ${token({ aal: "aal1" })}`)).toBe(false);
    expect(hasTwoStep(`Bearer ${token({})}`)).toBe(false);
    expect(hasTwoStep(null)).toBe(false);
  });

  it("the web app and the functions share one refusal code", () => {
    expect(API_TWO_STEP_CODE).toBe(TWO_STEP_CODE);
    expect(TWO_STEP_CODE).toBe("mfa_required");
  });
});

describe("the bank-linking functions check two-step sign-in first", () => {
  const CHECK = 'if (!hasTwoStep(req.headers.get("Authorization"))) return fail(TWO_STEP_CODE, TWO_STEP_MESSAGE);';

  it.each(["plaid-link-token", "plaid-exchange"])("%s", (fn) => {
    const src = readFileSync(join(process.cwd(), "supabase", "functions", fn, "index.ts"), "utf8");
    const at = src.indexOf(CHECK);
    expect(at, `${fn} must refuse without two-step sign-in`).toBeGreaterThan(-1);
    // After the token is verified (callerOf) and the owner is known...
    expect(at).toBeGreaterThan(src.indexOf("await callerOf(req, admin)"));
    expect(at).toBeGreaterThan(src.indexOf("if (!caller.ownerId)"));
    // ...and before the body is read, the database is touched or Plaid is called.
    const body = src.slice(src.indexOf("Deno.serve"));
    const bodyAt = src.indexOf("Deno.serve");
    for (const later of ["bodyOf(req)", ".from(", ".rpc(", "plaidPost(", "loadItem("]) {
      const first = body.indexOf(later);
      if (first >= 0) expect(at, `${fn}: ${later} runs before the two-step check`).toBeLessThan(bodyAt + first);
    }
  });
});
