// Texts, pushes and emails for the Jobber milestone, behind one guard for sandbox companies, plus
// alertOnce so a repeated event never tells the office twice. Server-side only. Maintained outside
// Lovable. Kept apart from crewRecipients.ts (which Lovable edits) so jobber-webhook never depends on a
// Lovable-edited file.
//
// The quiet guard fails closed. A send goes out only when its NotifyCtx says quiet: false outright (a
// missing or malformed ctx is quiet) and the company is not a confirmed sandbox. Build the company part
// of the ctx with notifyCtx, which reads profiles.is_sandbox once (companyMode): "live" sends, while
// "sandbox" and "unknown" (the flag could not be read) stay quiet. A quiet send sends nothing and
// returns true, so a sandbox run takes the same path as a real one. It logs
// "[tc-quiet] <fn> <kind> <role> <text>" only for a confirmed sandbox, whose data is synthetic, so Haris
// can read every new text on test company B. For any other company it logs only the text's length: a
// real company's messages carry customer names, phone numbers, addresses and prices. No log ever holds
// the phone number, email address or user ids a message was for. Every send strips em and en dashes
// (people read these) and never throws.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Where a message comes from and who it is for. Build the company part with notifyCtx. */
export interface NotifyCtx {
  /** Sends only when this is false outright; true, or anything else, only logs (see the header). */
  quiet: boolean;
  /** True only for a confirmed sandbox company (companyMode "sandbox"): its quiet log may hold the text. */
  sandbox?: boolean;
  /** The sending function, for example "bid-award". */
  fn: string;
  /** The message id from docs/jobber-sync/messages.md, for example "M3". */
  kind: string;
  /** Who receives it, for example "owner", "team", "climber" or "ground". */
  role: string;
}

/** The company part of a NotifyCtx, read once per run by notifyCtx: spread it and add each message's kind and role. */
export type CompanyNotifyCtx = Pick<NotifyCtx, "quiet" | "sandbox" | "fn">;

/** How a company's messages go: sent ("live"), logged in full ("sandbox"), or logged without the text ("unknown"). */
export type CompanyMode = "live" | "sandbox" | "unknown";

/** One office person: the company owner or an active team member who is not a crew account. */
export interface OfficeContact {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: "owner" | "team";
}

const GMAIL_SEND_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send";
const CONTACT_COLUMNS = "id, full_name, phone, email, is_active";

/** "sandbox" when profiles.is_sandbox is true, "live" when it is false, "unknown" when it can't be read. Never throws. */
export async function companyMode(admin: Admin, ownerId: string): Promise<CompanyMode> {
  if (!ownerId) return "unknown";
  try {
    const { data, error } = await admin.from("profiles").select("is_sandbox").eq("id", ownerId).maybeSingle();
    if (error || !data) {
      console.warn("[tc-notify] sandbox check failed, staying quiet:", short(error?.message ?? "no profile row"));
      return "unknown";
    }
    if (data.is_sandbox === true) return "sandbox";
    if (data.is_sandbox === false) return "live";
    console.warn("[tc-notify] sandbox check gave no answer, staying quiet");
    return "unknown";
  } catch (e) {
    console.warn("[tc-notify] sandbox check failed, staying quiet:", short(errText(e)));
    return "unknown";
  }
}

/** True for a sandbox company, and whenever profiles.is_sandbox can't be read, so a doubt never sends. */
export async function quietCompany(admin: Admin, ownerId: string): Promise<boolean> {
  return (await companyMode(admin, ownerId)) !== "live";
}

/** The company part of every NotifyCtx in one run: quiet unless the company is confirmed live, sandbox only when confirmed. */
export async function notifyCtx(admin: Admin, ownerId: string, fn: string): Promise<CompanyNotifyCtx> {
  const mode = await companyMode(admin, ownerId);
  return { quiet: mode !== "live", sandbox: mode === "sandbox", fn };
}

/**
 * The owner plus every active team member who is not a crew account, owner first: the office list
 * job-message-send uses. A read problem leaves out whoever couldn't be read. When the crew accounts
 * can't be read, only the owner is returned, so a doubt reaches fewer people and never a subcontractor.
 */
export async function officeContacts(admin: Admin, ownerId: string): Promise<OfficeContact[]> {
  if (!ownerId) return [];
  try {
    const [owner, team] = await Promise.all([
      rows(admin.from("profiles").select(CONTACT_COLUMNS).eq("id", ownerId).maybeSingle()),
      rows(admin.from("profiles").select(CONTACT_COLUMNS).eq("parent_contractor_id", ownerId)),
    ]);
    const out = owner.map((p) => contact(p, "owner")).filter((c) => c.userId);
    const members = team.filter((p) => p.id && p.is_active !== false && String(p.id) !== ownerId);
    if (!members.length) return out;
    const crew = await crewAccounts(admin, members.map((p) => String(p.id)));
    if (!crew) return out;
    for (const p of members) {
      const id = String(p.id);
      if (crew.has(id) || out.some((c) => c.userId === id)) continue;
      out.push(contact(p, "team"));
    }
    return out;
  } catch (e) {
    console.warn("[tc-notify] office contacts read failed:", short(errText(e)));
    return [];
  }
}

/** Texts one number through Twilio (quiet only logs); true when Twilio took it. Never throws. */
export async function sendSms(to: string, body: string, ctx: NotifyCtx): Promise<boolean> {
  const number = smsNumber(to);
  if (!number) {
    console.warn(`[tc-notify] ${label(ctx)} sms skipped: no usable number`);
    return false;
  }
  const text = noDashes(body);
  if (isQuiet(ctx)) return quietLog(ctx, text);
  const sid = env("TWILIO_ACCOUNT_SID");
  const auth = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_PHONE_NUMBER");
  if (!sid || !auth || !from) {
    console.warn(`[tc-notify] ${label(ctx)} sms not configured`);
    return false;
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(`${sid}:${auth}`),
      },
      body: new URLSearchParams({ To: number, From: from, Body: text }),
    });
    if (!res.ok) {
      // Twilio's error text can repeat the number, so only its error code is logged.
      const code = await res.json().then((j) => j?.code ?? "", () => "");
      console.error(`[tc-notify] ${label(ctx)} sms failed`, res.status, code);
    }
    return res.ok;
  } catch (e) {
    console.error(`[tc-notify] ${label(ctx)} sms failed:`, short(errText(e)));
    return false;
  }
}

/** Pushes to app users through the send-push function (quiet only logs); true when send-push took it. Never throws. */
export async function sendPush(
  userIds: string[],
  title: string,
  body: string,
  data: Record<string, unknown>,
  ctx: NotifyCtx,
): Promise<boolean> {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (!ids.length) return false;
  const heading = noDashes(title);
  const text = noDashes(body);
  if (isQuiet(ctx)) return quietLog(ctx, `${heading}: ${text}`);
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.warn(`[tc-notify] ${label(ctx)} push not configured`);
    return false;
  }
  try {
    const res = await fetch(`${url}/functions/v1/send-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        contractor_ids: ids,
        notification_type: "account_activity_non_payment",
        title: heading,
        body: text,
        data: data ?? {},
      }),
    });
    if (!res.ok) console.error(`[tc-notify] ${label(ctx)} push failed`, res.status);
    return res.ok;
  } catch (e) {
    console.error(`[tc-notify] ${label(ctx)} push failed:`, short(errText(e)));
    return false;
  }
}

/** Emails one address through the Lovable Gmail connector (quiet only logs); true when Gmail took it. Never throws. */
export async function sendEmail(to: string, subject: string, html: string, ctx: NotifyCtx): Promise<boolean> {
  const address = oneLine(to);
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) {
    console.warn(`[tc-notify] ${label(ctx)} email skipped: no usable address`);
    return false;
  }
  const heading = oneLine(noDashes(subject));
  const page = noDashes(html ?? "");
  if (isQuiet(ctx)) return quietLog(ctx, `${heading}: ${htmlText(page)}`);
  const apiKey = env("LOVABLE_API_KEY");
  const connKey = env("GOOGLE_MAIL_API_KEY");
  if (!apiKey || !connKey) {
    console.warn(`[tc-notify] ${label(ctx)} email not configured`);
    return false;
  }
  const mime = [
    `To: ${address}`,
    `Subject: ${mimeHeader(heading)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    page,
  ].join("\r\n");
  try {
    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(mime) }),
    });
    if (!res.ok) console.error(`[tc-notify] ${label(ctx)} email failed`, res.status);
    return res.ok;
  } catch (e) {
    console.error(`[tc-notify] ${label(ctx)} email failed:`, short(errText(e)));
    return false;
  }
}

/**
 * Runs `fn` only when this call is the first to claim `key` for the job (RPC tc_alert_once); never throws.
 * The job's bid_request_quotes row must exist before the call: with no row nothing is claimed or sent, and
 * that is logged. The key is claimed before `fn` runs, so a send that fails is not tried again.
 */
export async function alertOnce(
  admin: Admin,
  requestId: string,
  key: string,
  fn: () => unknown,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("tc_alert_once", { p_bid_request_id: requestId, p_key: key });
    if (error) {
      console.warn(`[tc-notify] alert ${key} not sent, claim failed:`, short(error.message ?? error));
      return false;
    }
    if (data == null) {
      console.warn(`[tc-notify] alert ${key} not sent: the job has no bid_request_quotes row`);
      return false;
    }
    if (data !== true) return false;
  } catch (e) {
    console.warn(`[tc-notify] alert ${key} not sent, claim failed:`, short(errText(e)));
    return false;
  }
  try {
    await fn();
  } catch (e) {
    console.error(`[tc-notify] alert ${key} send failed:`, short(errText(e)));
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------

// Untyped profiles rows, as everywhere else in the functions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Awaits one Supabase query and returns its rows (one row or many); a failure logs and gives none. */
async function rows(query: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<Row[]> {
  try {
    const { data, error } = await query;
    if (error) throw new Error(error.message ?? "read failed");
    if (!data) return [];
    return (Array.isArray(data) ? data : [data]) as Row[];
  } catch (e) {
    console.warn("[tc-notify] office contacts read failed:", short(errText(e)));
    return [];
  }
}

/** The user ids among `ids` that have a crew_members row (crew accounts), or null when that can't be read. */
async function crewAccounts(admin: Admin, ids: string[]): Promise<Set<string> | null> {
  try {
    const { data, error } = await admin.from("crew_members").select("user_id").in("user_id", ids);
    if (error || !Array.isArray(data)) throw new Error(error?.message ?? "no rows came back");
    return new Set((data as Row[]).map((r) => String(r?.user_id ?? "")).filter(Boolean));
  } catch (e) {
    console.warn("[tc-notify] crew accounts read failed, so only the owner is on the office list:", short(errText(e)));
    return null;
  }
}

function contact(p: Row, role: "owner" | "team"): OfficeContact {
  return {
    userId: p.id ? String(p.id) : "",
    name: p.full_name ? String(p.full_name) : null,
    phone: p.phone ? String(p.phone) : null,
    email: p.email ? String(p.email) : null,
    role,
  };
}

/**
 * The number to text, in E.164: a US number as +1 and its 10 digits (any extension dropped, a leading 1
 * allowed), or a number written with its own leading "+" as given. Null for anything else.
 */
function smsNumber(raw: unknown): string | null {
  const written = String(raw ?? "").trim().replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, "");
  const digits = written.replace(/\D/g, "");
  if (written.startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  // A US area code and exchange each start with 2 to 9.
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

/** Quiet unless the ctx says quiet: false outright, and always quiet for a confirmed sandbox. */
function isQuiet(ctx: NotifyCtx | null | undefined): boolean {
  return ctx?.quiet !== false || ctx?.sandbox === true;
}

/** Logs a quiet send without its destination, and with its text only for a confirmed sandbox. */
function quietLog(ctx: NotifyCtx, text: string): true {
  if (ctx?.sandbox === true) console.log(`[tc-quiet] ${label(ctx)} ${text}`);
  else console.log(`[tc-quiet] ${label(ctx)} (not a confirmed sandbox, ${text.length} characters withheld)`);
  return true;
}

function label(ctx: NotifyCtx | null | undefined): string {
  return `${ctx?.fn ?? "?"} ${ctx?.kind ?? "?"} ${ctx?.role ?? "?"}`;
}

/** No em or en dashes for people: a spaced dash becomes a comma, any other a hyphen. Line breaks stay. */
function noDashes(text: string): string {
  return String(text ?? "")
    .replace(/[ \t]+[–—][ \t]+/g, ", ")
    .replace(/[–—]/g, "-");
}

function oneLine(text: string): string {
  return String(text ?? "").replace(/[\r\n]+/g, " ").trim();
}

/** The readable text of an email, for the quiet log. */
function htmlText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** A Subject header value: plain ASCII as it is, anything else as RFC 2047 UTF-8 base64. */
function mimeHeader(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(text)}?=`;
}

function base64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64Url(text: string): string {
  return base64(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function short(v: unknown): string {
  return String(v).slice(0, 200);
}

// Environment lookup that never names the Deno global directly, so vitest can import this file.
function env(key: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get(key);
}
