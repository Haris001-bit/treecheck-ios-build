// The Jobber places limit (JC1, 2026-10-26): until Jobber approves the app, a sixth paying Jobber account would cut off
// Jobber for every company. jobber-connect hands out a Jobber link only through jobber_claim_connect; a company with no
// place sees Mark's stand by message and Mark gets one text and email. The pure texts are tested directly; the function
// and the reference SQL are read as source, so a later edit that drops a guard fails the suite. The SQL itself runs on
// PGlite (tools/pgtest/test-jc1.mjs in the engagement folder).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOBBER_WAITLIST_CODE,
  JOBBER_WAITLIST_MESSAGE,
  JOBBER_WAITLIST_TITLE,
  waitlistAlertEmail,
  waitlistAlertText,
} from "../../../supabase/functions/_shared/connectWaitlist";

// Line endings normalised: a Windows checkout has CRLF, the repo has LF.
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
// Code with comments removed, so a comment may name what the code must not do.
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("what the company sees", () => {
  it("is Mark's message, with stand by as two words and no dashes", () => {
    expect(JOBBER_WAITLIST_MESSAGE).toBe(
      "Please stand by as our Jobber integration is in the final phase of testing. We will contact you in the coming weeks when it's ready to connect.",
    );
    expect(JOBBER_WAITLIST_TITLE).toBe("Jobber connection coming soon");
    expect(`${JOBBER_WAITLIST_TITLE} ${JOBBER_WAITLIST_MESSAGE}`).not.toMatch(/[–—]/);
    expect(JOBBER_WAITLIST_CODE).toBe("jobber_waitlist");
  });
});

describe("the text Mark gets", () => {
  it("says who, that they got his message, the places in use and how to reach them", () => {
    const text = waitlistAlertText({
      company: "Acme Tree Co", owner: "Sam Lee", phone: "+14055550100", email: "sam@acme.test", used: 5, max: 5,
    });
    expect(text).toBe(
      "TreeCheck: Acme Tree Co tried to connect Jobber and got your stand by message, so they're on the Jobber waitlist. " +
        "Jobber places in use: 5 of 5.\nContact: Sam Lee, +14055550100, sam@acme.test",
    );
  });

  it("falls back to the owner's name, then to a plain description, and says when there is no way to reach them", () => {
    expect(waitlistAlertText({ owner: "Sam Lee", email: "sam@acme.test" })).toBe(
      "TreeCheck: Sam Lee tried to connect Jobber and got your stand by message, so they're on the Jobber waitlist.\nContact: sam@acme.test",
    );
    expect(waitlistAlertText({})).toBe(
      "TreeCheck: A company tried to connect Jobber and got your stand by message, so they're on the Jobber waitlist.\n" +
        "No phone or email on the account.",
    );
  });

  it("leaves out the places when they are unknown or not whole numbers", () => {
    for (const places of [{ used: 2 }, { max: 5 }, { used: -1, max: 5 }, { used: 1.5, max: 5 }, { used: "2", max: 5 }]) {
      expect(waitlistAlertText({ company: "Acme", ...(places as object) })).not.toContain("places in use");
    }
    expect(waitlistAlertText({ company: "Acme", used: 2, max: 5 })).toContain("Jobber places in use: 2 of 5.");
  });

  it("stays short even when every field is long, and strips dashes owners typed", () => {
    const long = "x".repeat(500);
    const text = waitlistAlertText({ company: long, owner: long, phone: long, email: long, used: 5, max: 5 });
    expect(text.length).toBeLessThan(420);
    expect(waitlistAlertText({ company: "Acme — Tree – Co" })).not.toMatch(/[–—]/);
  });

  it("the email says the same, with a subject naming the company, and escapes what owners typed", () => {
    const mail = waitlistAlertEmail({ company: "<b>Acme</b> & Co", owner: "Sam", email: "sam@acme.test", used: 4, max: 5 });
    expect(mail.subject).toBe("TreeCheck: <b>Acme</b> & Co is on the Jobber waitlist");
    expect(mail.html).toContain("&lt;b&gt;Acme&lt;/b&gt; &amp; Co tried to connect Jobber");
    expect(mail.html).toContain("Jobber places in use: 4 of 5.");
    expect(mail.html).toContain("<p>Contact: Sam, sam@acme.test</p>");
    expect(mail.html).not.toContain("<b>");
  });
});

describe("jobber-connect", () => {
  const fn = code(read("supabase", "functions", "jobber-connect", "index.ts"));

  it("records a Jobber link only through jobber_claim_connect, never by writing the state itself", () => {
    expect(fn).toContain('admin.rpc("jobber_claim_connect"');
    expect(fn).not.toMatch(/from\(\s*["']jobber_oauth_states["']\s*\)\s*\.\s*(insert|upsert|update)/);
  });

  it("claims before it builds the Jobber link, and stops unless the claim says allowed", () => {
    const claimAt = fn.indexOf('admin.rpc("jobber_claim_connect"');
    const refuseAt = fn.indexOf("if (claim?.allowed !== true)");
    const linkAt = fn.indexOf('new URL("https://api.getjobber.com/api/oauth/authorize")');
    expect(claimAt).toBeGreaterThan(0);
    expect(refuseAt).toBeGreaterThan(claimAt);
    expect(linkAt).toBeGreaterThan(refuseAt);
    expect(fn).toContain("if (cErr) throw new Error(");
  });

  it("answers the waitlist with HTTP 200 and the code, title and Mark's message", () => {
    expect(fn).toContain("return json({ code: JOBBER_WAITLIST_CODE, title: JOBBER_WAITLIST_TITLE, error: JOBBER_WAITLIST_MESSAGE });");
  });

  it("stays quiet for sandbox and demo companies, before claiming the alert", () => {
    const quietAt = fn.indexOf("if (ctx.quiet)");
    expect(fn).toContain('notifyCtx(admin, ownerId, "jobber-connect")');
    expect(quietAt).toBeGreaterThan(0);
    expect(fn.indexOf('.from("jobber_waitlist").update({ alerted_at: new Date().toISOString() })')).toBeGreaterThan(quietAt);
  });

  it("alerts Mark once per company: claims alerted_at where empty, and lets it go only when nothing went out", () => {
    expect(fn).toContain('.eq("owner_id", ownerId).is("alerted_at", null).select("owner_id")');
    expect(fn).toContain("if (!claimed || claimed.length === 0) return;");
    expect(fn).toContain('if (!texted && !emailed) await admin.from("jobber_waitlist").update({ alerted_at: null }).eq("owner_id", ownerId);');
  });

  it("texts only Mark's number and emails only his TreeCheck admin address", () => {
    expect(fn).toContain('const ADMIN_PHONE = "+13036693816";');
    expect(fn).toContain('const ADMIN_EMAIL = "mark@tradesmarketing.ai";');
    expect(fn.match(/sendSms\(([^,]+),/g)?.every((c) => c.includes("ADMIN_PHONE"))).toBe(true);
    expect(fn.match(/sendEmail\(([^,]+),/g)?.every((c) => c.includes("ADMIN_EMAIL"))).toBe(true);
  });

  it("still lets only the account owner connect", () => {
    expect(fn.indexOf('code: "owner_only"')).toBeGreaterThan(0);
    expect(fn.indexOf('code: "owner_only"')).toBeLessThan(fn.indexOf('admin.rpc("jobber_claim_connect"'));
  });
});

describe("JC1 (reference SQL)", () => {
  const sql = read("docs", "onboarding", "sql", "JC1_jobber_connect_limit.sql");

  it("starts at 5 places, open only to companies Mark chooses, and never resets the settings", () => {
    expect(sql).toContain("select true, 5, false,");
    expect(sql).toContain("on conflict (id) do nothing;");
  });

  it("counts connected companies and 30-minute holds, under one lock, and records the link only when allowed", () => {
    expect(sql).toContain("perform pg_advisory_xact_lock(hashtext('public.jobber_claim_connect'));");
    expect(sql).toContain("where a.started_at > now() - interval '30 minutes'");
    expect(sql).toContain("if v_used >= v_max or (not coalesce(v_open, false) and not coalesce(p_owner = any (v_chosen), false)) then");
    expect(sql.indexOf("insert into public.jobber_oauth_states")).toBeGreaterThan(sql.indexOf("if v_used >= v_max"));
  });

  it("keeps the limit on at 5 when the settings row is missing", () => {
    expect(sql).toMatch(/if not found then\s+-- No settings row[^\n]*\n\s+v_max := 5;/);
  });

  it("gives the browser no access, and the claim to the service role only", () => {
    expect(sql).toContain("revoke all on function public.jobber_claim_connect(uuid, text, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.jobber_claim_connect(uuid, text, text) to service_role;");
    expect(sql).not.toMatch(/create policy/i);
  });
});
