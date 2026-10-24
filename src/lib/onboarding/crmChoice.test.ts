// A company on a CRM other than Jobber (Mark, 2026-10-22): the setup screen says it won't sync yet and that the team
// will reach out, Scout's checklist stops sending it to the Jobber page, and crm-interest-alert texts and emails Mark once. The
// pure rules are tested directly; the screens and the function are read as source, so a later edit that drops a
// guard fails the suite (as signupGuards.test.ts does).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRM_LABELS, CRM_OPTIONS, crmAlertEmail, crmAlertKey, crmAlertText, otherCrmName } from "../../../supabase/functions/_shared/crmChoice";

// Line endings normalised: a Windows checkout has CRLF, the repo has LF.
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");

describe("which CRM a company names", () => {
  it("Jobber, none and nothing need no call", () => {
    for (const [crm, other] of [["jobber", null], ["none", null], ["", null], [null, null], ["other", ""], ["other", "   "], ["other", "Jobber"], ["other", " jobber "]] as const) {
      expect(otherCrmName(crm, other), `${crm}/${other}`).toBeNull();
      expect(crmAlertKey(crm, other), `${crm}/${other}`).toBeNull();
    }
  });

  it("the offered CRMs read by their own names, and the typed one is tidied", () => {
    expect(otherCrmName("servicetitan", null)).toBe("ServiceTitan");
    expect(otherCrmName("housecall_pro", "ignored")).toBe("Housecall Pro");
    expect(otherCrmName("zoho", null)).toBe("Zoho");
    expect(otherCrmName("other", "  Service   Autopilot \n")).toBe("Service Autopilot");
    expect(otherCrmName("other", "x".repeat(200))).toHaveLength(60);
    expect(otherCrmName("unknown_value", null)).toBeNull();
  });

  it("one key per company and CRM: the saved value, or the typed name in lower case", () => {
    expect(crmAlertKey("servicetitan", null)).toBe("servicetitan");
    expect(crmAlertKey("other", "Service Autopilot")).toBe("other:service autopilot");
    expect(crmAlertKey("other", "service  AUTOPILOT")).toBe("other:service autopilot");
    expect((crmAlertKey("other", "y".repeat(200)) ?? "").length).toBeLessThanOrEqual(80);
  });

  it("setup offers the shared list (Jobber first), then Other and None, so Mark's text names the same CRMs", () => {
    const form = read("src", "components", "CompanySetupForm.tsx");
    expect(form).toContain("const CRMS: Opt[] = [...CRM_OPTIONS, { value: 'other', label: 'Other' }, { value: 'none', label: 'None' }];");
    expect(CRM_OPTIONS[0]).toEqual({ value: "jobber", label: "Jobber" });
    const values = CRM_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).not.toContain("other");
    expect(values).not.toContain("none");
    for (const v of values.filter((v) => v !== "jobber")) expect(otherCrmName(v, null), v).toBe(CRM_LABELS[v]);
  });

  it("lists the tree-care tools and the common field-service and general CRMs", () => {
    expect(CRM_OPTIONS.map((o) => o.label)).toEqual([
      "Jobber", "ArboStar", "Arborgold", "SingleOps", "QuoteIQ", "ServiceTitan", "Housecall Pro", "Service Autopilot",
      "Aspire", "Workiz", "GoHighLevel", "HubSpot", "Salesforce", "Zoho",
    ]);
    expect(otherCrmName("arbostar", null)).toBe("ArboStar");
    expect(crmAlertKey("service_autopilot", null)).toBe("service_autopilot");
  });
});

describe("the text Mark gets", () => {
  it("says who, which CRM and how to reach them, with no dashes", () => {
    const text = crmAlertText({ crm: "ServiceTitan", company: "Acme Tree Co", owner: "Jo Example", phone: "+1 405 555 0100", email: "jo@example.test" });
    expect(text).toContain("Acme Tree Co uses ServiceTitan");
    expect(text).toContain("not Jobber");
    expect(text).toContain("Contact: Jo Example, +1 405 555 0100, jo@example.test");
    expect(text).not.toMatch(/[–—]/);
  });

  it("falls back to the owner's name, then to a plain description, and says when there is no way to reach them", () => {
    expect(crmAlertText({ crm: "Zoho", owner: "Jo Example", email: "jo@example.test" })).toContain("Jo Example uses Zoho");
    const bare = crmAlertText({ crm: "Zoho" });
    expect(bare).toContain("A new company uses Zoho");
    expect(bare).toContain("No phone or email on the account.");
  });

  it("stays short even when every field is long", () => {
    const long = "z".repeat(500);
    expect(crmAlertText({ crm: long, company: long, owner: long, phone: long, email: long }).length).toBeLessThan(480);
  });

  it("strips dashes the owner typed", () => {
    expect(crmAlertText({ crm: "Field—Pro", company: "A–B Trees" })).not.toMatch(/[–—]/);
  });

  it("the email says the same, with a subject naming the company and CRM, and escapes what owners typed", () => {
    const mail = crmAlertEmail({ crm: "ServiceTitan", company: "Acme Tree Co", owner: "Jo Example", phone: "+1 405 555 0100", email: "jo@example.test" });
    expect(mail.subject).toBe("TreeCheck: Acme Tree Co uses ServiceTitan, not Jobber");
    expect(mail.html).toContain("<p>TreeCheck: Acme Tree Co uses ServiceTitan for their CRM, not Jobber");
    expect(mail.html).toContain("<p>Contact: Jo Example, +1 405 555 0100, jo@example.test</p>");
    const odd = crmAlertEmail({ crm: "<script>x</script>", company: 'A & B "Trees" <b>' });
    expect(odd.html).not.toMatch(/<script|<b>/);
    expect(odd.html).toContain("A &amp; B &quot;Trees&quot; &lt;b&gt;");
    expect(crmAlertEmail({ crm: "Field—Pro", company: "A–B" }).subject).not.toMatch(/[–—]/);
  });
});

describe("the screens", () => {
  it("setup says another CRM won't sync yet, that the team will reach out, and asks the server to text Mark after saving", () => {
    const form = read("src", "components", "CompanySetupForm.tsx");
    expect(form).toContain("TreeCheck syncs with Jobber today, not {otherCrmName(s.crm, s.crm_other) ?? 'your CRM'} yet.");
    // Shown for every choice but Jobber, as a highlighted box at normal size, not small grey text.
    expect(form).toContain("{s.crm !== 'jobber' && (");
    expect(form).toContain('<div role="status" className="flex items-start gap-3 rounded-lg border-2 border-primary/60 bg-primary/10 p-4 text-sm leading-relaxed">');
    expect(form).toContain("TreeCheck syncs with Jobber today.</span> Without a CRM you can print or text quotes straight from the app.");
    expect(form.replace(/\s+/g, " ")).toContain("Our team will reach out to help you get set up.");
    // "Other" opens a labelled box for the CRM's name; the list shows two per row.
    expect(form).toContain('<Label htmlFor="crm-other">Which CRM do you use?</Label>');
    expect(form).toContain('placeholder="Type the name of your CRM"');
    expect(form).toContain("<Choice opts={CRMS} value={[s.crm]} onChange={([v]) => set({ crm: v })} twoColumns />");
    const finish = form.slice(form.indexOf("const finish = async"));
    const save = finish.indexOf("saveSettings.mutateAsync");
    const call = finish.indexOf("functions.invoke('crm-interest-alert'");
    expect(save).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(save);
    // Sends nothing the server would trust: the function reads the saved answer itself.
    expect(finish).toContain("functions.invoke('crm-interest-alert', { body: {} })");
  });

  it("Scout's checklist never sends a company on another CRM to the Jobber page", () => {
    const page = read("src", "pages", "ScoutStart.tsx");
    expect(page).toContain("otherCrmName(company?.crm, company?.crm_other)");
    expect(page).toMatch(/\.\.\.\(otherCrm \? \[\] : \[\{ done: status\?\.crm, label: 'Connect your CRM', to: '\/dashboard\/integrations\/jobber' \}\]\)/);
    expect(page).toContain("doesn't sync with TreeCheck yet. Our team will reach out");
  });
});

describe("crm-interest-alert", () => {
  const code = read("supabase", "functions", "crm-interest-alert", "index.ts");
  it("reads the caller's own saved answer, never the request body", () => {
    expect(code).toContain('.from("company_settings").select("crm, crm_other").eq("contractor_id", userId)');
    expect(code).not.toMatch(/req\.json\(\)|await req\.text\(\)/);
  });
  it("stays quiet for sandbox and demo companies, before claiming anything", () => {
    const quiet = code.indexOf("if (ctx.quiet)");
    expect(code).toContain('notifyCtx(admin, userId, "crm-interest-alert")');
    expect(quiet).toBeGreaterThan(-1);
    expect(quiet).toBeLessThan(code.indexOf('.from("crm_interest_alerts")'));
  });
  it("claims the company and CRM before texting and emailing, so two calls never alert twice", () => {
    expect(code).toContain('{ onConflict: "contractor_id,crm_key", ignoreDuplicates: true }');
    expect(code.indexOf("ignoreDuplicates")).toBeLessThan(code.indexOf("const [texted, emailed] = await Promise.all(["));
  });
  it("lets the claim go only when neither the text nor the email went out, so one that went is never repeated", () => {
    expect(code).toContain('if (!texted && !emailed) await admin.from("crm_interest_alerts").delete()');
  });
  it("texts only Mark's number and emails only his TreeCheck admin address", () => {
    expect(code).toContain('const ADMIN_PHONE = "+13036693816";');
    expect(code).toContain('const ADMIN_EMAIL = "mark@tradesmarketing.ai";');
    expect([...code.matchAll(/sendSms\(\s*([A-Z_a-z]+)/g)].map((m) => m[1])).toEqual(["ADMIN_PHONE", "ADMIN_PHONE"]);
    expect([...code.matchAll(/sendEmail\(\s*([A-Z_a-z]+)/g)].map((m) => m[1])).toEqual(["ADMIN_EMAIL", "ADMIN_EMAIL"]);
  });
});
