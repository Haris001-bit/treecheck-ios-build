// Signup permission records. Mirrors src/lib/consent.ts: the browser sends only the version and the two answers, and the
// server stores its own copy of the wording, so a changed request can never record text the person didn't see.
// deno-lint-ignore-file no-explicit-any
export const CONSENT_VERSION = "2026-10-26";

export const ACCOUNT_CONSENT_TEXT =
  "I agree to receive account messages from TreeCheck about my trial, billing, jobs and crew by email, text message and phone call. Message and data rates may apply. Reply STOP to stop texts.";

export const MARKETING_CONSENT_TEXT =
  "Yes, send me TreeCheck news, tips and offers by email, text message and phone call, including automated texts and calls, at the email and phone number I entered. This is optional and not required to sign up. Message frequency varies; message and data rates may apply. Reply STOP to stop texts or unsubscribe anytime.";

const CHANNELS = ["email", "sms", "phone"];

export type SignupConsent = { account: boolean; marketing: boolean };

/** Reads the consent answers from a signup body; null when they're missing (older app builds). */
export function parseConsent(raw: unknown): SignupConsent | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.account !== "boolean" || typeof c.marketing !== "boolean") return null;
  return { account: c.account, marketing: c.marketing };
}

/** Appends both answers to communication_consents. Never throws: a failed record is logged, not a failed signup. */
export async function recordConsent(
  admin: any,
  req: Request,
  userId: string,
  consent: SignupConsent,
  contact: { email?: string | null; phone?: string | null },
  source: string,
) {
  const base = {
    user_id: userId,
    channels: CHANNELS,
    consent_version: CONSENT_VERSION,
    email: contact.email ? String(contact.email).trim().toLowerCase().slice(0, 320) : null,
    phone: contact.phone ? String(contact.phone).trim().slice(0, 40) : null,
    source,
    ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
  };
  const { error } = await admin.from("communication_consents").insert([
    { ...base, kind: "account", granted: consent.account, consent_text: ACCOUNT_CONSENT_TEXT },
    { ...base, kind: "marketing", granted: consent.marketing, consent_text: MARKETING_CONSENT_TEXT },
  ]);
  if (error) console.error("[CONSENT] could not record", { userId, source, error: error.message });
}
