// Jobber milestone notifications: the quiet guard (it fails closed, only a confirmed sandbox's quiet log
// holds the text, and no log ever holds the destination), the real Twilio, send-push and Gmail
// connector calls, the office contact list, and alertOnce. fetch and the Supabase client are stubbed;
// numbers are from the fictional 555-01xx range and addresses use example.com.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alertOnce,
  companyMode,
  type NotifyCtx,
  notifyCtx,
  officeContacts,
  quietCompany,
  sendEmail,
  sendPush,
  sendSms,
} from "../../../supabase/functions/_shared/tcNotify";

const ENV: Record<string, string> = {
  TWILIO_ACCOUNT_SID: "AC-test-sid",
  TWILIO_AUTH_TOKEN: "test-auth",
  TWILIO_PHONE_NUMBER: "+14055550100",
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  LOVABLE_API_KEY: "lovable-test",
  GOOGLE_MAIL_API_KEY: "gmail-connection-test",
};
const PHONE = "(405) 555-0142";
const EMAIL = "office@example.com";
const LOUD: NotifyCtx = { quiet: false, fn: "bid-award", kind: "M2", role: "owner" };
// A confirmed sandbox company: nothing is sent and the full text is logged for Haris to read.
const SANDBOX: NotifyCtx = { ...LOUD, quiet: true, sandbox: true };
// Quiet without a confirmed sandbox (the flag could not be read): nothing is sent and no text is logged.
const UNSURE: NotifyCtx = { ...LOUD, quiet: true };

function stubFetch(reply: { status?: number; body?: unknown } | Error = { status: 200, body: {} }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function setEnv(vars: Record<string, string>) {
  vi.stubGlobal("Deno", { env: { get: (k: string) => vars[k] } });
}

/** Everything written to the console, as one string per call. */
function consoleText(): string[] {
  const spies = [console.log, console.warn, console.error] as unknown as { mock: { calls: unknown[][] } }[];
  return spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")));
}

/** The raw MIME message the Gmail connector was sent. */
function mimeOf(init: RequestInit): string {
  const raw = JSON.parse(String(init.body)).raw as string;
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** The number Twilio was asked to text in the first call. */
const textedTo = (calls: { init: RequestInit }[]) => new URLSearchParams(String(calls[0].init.body)).get("To");

type Row = Record<string, unknown>;

interface AdminOptions {
  failIdRead?: boolean;
  failTeamRead?: boolean;
  throws?: boolean;
  /** User ids that have a crew_members row (crew accounts). */
  crewUserIds?: string[];
  failCrewRead?: boolean;
}

/** Just enough of supabase-js: profiles by id (maybeSingle) and by parent_contractor_id, crew_members by user_id. */
function profilesAdmin(profiles: Row[], opts: AdminOptions = {}) {
  const reads: string[] = [];
  const admin = {
    from: vi.fn((table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => {
          if (opts.throws) throw new TypeError("client exploded");
          reads.push(`${table}(${columns}).${column}=${value}`);
          const error = (column === "id" ? opts.failIdRead : opts.failTeamRead) ? { message: "read failed" } : null;
          const list = profiles.filter((p) => p[column] === value);
          const many = Promise.resolve({ data: error ? null : list, error });
          return Object.assign(many, {
            maybeSingle: () => Promise.resolve({ data: error ? null : (list[0] ?? null), error }),
          });
        },
        in: (column: string, values: string[]) => {
          if (opts.throws) throw new TypeError("client exploded");
          reads.push(`${table}(${columns}).${column} in ${values.join(",")}`);
          if (opts.failCrewRead) return Promise.resolve({ data: null, error: { message: "read failed" } });
          const found = (opts.crewUserIds ?? []).filter((id) => values.includes(id)).map((user_id) => ({ user_id }));
          return Promise.resolve({ data: found, error: null });
        },
      }),
    })),
  };
  return { admin, reads };
}

beforeEach(() => {
  setEnv(ENV);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the quiet guard", () => {
  it("sends nothing for a sandbox company, and logs each message's text without its destination", async () => {
    const { fetchMock } = stubFetch();
    expect(await sendSms(PHONE, "Draft quote #12 is ready in Jobber.", SANDBOX)).toBe(true);
    expect(await sendPush(["user-office-1"], "Quote ready", "Draft quote #12", { route: "/dashboard" }, SANDBOX)).toBe(true);
    expect(await sendEmail(EMAIL, "Crew awarded", "<h2>Oak removal</h2><p>Quote &amp; crew</p>", SANDBOX)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("[tc-quiet] bid-award M2 owner Draft quote #12 is ready in Jobber.");
    expect(console.log).toHaveBeenCalledWith("[tc-quiet] bid-award M2 owner Quote ready: Draft quote #12");
    expect(console.log).toHaveBeenCalledWith("[tc-quiet] bid-award M2 owner Crew awarded: Oak removal Quote & crew");
    const logged = consoleText().join("\n");
    for (const destination of ["555-0142", "5550142", EMAIL, "user-office-1"]) expect(logged).not.toContain(destination);
  });

  it("logs no text at all for a quiet company that is not a confirmed sandbox", async () => {
    const { fetchMock } = stubFetch();
    const text = "Draft quote #12 is ready in Jobber.";
    expect(await sendSms(PHONE, text, UNSURE)).toBe(true);
    expect(await sendPush(["user-office-1"], "Quote ready", "Draft quote #12", {}, UNSURE)).toBe(true);
    expect(await sendEmail(EMAIL, "Crew awarded", "<p>Quote &amp; crew</p>", UNSURE)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(`[tc-quiet] bid-award M2 owner (not a confirmed sandbox, ${text.length} characters withheld)`);
    const logged = consoleText().join("\n");
    for (const words of ["Draft quote", "Quote ready", "Crew awarded", "crew", "555-0142", EMAIL, "user-office-1"]) {
      expect(logged, words).not.toContain(words);
    }
  });

  it("keeps a real company's customer details out of the log when its sandbox flag can't be read", async () => {
    const company = await notifyCtx(profilesAdmin([], { failIdRead: true }).admin, "owner-1", "bid-award");
    expect(company).toEqual({ quiet: true, sandbox: false, fn: "bid-award" });
    // The award packet (M2) carries the customer's name, phone, email and street, and the owner's margin.
    const packet =
      "<h2>Customer &amp; property</h2><p>Customer Jane Example</p><p>Phone 405-555-0177</p>" +
      "<p>Email jane@example.com</p><p>Address 12 Example St, Edmond, OK 73034</p><p>You keep $640 (38%)</p>";
    const { fetchMock } = stubFetch();
    expect(await sendEmail(EMAIL, "Crew awarded: Tree removal (Edmond)", packet, { ...company, kind: "M2", role: "owner" })).toBe(true);
    expect(await sendSms(PHONE, "TreeCheck: crew awarded. Jane Example, 405-555-0177, 12 Example St.", { ...company, kind: "M2", role: "team" }))
      .toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = consoleText().join("\n");
    for (const detail of ["Jane", "555-0177", "5550177", "jane@example.com", "12 Example St", "Edmond", "73034", "$640", "38%"]) {
      expect(logged, detail).not.toContain(detail);
    }
  });

  it("fails closed: only quiet set to false sends, and a confirmed sandbox never sends", async () => {
    const { fetchMock } = stubFetch({ status: 201 });
    // As a caller might build quiet from a row whose select left out is_sandbox, or from a string.
    for (const quiet of [undefined, null, 0, "", "false", "no"]) {
      const ctx = { ...LOUD, quiet } as unknown as NotifyCtx;
      expect(await sendSms(PHONE, "Hi", ctx)).toBe(true);
      expect(await sendPush(["user-1"], "t", "b", {}, ctx)).toBe(true);
      expect(await sendEmail(EMAIL, "s", "<p>x</p>", ctx)).toBe(true);
    }
    for (const ctx of [{ ...LOUD, sandbox: true }, undefined, null] as unknown as NotifyCtx[]) {
      await expect(sendSms(PHONE, "Hi", ctx)).resolves.toBe(true);
      await expect(sendPush(["user-1"], "t", "b", {}, ctx)).resolves.toBe(true);
      await expect(sendEmail(EMAIL, "s", "<p>x</p>", ctx)).resolves.toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays quiet even when nothing is configured", async () => {
    setEnv({});
    const { fetchMock } = stubFetch();
    expect(await sendSms(PHONE, "Hi", SANDBOX)).toBe(true);
    expect(await sendSms(PHONE, "Hi", UNSURE)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a destination that could never be sent to fails the same way, quiet or not", async () => {
    const { fetchMock } = stubFetch();
    for (const ctx of [SANDBOX, UNSURE, LOUD]) {
      expect(await sendSms("555-01", "Hi", ctx)).toBe(false);
      expect(await sendPush([], "Hi", "there", {}, ctx)).toBe(false);
      expect(await sendEmail("not an address", "Hi", "<p>there</p>", ctx)).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe("sendSms", () => {
  it("texts through Twilio with the number in +1 form", async () => {
    const { calls } = stubFetch({ status: 201, body: { sid: "SM1" } });
    expect(await sendSms(PHONE, "Customer approved quote #12.", LOUD)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC-test-sid/Messages.json");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Basic " + btoa("AC-test-sid:test-auth"));
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get("To")).toBe("+14055550142");
    expect(form.get("From")).toBe("+14055550100");
    expect(form.get("Body")).toBe("Customer approved quote #12.");
  });

  it("reads an 11-digit US number with its leading 1", async () => {
    for (const written of ["1 405 555 0143", "+1 (405) 555-0143", "1-405-555-0143"]) {
      const { calls } = stubFetch({ status: 201 });
      await sendSms(written, "Hi", LOUD);
      expect(textedTo(calls), written).toBe("+14055550143");
    }
  });

  it("drops an extension instead of reading it as part of the number", async () => {
    for (const written of ["405-555-0123 ext 12", "(405) 555-0123 x12", "405.555.0123 #12", "+1 405 555 0123 extension 12", "405-555-0123 Ext. 7"]) {
      const { calls } = stubFetch({ status: 201 });
      expect(await sendSms(written, "Hi", LOUD), written).toBe(true);
      expect(textedTo(calls), written).toBe("+14055550123");
    }
  });

  it("keeps a number written with its own + as given", async () => {
    const { calls } = stubFetch({ status: 201 });
    await sendSms("+44 20 7946 0958", "Hi", LOUD);
    expect(textedTo(calls)).toBe("+442079460958");
  });

  it("skips anything that is neither a US number nor written with a +, and never logs it", async () => {
    const { fetchMock } = stubFetch({ status: 201 });
    for (const written of ["123-456-7890", "405-155-0123", "442079460958", "4055550123456", "+12 34", "", "n/a"]) {
      expect(await sendSms(written, "Hi", LOUD), written).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = consoleText().join("\n");
    expect(logged).toContain("no usable number");
    for (const digits of ["456-7890", "4567890", "155-0123", "7946", "0123456"]) expect(logged).not.toContain(digits);
  });

  it("never sends an em or en dash, and keeps line breaks", async () => {
    const { calls } = stubFetch({ status: 201 });
    await sendSms(PHONE, "Oak removal — 12 Elm St\nCrew of 3, 8–10 hrs", LOUD);
    expect(new URLSearchParams(String(calls[0].init.body)).get("Body")).toBe("Oak removal, 12 Elm St\nCrew of 3, 8-10 hrs");
  });

  it("a refusal returns false and logs Twilio's code, not the number", async () => {
    stubFetch({ status: 400, body: { code: 21211, message: "The 'To' number +14055550142 is not a valid phone number." } });
    expect(await sendSms(PHONE, "Hi", LOUD)).toBe(false);
    const logged = consoleText().join("\n");
    expect(logged).toContain("21211");
    expect(logged).not.toContain("5550142");
  });

  it("never throws: a network error returns false", async () => {
    stubFetch(new TypeError("fetch failed"));
    await expect(sendSms(PHONE, "Hi", LOUD)).resolves.toBe(false);
  });

  it("returns false without calling Twilio when it is not configured", async () => {
    setEnv({ ...ENV, TWILIO_AUTH_TOKEN: "" });
    const { fetchMock } = stubFetch();
    expect(await sendSms(PHONE, "Hi", LOUD)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendPush", () => {
  it("calls send-push with the service role, each user once", async () => {
    const { calls } = stubFetch({ status: 200, body: { sent: 2 } });
    const data = { route: "/dashboard/crew-bids?job=req-1", bid_request_id: "req-1" };
    expect(await sendPush(["user-1", "user-2", "user-1", ""], "Hired — Oak removal", "Tap to see the job", data, LOUD)).toBe(true);
    expect(calls[0].url).toBe("https://project.example.test/functions/v1/send-push");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer service-role-test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      contractor_ids: ["user-1", "user-2"],
      notification_type: "account_activity_non_payment",
      title: "Hired, Oak removal",
      body: "Tap to see the job",
      data,
    });
  });

  it("returns false on a refusal or a network error, never throws", async () => {
    stubFetch({ status: 500 });
    expect(await sendPush(["user-1"], "t", "b", {}, LOUD)).toBe(false);
    stubFetch(new TypeError("fetch failed"));
    await expect(sendPush(["user-1"], "t", "b", {}, LOUD)).resolves.toBe(false);
  });
});

describe("sendEmail", () => {
  it("sends through the Lovable Gmail connector", async () => {
    const { calls } = stubFetch({ status: 200, body: { id: "msg-1" } });
    expect(await sendEmail(EMAIL, "Crew awarded — Oak removal", "<p>Ready — send it</p>", LOUD)).toBe(true);
    expect(calls[0].url).toBe("https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer lovable-test");
    expect(headers["X-Connection-Api-Key"]).toBe("gmail-connection-test");
    const mime = mimeOf(calls[0].init);
    expect(mime).toContain(`To: ${EMAIL}\r\n`);
    expect(mime).toContain("Subject: Crew awarded, Oak removal\r\n");
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(mime.endsWith("\r\n\r\n<p>Ready, send it</p>")).toBe(true);
  });

  it("encodes a subject that is not plain ASCII", async () => {
    const { calls } = stubFetch();
    await sendEmail(EMAIL, "Café job", "<p>x</p>", LOUD);
    const subject = mimeOf(calls[0].init).split("\r\n").find((l) => l.startsWith("Subject: "));
    expect(subject).toBe(`Subject: =?UTF-8?B?${Buffer.from("Café job", "utf8").toString("base64")}?=`);
  });

  it("a line break in the subject or address can never add a header", async () => {
    const { calls, fetchMock } = stubFetch();
    await sendEmail(EMAIL, "Hello\r\nBcc: someone@example.com", "<p>x</p>", LOUD);
    const lines = mimeOf(calls[0].init).split("\r\n");
    expect(lines.some((l) => l.startsWith("Bcc:"))).toBe(false);
    expect(await sendEmail(`${EMAIL}\r\nBcc: someone@example.com`, "Hello", "<p>x</p>", LOUD)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns false when not configured, refused or unreachable, never throws", async () => {
    setEnv({ ...ENV, GOOGLE_MAIL_API_KEY: "" });
    const { fetchMock } = stubFetch();
    expect(await sendEmail(EMAIL, "s", "<p>x</p>", LOUD)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    setEnv(ENV);
    stubFetch({ status: 403 });
    expect(await sendEmail(EMAIL, "s", "<p>x</p>", LOUD)).toBe(false);
    stubFetch(new TypeError("fetch failed"));
    await expect(sendEmail(EMAIL, "s", "<p>x</p>", LOUD)).resolves.toBe(false);
  });
});

describe("companyMode, quietCompany and notifyCtx", () => {
  const owner = (is_sandbox: unknown) => [{ id: "owner-1", is_sandbox }];

  it("reads profiles.is_sandbox: sandbox when true, live when false", async () => {
    const sandbox = profilesAdmin(owner(true));
    expect(await companyMode(sandbox.admin, "owner-1")).toBe("sandbox");
    expect(sandbox.reads).toEqual(["profiles(is_sandbox).id=owner-1"]);
    expect(await companyMode(profilesAdmin(owner(false)).admin, "owner-1")).toBe("live");
  });

  it("is unknown when the flag can't be read: a read error, a missing profile, a client error, no flag or no owner id", async () => {
    expect(await companyMode(profilesAdmin(owner(false), { failIdRead: true }).admin, "owner-1")).toBe("unknown");
    expect(await companyMode(profilesAdmin([]).admin, "owner-1")).toBe("unknown");
    expect(await companyMode(profilesAdmin(owner(false), { throws: true }).admin, "owner-1")).toBe("unknown");
    expect(await companyMode(profilesAdmin(owner(null)).admin, "owner-1")).toBe("unknown");
    expect(await companyMode(profilesAdmin(owner("false")).admin, "owner-1")).toBe("unknown");
    const none = profilesAdmin(owner(false));
    expect(await companyMode(none.admin, "")).toBe("unknown");
    expect(none.admin.from).not.toHaveBeenCalled();
  });

  it("quietCompany is true for a sandbox company and false for a real one", async () => {
    expect(await quietCompany(profilesAdmin(owner(true)).admin, "owner-1")).toBe(true);
    expect(await quietCompany(profilesAdmin(owner(false)).admin, "owner-1")).toBe(false);
  });

  it("quietCompany fails safe toward not texting whenever the flag can't be read", async () => {
    expect(await quietCompany(profilesAdmin(owner(false), { failIdRead: true }).admin, "owner-1")).toBe(true);
    expect(await quietCompany(profilesAdmin([]).admin, "owner-1")).toBe(true);
    expect(await quietCompany(profilesAdmin(owner(false), { throws: true }).admin, "owner-1")).toBe(true);
    expect(await quietCompany(profilesAdmin(owner(null)).admin, "owner-1")).toBe(true);
    expect(await quietCompany(profilesAdmin(owner(false)).admin, "")).toBe(true);
  });

  it("notifyCtx sends only for a live company, and marks only a confirmed sandbox", async () => {
    expect(await notifyCtx(profilesAdmin(owner(false)).admin, "owner-1", "bid-hire"))
      .toEqual({ quiet: false, sandbox: false, fn: "bid-hire" });
    expect(await notifyCtx(profilesAdmin(owner(true)).admin, "owner-1", "bid-hire"))
      .toEqual({ quiet: true, sandbox: true, fn: "bid-hire" });
    expect(await notifyCtx(profilesAdmin([]).admin, "owner-1", "bid-hire"))
      .toEqual({ quiet: true, sandbox: false, fn: "bid-hire" });
  });

  it("a ctx from notifyCtx texts a live company and only logs a sandbox one", async () => {
    const { calls } = stubFetch({ status: 201 });
    const live = await notifyCtx(profilesAdmin(owner(false)).admin, "owner-1", "bid-hire");
    expect(await sendSms(PHONE, "Hired.", { ...live, kind: "M6", role: "owner" })).toBe(true);
    const sandbox = await notifyCtx(profilesAdmin(owner(true)).admin, "owner-1", "bid-hire");
    expect(await sendSms(PHONE, "Hired.", { ...sandbox, kind: "M6", role: "owner" })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(console.log).toHaveBeenCalledWith("[tc-quiet] bid-hire M6 owner Hired.");
  });
});

describe("officeContacts", () => {
  const people: Row[] = [
    { id: "owner-1", full_name: "TC-TEST Owner", phone: "405-555-0150", email: "owner@example.com", is_active: true, parent_contractor_id: null },
    { id: "team-1", full_name: "TC-TEST Office", phone: "405-555-0151", email: "office@example.com", is_active: true, parent_contractor_id: "owner-1" },
    { id: "team-2", full_name: "TC-TEST Former", phone: "405-555-0152", email: "former@example.com", is_active: false, parent_contractor_id: "owner-1" },
    { id: "team-3", full_name: null, phone: null, email: null, is_active: null, parent_contractor_id: "owner-1" },
    { id: "team-4", full_name: "TC-TEST Climber", phone: "405-555-0154", email: "climber@example.com", is_active: true, parent_contractor_id: "owner-1" },
    { id: "other-1", full_name: "Other company", phone: "405-555-0160", email: "other@example.com", is_active: true, parent_contractor_id: "owner-9" },
  ];
  // team-4 is a subcontractor's account that joined the team (accept-team-invite links existing accounts).
  const CREW = ["team-4", "other-1"];

  it("is the owner first, then every active team member who is not a crew account", async () => {
    const { admin, reads } = profilesAdmin(people, { crewUserIds: CREW });
    expect(await officeContacts(admin, "owner-1")).toEqual([
      { userId: "owner-1", name: "TC-TEST Owner", phone: "405-555-0150", email: "owner@example.com", role: "owner" },
      { userId: "team-1", name: "TC-TEST Office", phone: "405-555-0151", email: "office@example.com", role: "team" },
      { userId: "team-3", name: null, phone: null, email: null, role: "team" },
    ]);
    expect(reads.map((r) => r.replace(/\(.*\)/, ""))).toEqual([
      "profiles.id=owner-1",
      "profiles.parent_contractor_id=owner-1",
      "crew_members.user_id in team-1,team-3,team-4",
    ]);
  });

  it("keeps every active team member when none is a crew account", async () => {
    const contacts = await officeContacts(profilesAdmin(people).admin, "owner-1");
    expect(contacts.map((c) => c.userId)).toEqual(["owner-1", "team-1", "team-3", "team-4"]);
  });

  it("reaches only the owner when the crew accounts can't be read, never a subcontractor", async () => {
    const contacts = await officeContacts(profilesAdmin(people, { crewUserIds: CREW, failCrewRead: true }).admin, "owner-1");
    expect(contacts.map((c) => c.userId)).toEqual(["owner-1"]);
  });

  it("leaves out whoever couldn't be read, and never throws", async () => {
    const teamOnly = await officeContacts(profilesAdmin(people, { failIdRead: true, crewUserIds: CREW }).admin, "owner-1");
    expect(teamOnly.map((c) => c.userId)).toEqual(["team-1", "team-3"]);
    const ownerOnly = await officeContacts(profilesAdmin(people, { failTeamRead: true, crewUserIds: CREW }).admin, "owner-1");
    expect(ownerOnly.map((c) => c.userId)).toEqual(["owner-1"]);
    await expect(officeContacts(profilesAdmin(people, { throws: true }).admin, "owner-1")).resolves.toEqual([]);
    const none = profilesAdmin(people);
    await expect(officeContacts(none.admin, "")).resolves.toEqual([]);
    expect(none.admin.from).not.toHaveBeenCalled();
  });

  it("skips the crew read when the owner has no active team", async () => {
    const { admin, reads } = profilesAdmin(people.filter((p) => p.id === "owner-1" || p.id === "team-2"));
    expect((await officeContacts(admin, "owner-1")).map((c) => c.userId)).toEqual(["owner-1"]);
    expect(reads.some((r) => r.startsWith("crew_members"))).toBe(false);
  });
});

describe("alertOnce", () => {
  function rpcAdmin(result: { data?: unknown; error?: unknown } | Error) {
    return {
      rpc: vi.fn(async () => {
        if (result instanceof Error) throw result;
        return { data: result.data ?? null, error: result.error ?? null };
      }),
    };
  }

  it("runs the send when the claim is won, with the job and key", async () => {
    const admin = rpcAdmin({ data: true });
    const send = vi.fn(async () => {});
    expect(await alertOnce(admin, "req-1", "M9:2026-10-12", send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("tc_alert_once", { p_bid_request_id: "req-1", p_key: "M9:2026-10-12" });
  });

  it.each([
    ["the claim is already taken", { data: false }],
    ["the job has no bid_request_quotes row (the claim returns null)", { data: null }],
    ["the claim fails", { error: { message: "function public.tc_alert_once does not exist" } }],
    ["the client throws", new TypeError("fetch failed")],
  ])("does not send when %s", async (_name, result) => {
    const send = vi.fn();
    expect(await alertOnce(rpcAdmin(result as { data?: unknown; error?: unknown } | Error), "req-1", "M12", send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("logs a failed claim, and a job with no row, but not a claim already taken", async () => {
    await alertOnce(rpcAdmin({ error: { message: "permission denied" } }), "req-1", "M12", vi.fn());
    expect(consoleText().join("\n")).toContain("M12");
    await alertOnce(rpcAdmin({ data: null }), "req-1", "M3", vi.fn());
    expect(consoleText().join("\n")).toContain("alert M3 not sent: the job has no bid_request_quotes row");
    await alertOnce(rpcAdmin({ data: false }), "req-1", "M14", vi.fn());
    expect(consoleText().join("\n")).not.toContain("M14");
  });

  it("a send that throws is logged, never thrown", async () => {
    const send = vi.fn(async () => {
      throw new Error("send exploded");
    });
    await expect(alertOnce(rpcAdmin({ data: true }), "req-1", "M3", send)).resolves.toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("a repeated event alerts once", async () => {
    const claimed = new Set<string>();
    const admin = {
      rpc: vi.fn(async (_fn: string, args: { p_bid_request_id: string; p_key: string }) => {
        const k = `${args.p_bid_request_id}|${args.p_key}`;
        const first = !claimed.has(k);
        claimed.add(k);
        return { data: first, error: null };
      }),
    };
    const send = vi.fn();
    await alertOnce(admin, "req-1", "M14", send);
    await alertOnce(admin, "req-1", "M14", send);
    await alertOnce(admin, "req-2", "M14", send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
