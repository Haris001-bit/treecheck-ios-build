// A company's answer to "What CRM are you currently using?" (company setup, company_settings.crm and crm_other):
// which CRM it names, the key that lets crm-interest-alert alert Mark only once per company and CRM, and the text and email.
// Jobber connects by itself and "none" needs nothing, so only another CRM counts (Mark, 2026-10-22: "program the
// app to alert us so that we can call them and get them set up"). Pure, so vitest and the setup screen use it too.
// Maintained outside Lovable.

/**
 * The CRMs company setup offers, in the order it shows them: Jobber first (the only one that syncs), then tree-care
 * tools, field-service apps and general CRMs. Setup adds "Other" (the owner types the name, kept in crm_other) and
 * "None" after these. A value saved here is kept even if it later leaves the list: otherCrmName names only listed ones.
 */
export const CRM_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "jobber", label: "Jobber" },
  { value: "arbostar", label: "ArboStar" },
  { value: "arborgold", label: "Arborgold" },
  { value: "singleops", label: "SingleOps" },
  { value: "quoteiq", label: "QuoteIQ" },
  { value: "servicetitan", label: "ServiceTitan" },
  { value: "housecall_pro", label: "Housecall Pro" },
  { value: "service_autopilot", label: "Service Autopilot" },
  { value: "aspire", label: "Aspire" },
  { value: "workiz", label: "Workiz" },
  { value: "gohighlevel", label: "GoHighLevel" },
  { value: "hubspot", label: "HubSpot" },
  { value: "salesforce", label: "Salesforce" },
  { value: "zoho", label: "Zoho" },
];

/** Each listed CRM's name, by the value setup saves. */
export const CRM_LABELS: Record<string, string> = Object.fromEntries(CRM_OPTIONS.map((o) => [o.value, o.label]));

const MAX_TYPED = 60;

/** The owner's typed CRM name, tidied: one line, no extra spaces, at most 60 characters; null when empty. */
function typedName(other: string | null | undefined): string | null {
  const name = String(other ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TYPED).trim();
  return name ? name : null;
}

/**
 * The CRM a company uses other than Jobber, in words, or null when it uses Jobber, none, or gave nothing usable
 * (an "other" with no name). A typed name that just says Jobber counts as Jobber.
 */
export function otherCrmName(crm: string | null | undefined, other: string | null | undefined): string | null {
  const value = String(crm ?? "").trim().toLowerCase();
  if (!value || value === "jobber" || value === "none") return null;
  if (value === "other") {
    const name = typedName(other);
    return name && name.toLowerCase() !== "jobber" ? name : null;
  }
  return CRM_LABELS[value] ?? null;
}

/** One key per company and CRM: the saved value, or "other:" and the typed name in lower case. Null when no alert is due. */
export function crmAlertKey(crm: string | null | undefined, other: string | null | undefined): string | null {
  const name = otherCrmName(crm, other);
  if (!name) return null;
  const value = String(crm ?? "").trim().toLowerCase();
  return value === "other" ? `other:${name.toLowerCase()}` : value;
}

/** One field of the text: one line, at most `max` characters, or null when empty. */
function field(v: unknown, max: number): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return s ? s : null;
}

/** Who signed up and how to reach them, worked out once for the text and the email. */
interface AlertInput {
  crm: string;
  company?: string | null;
  owner?: string | null;
  phone?: string | null;
  email?: string | null;
}

function alertParts(input: AlertInput) {
  const company = field(input.company, 60);
  const owner = field(input.owner, 60);
  const who = company ?? owner ?? "A new company";
  const crm = field(input.crm, MAX_TYPED) ?? "another CRM";
  const reach = [owner && company ? owner : null, field(input.phone, 30), field(input.email, 80)].filter(Boolean).join(", ");
  const lines = [
    `TreeCheck: ${who} uses ${crm} for their CRM, not Jobber, so it won't sync yet. They may need a call to get set up.`,
    reach ? `Contact: ${reach}` : "No phone or email on the account.",
  ].map(noDashes);
  return { who: noDashes(who), crm: noDashes(crm), lines };
}

const noDashes = (s: string) => s.replace(/[–—]/g, ",");
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The text Mark gets: who signed up, which CRM, and how to reach them. No dashes, so it reads like a person wrote it. */
export function crmAlertText(input: AlertInput): string {
  return alertParts(input).lines.join("\n");
}

/** The same alert as an email to Mark: a subject naming the company and CRM, and the text as escaped HTML. */
export function crmAlertEmail(input: AlertInput): { subject: string; html: string } {
  const { who, crm, lines } = alertParts(input);
  return {
    subject: `TreeCheck: ${who} uses ${crm}, not Jobber`,
    html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n"),
  };
}
