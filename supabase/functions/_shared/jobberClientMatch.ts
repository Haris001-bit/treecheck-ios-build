// TreeCheck Jobber sync: finding the customer's existing Jobber client before a quote makes a new one
// (plan sections 1, 4 and 7).
//
// Pure functions only: no Deno globals, no network and no clock, so the edge functions and the vitest
// suite (src/lib/jobberSync/clientMatch.test.ts) run the same file. Maintained outside Lovable.
//
// pickClient:
// * archived clients are skipped;
// * tiers, best first: email and phone ("email_phone"), email ("email"), phone plus the same last name
//   ("phone_name"), the same last name at the same place ("name_address", by samePlace);
// * a name alone never matches;
// * when more than one client matches at the best tier, the first in the order given is returned with
//   ambiguous = true, so the office text can flag it. A client listed twice (one id) counts once.
// Candidates use the internal ClientCandidate shape; a later PR maps Jobber's client search into it.
//
// Comparison: phones as 10 US digits; emails as the bare address, trimmed and lowercased ("<jo@x.com>",
// "Jo Smith <jo@x.com>", "mailto:jo@x.com" and "jo@x.com." all read as "jo@x.com", the way Jobber
// stores it); last names by their last word with accents, punctuation and suffixes (Jr, Sr, II, III,
// IV) dropped, so "O'Brien Jr." matches "OBrien" and "de la Cruz" matches "Cruz". A last name with no
// letters (the old code's placeholder dash) never matches.
//
// splitName: "Smith, John" is first John, last Smith. Honorifics (Mr, Mrs, Ms, Dr...) are dropped, and
// after one a single word is the last name ("Dr. Smith"); otherwise a single word is the first name
// and last is "" ("Cher"). The last word is the last name, keeping particles before it ("de la Cruz")
// and suffixes after it ("Smith Jr."). A word that is only a dash is dropped (the old code's
// placeholder last name, "Cher -"), so a name part is never a lone dash or an en or em dash.

import { samePlace } from "./jobberAddress.ts";
import type { Address } from "./jobberAddress.ts";

/** Why pickClient chose a client: the tier that matched, or "none". */
export type MatchReason = "email_phone" | "email" | "phone_name" | "name_address" | "none";

/** A Jobber client as pickClient reads it; a later PR maps Jobber's client search results into this shape. */
export interface ClientCandidate {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  isArchived?: boolean | null;
  emails: string[];
  phones: string[];
  /** The client's billing address and properties. */
  addresses: Address[];
}

/** The customer pickClient looks for, as stored; values are normalised here. */
export interface ClientWant {
  email?: string | null;
  phone?: string | null;
  lastName?: string | null;
  address?: Address | null;
}

/** pickClient's answer: the client (null for "none"), the tier that matched, and whether another client matched as well. */
export interface ClientPick {
  client: ClientCandidate | null;
  reason: MatchReason;
  ambiguous: boolean;
}

/** A name split for Jobber's firstName and lastName. */
export interface NameParts {
  first: string;
  last: string;
}

// The matching tiers, best first.
const TIERS: readonly MatchReason[] = ["email_phone", "email", "phone_name", "name_address"];

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "rev", "mister"]);
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "md", "phd", "dds", "esq"]);
const SURNAME_PARTICLES = new Set(["da", "de", "del", "della", "der", "di", "dos", "du", "la", "le", "van", "von", "st"]);
// Punctuation left after an address in a sentence or a list: "jo@example.com." or "jo@example.com;".
const EMAIL_TRAILING = /[\s.;,]+$/;
// One address: no spaces, brackets or separators, one @, and a domain ending in a real top-level name.
const EMAIL_RE = /^[^\s@<>;,]+@[^\s@<>;,]+\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/;

/** A US phone number as its 10 digits ("+1 (405) 555-0123" is "4055550123"); null with fewer digits or when it cannot be a US number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  // An area code starts with 2 to 9, and one digit repeated ten times is a stand-in.
  return /^[2-9]\d{9}$/.test(digits) && !/^(\d)\1{9}$/.test(digits) ? digits : null;
}

/** An email as the bare address, trimmed and lowercased; null when it is blank or not one address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let email = raw.trim().replace(EMAIL_TRAILING, "");
  // "<jo@example.com>" or "Jo Smith <jo@example.com>": the address in the brackets.
  const bracketed = /^[^<>@]*<([^<>]*)>$/.exec(email);
  if (bracketed) email = bracketed[1];
  email = email.trim().replace(/^mailto:/i, "").replace(EMAIL_TRAILING, "").toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

/** A full name as first and last name (rules at the top of this file). */
export function splitName(full: string | null | undefined): NameParts {
  const text = (full ?? "").normalize("NFKC").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");
  if (!text) return { first: "", last: "" };
  const comma = text.indexOf(",");
  if (comma !== -1) {
    const before = text.slice(0, comma).trim();
    const after = text.slice(comma + 1).trim();
    if (!wordsOf(after).every(isSuffix)) {
      // "Smith, John": the last name comes first.
      const first = dropHonorifics(wordsOf(after)).words;
      const last = dropHonorifics(wordsOf(before)).words;
      if (first.length > 0 && last.length > 0) return { first: first.join(" "), last: last.join(" ") };
    }
    // "John Smith, Jr.": what follows the comma belongs to the name.
    return splitName(`${before} ${after}`);
  }
  const { words, dropped } = dropHonorifics(wordsOf(text));
  if (words.length === 0) return { first: "", last: "" };
  // Suffixes stay with the last name, but never become a name of their own.
  let end = words.length;
  while (end > 1 && isSuffix(words[end - 1])) end--;
  const core = words.slice(0, end);
  const suffixes = words.slice(end);
  if (core.length === 1) {
    const one = [...core, ...suffixes].join(" ");
    return dropped ? { first: "", last: one } : { first: one, last: "" };
  }
  let start = core.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(letters(core[start - 1]))) start--;
  return { first: core.slice(0, start).join(" "), last: [...core.slice(start), ...suffixes].join(" ") };
}

/** The customer's existing Jobber client by the plan's tiers (never by name alone), flagging ambiguity. */
export function pickClient(
  candidates: readonly ClientCandidate[] | null | undefined,
  want: ClientWant | null | undefined,
): ClientPick {
  const email = normalizeEmail(want?.email);
  const phone = normalizePhone(want?.phone);
  const last = lastNameKey(want?.lastName);
  const address = want?.address ?? null;
  // The best tier each client reaches (lower is better), by id in the order first seen.
  const byId = new Map<string, { client: ClientCandidate; rank: number }>();
  for (const client of candidates ?? []) {
    if (!client?.id || client.isArchived) continue;
    const rank = rankOf(client, email, phone, last, address);
    const seen = byId.get(client.id);
    if (!seen) byId.set(client.id, { client, rank });
    else seen.rank = Math.min(seen.rank, rank);
  }
  const ranked = [...byId.values()];
  const best = Math.min(TIERS.length, ...ranked.map((m) => m.rank));
  if (best === TIERS.length) return { client: null, reason: "none", ambiguous: false };
  const matches = ranked.filter((m) => m.rank === best);
  return { client: matches[0].client, reason: TIERS[best], ambiguous: matches.length > 1 };
}

// The index in TIERS of the best tier this client reaches, or TIERS.length when none.
function rankOf(
  client: ClientCandidate,
  email: string | null,
  phone: string | null,
  last: string,
  address: Address | null,
): number {
  const byEmail = email !== null && (client.emails ?? []).some((e) => normalizeEmail(e) === email);
  const byPhone = phone !== null && (client.phones ?? []).some((p) => normalizePhone(p) === phone);
  const byName = last !== "" && lastNameKey(client.lastName) === last;
  let reason: MatchReason = "none";
  if (byEmail && byPhone) reason = "email_phone";
  else if (byEmail) reason = "email";
  else if (byPhone && byName) reason = "phone_name";
  else if (byName && address && (client.addresses ?? []).some((a) => samePlace(a, address))) reason = "name_address";
  return reason === "none" ? TIERS.length : TIERS.indexOf(reason);
}

// A last name reduced to its last word, with accents, punctuation and a suffix such as Jr dropped.
function lastNameKey(name: string | null | undefined): string {
  const words = fold(name ?? "").split(/[^a-z]+/).filter(Boolean);
  while (words.length > 1 && NAME_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.length > 0 ? words[words.length - 1] : "";
}

// Leading honorifics taken off ("Mr. and Mrs. John Smith" leaves "John Smith"), always leaving a word.
function dropHonorifics(words: string[]): { words: string[]; dropped: boolean } {
  let i = 0;
  for (;;) {
    if (words.length - i > 1 && HONORIFICS.has(letters(words[i]))) i++;
    else if (i > 0 && words.length - i > 2 && (words[i] === "&" || letters(words[i]) === "and") && HONORIFICS.has(letters(words[i + 1]))) i += 2;
    else break;
  }
  return { words: words.slice(i), dropped: i > 0 };
}

function isSuffix(word: string): boolean {
  return NAME_SUFFIXES.has(letters(word));
}

// The words of a name, without words that are only dashes ("-", an en dash, an em dash).
function wordsOf(text: string): string[] {
  return text.split(" ").filter((w) => w !== "" && !/^[-\u2010-\u2015\u2212]+$/.test(w));
}

function letters(word: string): string {
  return fold(word).replace(/[^a-z]/g, "");
}

// Lowercase ASCII with accents folded and periods and apostrophes dropped.
function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’`]/g, "");
}
