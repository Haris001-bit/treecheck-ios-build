// The RipSaw RS2511 giveaway (ends Nov 30, 2026). Mirrors src/lib/giveaway.ts: change both together.
// Starting the 14-day trial is the entry. Entries are written only here (from create-trial-signup) and drawn only by
// giveaway-draw, which also marks card-checkout signups as entered once their trial has started.
// deno-lint-ignore-file no-explicit-any
export const GIVEAWAY_ID = "ripsaw-rs2511-2026";
export const GIVEAWAY_RULES_VERSION = "2026-10-26b";
/** Entries count from Oct 26, 2026 at 12:00 AM Central (CDT). The official start date is still to be confirmed. */
export const GIVEAWAY_STARTS_AT = "2026-10-26T05:00:00.000Z";
/** Ends Nov 30, 2026 at 11:59:59 PM Central (CST, UTC-6). */
export const GIVEAWAY_ENDS_AT = "2026-12-01T05:59:59.999Z";

export function giveawayOpen(now: Date = new Date()): boolean {
  const t = now.getTime();
  return t >= Date.parse(GIVEAWAY_STARTS_AT) && t <= Date.parse(GIVEAWAY_ENDS_AT);
}

const US: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const CA: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
const ALIASES: Record<string, string> = { okla: "OK", "washington dc": "DC", "d.c": "DC", pei: "PE", "québec": "QC", newfoundland: "NL" };
const norm = (s: string) => s.trim().toLowerCase().replace(/\.$/, "");

/**
 * The signup's state or province as a two-letter code with its country, for the admin list; null when unrecognised.
 * Geographic eligibility is still to be confirmed, so this never decides who can enter or be drawn.
 */
export function placeFor(region: unknown, country?: unknown): { country: "US" | "CA"; region: string } | null {
  if (typeof region !== "string" || !region.trim()) return null;
  const r = norm(region);
  const want = country === "CA" ? "CA" : country === "US" ? "US" : null;
  const alias = ALIASES[r];
  const find = (table: Record<string, string>) => {
    if (alias && table[alias]) return alias;
    const code = r.toUpperCase();
    if (r.length === 2 && table[code]) return code;
    return Object.keys(table).find((k) => table[k].toLowerCase() === r) ?? null;
  };
  if (want !== "CA") {
    const us = find(US);
    if (us) return { country: "US", region: us };
  }
  if (want !== "US") {
    const ca = find(CA);
    if (ca) return { country: "CA", region: ca };
  }
  return null;
}

/** "entered" when the trial has started; "awaiting_trial" when the signup went to card checkout first. */
export type EntryStatus = "entered" | "awaiting_trial";

export type GiveawayEntry = {
  userId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  companyName?: string | null;
  region?: string | null;
  source: "trial-signup";
  status: EntryStatus;
};

/** Saves one entry per email. "duplicate" when this email already has one. Never throws, so signup never fails on it. */
export async function recordGiveawayEntry(admin: any, req: Request, e: GiveawayEntry): Promise<"entered" | "duplicate" | "error"> {
  try {
    const clip = (v: unknown, n: number) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
    const place = placeFor(e.region);
    const { error } = await admin.from("giveaway_entries").insert({
      giveaway: GIVEAWAY_ID,
      user_id: e.userId,
      full_name: clip(e.fullName, 120) ?? "",
      email: String(e.email).trim().toLowerCase().slice(0, 320),
      phone: clip(e.phone, 40),
      company_name: clip(e.companyName, 160),
      region: place?.region ?? clip(e.region, 60),
      country: place?.country ?? null,
      source: e.source,
      status: e.status,
      rules_version: GIVEAWAY_RULES_VERSION,
      ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
    });
    if (!error) return "entered";
    if (error.code === "23505") return "duplicate";
    console.error("[GIVEAWAY] could not record entry", { error: error.message });
    return "error";
  } catch (err) {
    console.error("[GIVEAWAY] could not record entry", err instanceof Error ? err.message : err);
    return "error";
  }
}

/** A card-checkout signup counts once Stripe has started its trial (or it went on to pay). */
export const TRIAL_STARTED_BILLING_STATUSES = ["trialing", "active", "past_due"];
