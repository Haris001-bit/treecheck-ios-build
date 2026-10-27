// What a company sees when it presses Connect Jobber while no Jobber place is theirs, and the text and email Mark gets
// about it (JC1, 2026-10-26). Until Jobber approves the TreeCheck AI app, Jobber lets it connect at most 5 paying Jobber
// accounts, and a sixth would cut off Jobber for every company. jobber-connect answers with JOBBER_WAITLIST_CODE (HTTP
// 200, so the page can read it) and the Jobber page shows the message in a popup; older apps show it as an error note.
// Pure, so vitest and the Jobber page use it too (named apart from the jobber* sync modules, which never reach the web
// app). Maintained outside Lovable.

export const JOBBER_WAITLIST_CODE = "jobber_waitlist";
export const JOBBER_WAITLIST_TITLE = "Jobber connection coming soon";
/** Mark's message (2026-10-26), with "stand by" as two words. */
export const JOBBER_WAITLIST_MESSAGE =
  "Please stand by as our Jobber integration is in the final phase of testing. We will contact you in the coming weeks when it's ready to connect.";

/** One field of the text: one line, at most `max` characters, or null when empty. */
function field(v: unknown, max: number): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return s ? s : null;
}

/** The company on the waitlist and how to reach them, plus the places in use when known. */
interface WaitlistAlertInput {
  company?: string | null;
  owner?: string | null;
  phone?: string | null;
  email?: string | null;
  used?: number | null;
  max?: number | null;
}

const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function alertParts(input: WaitlistAlertInput) {
  const company = field(input.company, 60);
  const owner = field(input.owner, 60);
  const who = company ?? owner ?? "A company";
  const used = count(input.used);
  const max = count(input.max);
  const places = used !== null && max !== null ? ` Jobber places in use: ${used} of ${max}.` : "";
  const reach = [owner && company ? owner : null, field(input.phone, 30), field(input.email, 80)].filter(Boolean).join(", ");
  const lines = [
    `TreeCheck: ${who} tried to connect Jobber and got your stand by message, so they're on the Jobber waitlist.${places}`,
    reach ? `Contact: ${reach}` : "No phone or email on the account.",
  ].map(noDashes);
  return { who: noDashes(who), lines };
}

const noDashes = (s: string) => s.replace(/[–—]/g, ",");
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The text Mark gets: who is waiting, the places in use, and how to reach them. */
export function waitlistAlertText(input: WaitlistAlertInput): string {
  return alertParts(input).lines.join("\n");
}

/** The same alert as an email to Mark: a subject naming the company, and the text as escaped HTML. */
export function waitlistAlertEmail(input: WaitlistAlertInput): { subject: string; html: string } {
  const { who, lines } = alertParts(input);
  return {
    subject: `TreeCheck: ${who} is on the Jobber waitlist`,
    html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n"),
  };
}
