// The event demo company (milestone 2): the login pair and its one-tap switch, the live website post, and the order
// rules that keep the demo away from Mark's real logins and real site. Pure helpers are tested directly; the edge
// functions and the button are checked from their source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_SWITCH_OPTIONS } from "./demoLogins";
import {
  DEMO_CLIMBER_ID,
  DEMO_EMAILS,
  DEMO_LOGINS,
  DEMO_OWNER_ID,
  LIVE_POST_MINUTES,
  demoLoginIds,
  demoPostUrl,
  liveSince,
  otherDemoLogin,
  publicPost,
} from "../../../supabase/functions/_shared/demoCompany";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const handler = (fn: string) => {
  const src = read("supabase", "functions", fn, "index.ts");
  return src.slice(src.indexOf("Deno.serve("));
};

describe("the demo logins", () => {
  it("pair the owner and the climber, each opening on their own screen, and nobody else", () => {
    expect(otherDemoLogin(DEMO_OWNER_ID)).toEqual({ id: DEMO_CLIMBER_ID, open: "/dashboard/crew-bids" });
    expect(otherDemoLogin(DEMO_CLIMBER_ID)).toEqual({ id: DEMO_OWNER_ID, open: "/dashboard/bid-board" });
    expect(otherDemoLogin("705cecc2-5926-48c1-a728-b3ebd6b920a2")).toBeNull();
    expect(otherDemoLogin("")).toBeNull();
  });

  it("are the ones the setup script prepares", () => {
    const sql = read("docs", "demo", "demo_setup.sql");
    expect(sql).toContain(DEMO_OWNER_ID);
    expect(sql).toContain(DEMO_CLIMBER_ID);
  });

  it("switch only after demo-switch checks the caller is one of the pair and both are sandbox", () => {
    const code = handler("demo-switch");
    const link = code.indexOf("generateLink(");
    expect(link).toBeGreaterThan(0);
    expect(code.indexOf("otherDemoLogin(")).toBeGreaterThan(0);
    expect(code.indexOf("otherDemoLogin(")).toBeLessThan(link);
    expect(code.indexOf("is_sandbox === true")).toBeGreaterThan(0);
    expect(code.indexOf("is_sandbox === true")).toBeLessThan(link);
    expect(code).not.toMatch(/password/i);
  });

  it("the picker's logins: the Timber pair by id, the large-company pair by the emails the seed sets up", () => {
    expect(DEMO_LOGINS.map((l) => l.key)).toEqual(DEMO_SWITCH_OPTIONS.map((o) => o.key));
    const found = [
      { id: "e0000000-0000-0000-0000-0000000000a1", email: "BigOak.Owner@treecheck.test" },
      { id: "e0000000-0000-0000-0000-0000000000a2", email: "bigoak.crew@treecheck.test" },
      { id: "e0000000-0000-0000-0000-0000000000a3", email: "someone@else.test" },
    ];
    expect(Object.fromEntries(demoLoginIds(found))).toEqual({
      timber_owner: DEMO_OWNER_ID, timber_climber: DEMO_CLIMBER_ID,
      bigoak_owner: "e0000000-0000-0000-0000-0000000000a1", bigoak_crew: "e0000000-0000-0000-0000-0000000000a2",
    });
    expect(Object.keys(Object.fromEntries(demoLoginIds([])))).toEqual(["timber_owner", "timber_climber"]);
    const seed = read("docs", "demo", "demo_production_setup.sql");
    for (const email of DEMO_EMAILS) expect(seed).toContain(email);
  });

  it("with a target, demo-switch checks the caller is a demo login and both are sandbox before any sign-in link", () => {
    const code = handler("demo-switch");
    const link = code.indexOf("generateLink(");
    const callerCheck = code.indexOf("if (![...ids.values()].includes(u.user.id))");
    expect(callerCheck).toBeGreaterThan(0);
    expect(callerCheck).toBeLessThan(link);
    expect(code.indexOf("DEMO_LOGINS.find(")).toBeLessThan(link);
    expect(code.indexOf("is_sandbox === true")).toBeLessThan(link);
  });

  it("switch from a button that signs in with the one-time token, clears the cache and never signs out", () => {
    const button = read("src", "components", "DemoSwitchButton.tsx");
    expect(button).toContain("verifyOtp(");
    expect(button).toContain("queryClient.clear()");
    expect(button).toContain("profile?.is_sandbox");
    expect(button).not.toContain("signOut");
    expect(button).not.toMatch(/signInWithPassword|password\s*:/);
  });
});

describe("the live website post", () => {
  it("stays live for 5 minutes", () => {
    expect(LIVE_POST_MINUTES).toBe(5);
    expect(liveSince(Date.parse("2026-11-12T15:05:00Z"))).toBe("2026-11-12T15:00:00.000Z");
    expect(demoPostUrl("oak removal")).toBe("https://timberedmond.com/projects/live/oak%20removal");
  });

  it("gives the website only the post's own text and photos", () => {
    const post = publicPost(
      "large-oak-removal-edmond",
      {
        title: "Large Oak Removal",
        intro: "Intro",
        sections: [{ heading: "H", paragraphs: ["a", 5], bullets: ["b"], extra: "x" }],
        photoAlts: ["Oak before removal"],
        heroAlt: "Oak",
        contractorEmail: "someone@example.com",
      },
      ["https://example.test/signed/1", "https://example.test/signed/2"],
      "2026-11-12T15:00:00Z",
    );
    expect(Object.keys(post).sort()).toEqual([
      "ctaHeadline", "ctaSub", "expiresAt", "heroAlt", "intro", "location", "metaDescription", "photos",
      "publishedAt", "sections", "seoTitle", "shortDescription", "slug", "title", "whyChoices", "whyChoicesHeading",
    ]);
    expect(post.sections).toEqual([{ heading: "H", paragraphs: ["a"], bullets: ["b"], recommendations: [] }]);
    expect(post.photos).toEqual([
      { url: "https://example.test/signed/1", alt: "Oak before removal" },
      { url: "https://example.test/signed/2", alt: "Oak" },
    ]);
    expect(post.expiresAt).toBe("2026-11-12T15:05:00.000Z");
    expect(JSON.stringify(post)).not.toContain("someone@example.com");
  });

  it("comes only from the demo company's rows, from a public read-only function", () => {
    const code = handler("dma-live-posts");
    expect(code).toContain('.eq("contractor_id", DEMO_OWNER_ID)');
    expect(code).toContain(".gte(\"published_at\", liveSince(");
    expect(code).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(read("supabase", "config.toml")).toMatch(/\[functions\.dma-live-posts\]\r?\nverify_jwt = false/);
    expect(read("supabase", "config.toml")).not.toContain("[functions.demo-switch]");
  });

  it("is saved by dma-publish-project's demo branch, which returns before any GitHub or webhook write", () => {
    const code = handler("dma-publish-project");
    expect(code).toMatch(/!TIMBER_CONTRACTOR_IDS\.has\(effectiveContractorId\) && !isDemo/);
    const demo = code.indexOf("if (isDemo) {");
    expect(demo).toBeGreaterThan(0);
    const demoReturn = code.indexOf("return new Response(", demo);
    for (const write of ["fetch(webhookUrl", "putTextFile(", "putBinaryFile("]) {
      const at = code.indexOf(write);
      expect(at, write).toBeGreaterThan(0);
      expect(demoReturn, `the demo branch returns before ${write}`).toBeLessThan(at);
    }
    const branch = code.slice(demo, demoReturn);
    expect(branch).not.toMatch(/GitHubAPI|putTextFile|putBinaryFile|webhookUrl/);
    expect(branch).toContain('.eq("contractor_id", DEMO_OWNER_ID)');
    // Every save restarts the live window, so a fix made after 5 minutes still shows.
    expect(branch).toContain("published_at: new Date().toISOString()");
    expect(branch).not.toContain("existingRow!.published_at");
  });
});

describe("the demo stays off the shared network", () => {
  it("hides the climber's network switch and the owner's real-sub directory for demo logins", () => {
    const settings = read("src", "components", "SubNetwork.tsx");
    expect(settings).toContain("if (!profile || account?.is_sandbox) return null;");
    const people = read("src", "pages", "CrewNetwork.tsx");
    expect(people).toContain("const isDemo = account?.is_sandbox === true;");
    expect(people).toContain("{tab === 'find' && !isDemo ? <FindSubsNearYou ");
    expect(people).toContain("{!isDemo && <Button variant=\"outline\" className=\"mt-3\" onClick={() => setTab('find')}>Find subs near you</Button>}");
  });
});
