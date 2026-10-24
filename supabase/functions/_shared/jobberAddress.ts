// TreeCheck Jobber sync: one-line US addresses, address comparison, and the customer details and
// address a Jobber quote is built from (plan section 4, "Customer details and address precedence").
//
// Pure functions only: no Deno globals, no network and no clock, so the edge functions and the vitest
// suite (src/lib/jobberSync/address.test.ts) run the same file. Maintained outside Lovable.
//
// parseUsAddress reads a one-line address (a website lead, or a job card the office typed):
// * Commas split the line when it has them. Without commas the street ends after its type word
//   ("Main St", or a run such as "Park Place Dr"), its numbered road ("Highway 66", "County Road
//   3050") or a direction after the type ("Main St NW"), or where a unit starts ("Apt 4"); the rest
//   is the city. A city hint that ends the line decides instead. A line with no type word, no
//   numbered road and no unit is all street.
// * The state is a two-letter code or a full name, in any case. A code that is also a street word
//   (CT court, NE northeast, LA lane, WY way) counts as the state only when a city comes before it,
//   so "456 Oak Ct" is a street, not Connecticut.
// * ZIP or ZIP+4 (kept as "73034-1234"), a trailing "USA", line breaks and extra spaces are accepted.
//   A part typed all in lowercase comes back in title case ("1820 nw 24th st" is "1820 NW 24th St");
//   a part with any capital keeps its own ("McDonald Rd").
// * Hints fill only what the line leaves out. The ZIP hint is skipped when the line names a city
//   other than the city hint, so a new city never gets the old ZIP.
// * No street (no house number, only a city, a PO box) gives null.
//
// addressKey and samePlace compare addresses however they were written: lowercase, punctuation out,
// street types, directions and unit words abbreviated (Street/St, Northwest/NW, Apartment/Apt), state
// names as codes, the ZIP cut to 5 digits. samePlace needs the same house number and street, and the
// same ZIP, or the same city when either ZIP is missing. A street type or a unit that only one side
// has does not stop a match; two different ones do.
//
// jobCardAddress and customerDetails apply the plan's precedence. Values that are blank or a stand-in
// ("Homeowner", "Unknown", "n/a") count as missing, so the next source is used. The capture's ZIP
// fills the job-card line's ZIP only while the job card's city (the one its line names, else
// request.city) is the capture's city, or one of the two cities is unknown. With no street anywhere,
// jobCardAddress gives null and the quote fails with NO_STREET_REASON.

/** A US address: the internal shape a later PR maps onto Jobber's property address. */
export interface Address {
  street1: string;
  /** Apartment, suite, lot or other unit, when there is one. */
  street2?: string;
  city: string;
  /** Two-letter state code, or "" when unknown. */
  province: string;
  /** "73034" or "73034-1234", or "" when unknown. */
  postalCode: string;
  country: "US";
}

/** What fills the parts a one-line address leaves out. */
export interface AddressHints {
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  /** The company's state (company_jobber_settings.default_province), used when nothing else gives one. */
  defaultProvince?: string | null;
}

/** The job card columns read here (bid_requests). */
export interface JobCardFields {
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  city?: string | null;
}

/** The Scout capture columns read here (scout_captures). */
export interface CaptureFields {
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
}

/** The website lead columns read here (leads). */
export interface LeadFields {
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  city?: string | null;
}

/** The records a job's customer details and address are read from. */
export interface JobRecords {
  request?: JobCardFields | null;
  capture?: CaptureFields | null;
  lead?: LeadFields | null;
}

/** Where a customer detail or the address came from. */
export type DetailSource = "job_card" | "capture" | "lead";

/** An address and the source it came from. */
export interface SourcedAddress {
  address: Address;
  source: DetailSource;
}

/** The customer's details for Jobber, each with its source (null when no source has it). */
export interface CustomerDetails {
  name: string | null;
  phone: string | null;
  email: string | null;
  source: { name: DetailSource | null; phone: DetailSource | null; email: DetailSource | null };
}

const table = (entries: Record<string, string>) => new Map(Object.entries(entries));

const STATE_NAMES = table({
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  // The short form Oklahomans write.
  okla: "OK",
});
const STATE_CODES = new Set(STATE_NAMES.values());
// State codes that are also street words, so they need a city before them to count as a state.
const STREET_WORD_CODES = new Set(["ct", "ne", "la", "wy"]);

// Street type words, with the spelling every key uses.
const STREET_TYPES = table({
  street: "st", st: "st", str: "st", avenue: "ave", ave: "ave", av: "ave", road: "rd", rd: "rd",
  drive: "dr", dr: "dr", lane: "ln", ln: "ln", court: "ct", ct: "ct", boulevard: "blvd", blvd: "blvd",
  place: "pl", pl: "pl", circle: "cir", cir: "cir", parkway: "pkwy", pkwy: "pkwy", pky: "pkwy",
  terrace: "ter", ter: "ter", terr: "ter", highway: "hwy", hwy: "hwy", trail: "trl", trl: "trl",
  way: "way", square: "sq", sq: "sq", plaza: "plz", plz: "plz", expressway: "expy", expy: "expy",
  freeway: "fwy", fwy: "fwy", alley: "aly", aly: "aly",
});
const DIRECTIONS = table({
  north: "n", n: "n", south: "s", s: "s", east: "e", e: "e", west: "w", w: "w",
  northeast: "ne", ne: "ne", northwest: "nw", nw: "nw", southeast: "se", se: "se",
  southwest: "sw", sw: "sw",
});
// Directions that may follow a street type in a line ("Main St NW"). Full words such as "North" are
// left to the city ("North Little Rock").
const POST_DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw", "northeast", "northwest", "southeast", "southwest"]);
const UNIT_WORDS = table({
  apartment: "apt", apt: "apt", unit: "unit", suite: "ste", ste: "ste", "#": "#", building: "bldg",
  bldg: "bldg", floor: "fl", fl: "fl", room: "rm", rm: "rm", lot: "lot", space: "spc", spc: "spc",
  trailer: "trlr", trlr: "trlr",
});
// Other words that place and road names write two ways.
const OTHER_WORDS = table({ saint: "st", fort: "ft", mount: "mt", route: "rte", rte: "rte", rt: "rte" });
const ABBREVIATIONS = new Map([...STREET_TYPES, ...DIRECTIONS, ...UNIT_WORDS, ...OTHER_WORDS]);

// Road names written before their number, as token keys: "County Road 3050", "Highway 66", "FM 1960".
const NUMBERED_ROADS: readonly (readonly string[])[] = [
  ["farm", "to", "market"], ["county", "rd"], ["co", "rd"], ["state", "hwy"], ["us", "hwy"],
  ["state", "rte"], ["ranch", "rd"], ["hwy"], ["rte"], ["cr"], ["fm"], ["sr"], ["us"],
];

// Stand-ins people type when they have no value.
const STAND_INS = new Set(["homeowner", "home owner", "unknown", "n/a", "na", "none", "null", "tbd", "-"]);

const PO_BOX = /\b(?:p\s*o|post\s+office)\s*box\b/;
const COUNTRY_AT_END = /(?:^|[\s,]+)(?:u\.?\s?s\.?(?:\s?a\.?)?|united\s+states(?:\s+of\s+america)?|america)$/i;
const ZIP_AT_END = /(?:^|[\s,])(\d{5})(?:\s*-\s*(\d{4})|(\d{4}))?$/;

interface Token {
  /** As written. */
  raw: string;
  /** Folded, with punctuation off its edges ("St." is "st"). */
  norm: string;
  /** norm with the abbreviations applied ("Street" is "st"). */
  key: string;
}

/** A one-line US address as street, unit, city, state and ZIP (rules at the top of this file); null when it has no street. */
export function parseUsAddress(line: string | null | undefined, hints?: AddressHints | null): Address | null {
  let text = stripCountry(cleanLine(typeof line === "string" ? line : ""));
  if (!present(text)) return null;
  let zip = "";
  const z = ZIP_AT_END.exec(text);
  if (z) {
    const plus4 = z[2] ?? z[3];
    zip = plus4 ? `${z[1]}-${plus4}` : z[1];
    text = stripCountry(text.slice(0, z.index));
  }
  const segments = text.split(",").map((s) => s.trim()).filter(Boolean);
  const at = segments.findIndex((s) => isStreet(tokensOf(s)));
  if (at === -1) return null;
  const cityHint = present(hints?.city);
  const units = segments.filter((s, i) => i !== at && unitSizeAt(tokensOf(s), 0) > 0);
  const after = segments.slice(at + 1).filter((s) => unitSizeAt(tokensOf(s), 0) === 0);

  let state = "";
  // A state in a segment of its own ("..., Edmond, OK"), unless that segment is the hinted city.
  const last = after[after.length - 1];
  if (last && stateCode(last) && !(after.length === 1 && sameText(last, cityHint))) {
    state = stateCode(last);
    after.pop();
  }

  let street = tokensOf(segments[at]);
  let unit: Token[] = [];
  let city = "";
  if (after.length > 0) {
    // The last segment is the city, perhaps with the state after it ("Edmond OK").
    let cityTokens = tokensOf(after[after.length - 1]);
    const tail = state ? null : trailingState(cityTokens);
    if (tail) {
      state = tail.code;
      cityTokens = cityTokens.slice(0, cityTokens.length - tail.size);
    }
    city = join(cityTokens);
    ({ street, unit } = splitUnit(street));
  } else {
    // The street segment may hold the city and state as well ("123 Main St Edmond OK").
    const tail = state ? null : trailingState(street);
    if (tail && acceptsState(street, tail.size, cityHint)) {
      state = tail.code;
      street = street.slice(0, street.length - tail.size);
    }
    const split = splitStreet(street, cityHint);
    street = split.street;
    unit = split.unit;
    city = join(split.city);
  }
  if (!isStreet(street)) return null;

  const parsedCity = city.replace(/[\s.]+$/, "");
  const street2 = [join(unit), ...units].filter(Boolean).join(", ");
  const address: Address = {
    street1: caseFix(join(street)),
    city: caseFix(parsedCity || cityHint),
    province: state || stateCode(present(hints?.province)) || stateCode(present(hints?.defaultProvince)),
    postalCode: zip || (!parsedCity || !cityHint || sameText(parsedCity, cityHint) ? cleanZip(hints?.postalCode) : ""),
    country: "US",
  };
  if (street2) address.street2 = caseFix(street2);
  return address;
}

/** A comparison key for an address: two addresses with the same key are the same address, however they were written. */
export function addressKey(addr: Address | null | undefined): string {
  if (!addr) return "";
  const p = streetParts(addr.street1, addr.street2);
  const street = [p.number, p.name, p.type, p.direction].filter(Boolean).join(" ");
  return [street, p.unit, wordKey(addr.city), provinceKey(addr.province), zip5(addr.postalCode)].join("|");
}

/** True when two addresses are the same place: same house number and street, and the same ZIP (or the same city when a ZIP is missing). */
export function samePlace(a: Address | null | undefined, b: Address | null | undefined): boolean {
  if (!a || !b) return false;
  const x = streetParts(a.street1, a.street2);
  const y = streetParts(b.street1, b.street2);
  // A street with no number in it is a whole street, not a place.
  if (!x.name || !/\d/.test(`${x.number} ${x.name}`)) return false;
  if (x.number !== y.number || x.name !== y.name || x.direction !== y.direction) return false;
  if (x.type && y.type && x.type !== y.type) return false;
  if (x.unit && y.unit && x.unit !== y.unit) return false;
  const zipA = zip5(a.postalCode);
  const zipB = zip5(b.postalCode);
  if (zipA && zipB) return zipA === zipB;
  return sameText(a.city, b.city);
}

/** The quote failure reason when jobCardAddress finds no street (plan section 4; messages.md A4, sent from PR 4). */
export const NO_STREET_REASON = "No street address on the job: add it with Edit job details.";

/** The Jobber property address by the plan's precedence (job card, capture, lead) with its source; null when no source has a street (see NO_STREET_REASON). */
export function jobCardAddress(input: JobRecords & { defaultProvince?: string | null }): SourcedAddress | null {
  const { request, capture, lead } = input;
  const defaultProvince = present(input.defaultProvince);
  const fromCapture = captureAddress(capture, defaultProvince);
  const line = present(request?.customer_address);
  if (line) {
    const parsed = parseUsAddress(line, { city: request?.city, province: capture?.address_state, defaultProvince });
    // The capture's ZIP belongs to the capture's city, so it is no hint for another city: it fills the
    // ZIP only while the job card's city (its line's, else request.city) is the capture's city.
    const captureCity = present(capture?.address_city);
    if (parsed && !parsed.postalCode && (!parsed.city || !captureCity || sameText(parsed.city, captureCity))) {
      parsed.postalCode = cleanZip(capture?.address_zip);
    }
    // 1. A job-card line that normalises to the capture's address: the capture's own fields.
    if (fromCapture) {
      const sameLine = lineKey(line) === lineKey(captureLine(capture));
      if (sameLine || (parsed && addressKey(parsed) === addressKey(fromCapture))) {
        return { address: fromCapture, source: "capture" };
      }
    }
    // 2. Otherwise the job-card line, parsed with the hints.
    if (parsed) return { address: parsed, source: "job_card" };
  }
  // 3. Then the capture, then the lead's line.
  if (fromCapture) return { address: fromCapture, source: "capture" };
  const fromLead = parseUsAddress(lead?.customer_address, {
    city: present(lead?.city) || present(request?.city),
    defaultProvince,
  });
  return fromLead ? { address: fromLead, source: "lead" } : null;
}

/** The customer's name, phone and email by the plan's precedence (name and phone: job card, capture, lead; email: capture, lead), each with its source. */
export function customerDetails(input: JobRecords): CustomerDetails {
  const { request, capture, lead } = input;
  const name = firstPresent([["job_card", request?.customer_name], ["capture", capture?.customer_name], ["lead", lead?.customer_name]], () => true);
  const phone = firstPresent(
    [["job_card", request?.customer_phone], ["capture", capture?.customer_phone], ["lead", lead?.customer_phone]],
    (v) => /\d/.test(v),
  );
  const email = firstPresent([["capture", capture?.customer_email], ["lead", lead?.customer_email]], (v) => v.includes("@"));
  return {
    name: name.value,
    phone: phone.value,
    email: email.value,
    source: { name: name.source, phone: phone.source, email: email.source },
  };
}

// The first value that is present and passes the check, with its source.
function firstPresent(
  values: Array<[DetailSource, unknown]>,
  ok: (value: string) => boolean,
): { value: string | null; source: DetailSource | null } {
  for (const [source, raw] of values) {
    const value = present(raw);
    if (value && ok(value)) return { value, source };
  }
  return { value: null, source: null };
}

// The capture's own address fields as an Address, or null without a street. A street field that
// holds a whole line ("123 Main St, Edmond, OK 73034") is parsed, with the other fields as hints.
function captureAddress(capture: CaptureFields | null | undefined, defaultProvince: string): Address | null {
  const street = cleanLine(typeof capture?.address_street === "string" ? capture.address_street : "");
  if (street.includes(",") || ZIP_AT_END.test(street)) {
    return parseUsAddress(street, {
      city: capture?.address_city,
      province: capture?.address_state,
      postalCode: capture?.address_zip,
      defaultProvince,
    });
  }
  const tokens = tokensOf(street);
  if (!isStreet(tokens)) return null;
  const { street: main, unit } = splitUnit(tokens);
  const address: Address = {
    street1: caseFix(join(main)),
    city: caseFix(present(capture?.address_city)),
    province: stateCode(present(capture?.address_state)) || stateCode(defaultProvince),
    postalCode: cleanZip(capture?.address_zip),
    country: "US",
  };
  if (unit.length > 0) address.street2 = caseFix(join(unit));
  return address;
}

// The capture's fields as one line, the way bid-request-create first filled the job card.
function captureLine(capture: CaptureFields | null | undefined): string {
  return [capture?.address_street, capture?.address_city, capture?.address_state, capture?.address_zip]
    .map(present)
    .filter(Boolean)
    .join(", ");
}

// A one-line address reduced for comparison: no country, the ZIP+4 cut to the ZIP, then wordKey.
function lineKey(line: string): string {
  return wordKey(stripCountry(cleanLine(line)).replace(/\b(\d{5})(?:\s*-\s*\d{4}|\d{4})\b/g, "$1"));
}

interface StreetParts {
  number: string;
  name: string;
  type: string;
  direction: string;
  unit: string;
}

// The comparable parts of a street line and its unit line: "1820 Northwest 24th Street NW" with
// "Apt 4" is number "1820", name "nw 24th", type "st", direction "nw", unit "4".
function streetParts(street1: string | null | undefined, street2: string | null | undefined): StreetParts {
  const tokens = tokensOf(cleanLine(street1 ?? "").replace(/,/g, " "));
  const numbered = hasHouseNumber(tokens);
  const { street, unit } = splitUnit(tokens);
  const body = street.slice(numbered ? 1 : 0);
  let end = body.length;
  let direction = "";
  if (end > 2 && DIRECTIONS.has(body[end - 1].norm) && STREET_TYPES.has(body[end - 2].norm)) {
    direction = body[end - 1].key;
    end--;
  }
  let type = "";
  if (end > 1 && STREET_TYPES.has(body[end - 1].norm)) {
    type = body[end - 1].key;
    end--;
  }
  const unitWords = [...unit, ...tokensOf(cleanLine(street2 ?? "").replace(/,/g, " "))]
    .filter((t) => !UNIT_WORDS.has(t.norm))
    .map((t) => t.norm.replace(/^#/, ""))
    .filter(Boolean);
  return {
    number: numbered ? tokens[0].norm.replace(/[^a-z0-9]/g, "") : "",
    name: body.slice(0, end).map((t) => t.key).join(" "),
    type,
    direction,
    unit: unitWords.join(" "),
  };
}

// In a line with no comma before the state, the state needs a street before it, and a code that is
// also a street word (CT, NE, LA, WY) needs a city before it too.
function acceptsState(tokens: Token[], size: number, cityHint: string): boolean {
  const head = tokens.slice(0, tokens.length - size);
  if (!isStreet(head) || sameText(join(tokens.slice(tokens.length - size)), cityHint)) return false;
  const code = tokens[tokens.length - 1].norm;
  return !(size === 1 && STREET_WORD_CODES.has(code)) || splitStreet(head, cityHint).city.length > 0;
}

// The state at the end of these tokens, with how many tokens it takes (names run to 3 words), or
// null. At least one token is always left before it.
function trailingState(tokens: Token[]): { code: string; size: number } | null {
  for (let size = Math.min(3, tokens.length - 1); size >= 1; size--) {
    const code = stateCode(tokens.slice(tokens.length - size).map((t) => t.norm).join(" "));
    if (code) return { code, size };
  }
  return null;
}

// The street, unit and city of a line with no commas left in it.
function splitStreet(tokens: Token[], cityHint: string): { street: Token[]; unit: Token[]; city: Token[] } {
  const hint = wordKey(cityHint);
  const size = hint ? hint.split(" ").length : 0;
  if (size > 0 && tokens.length > size) {
    const head = tokens.slice(0, tokens.length - size);
    const tail = tokens.slice(tokens.length - size);
    if (tail.map((t) => t.key).join(" ") === hint && isStreet(head)) return { ...splitUnit(head), city: tail };
  }
  const end = streetEnd(tokens);
  const rest = tokens.slice(end);
  const unitSize = unitSizeAt(rest, 0);
  return { street: tokens.slice(0, end), unit: rest.slice(0, unitSize), city: rest.slice(unitSize) };
}

// Where the street ends in a line without commas (see the top of this file); the whole line when
// nothing marks the end.
function streetEnd(tokens: Token[]): number {
  const start = hasHouseNumber(tokens) ? 1 : 0;
  for (let i = start; i < tokens.length; i++) {
    if (i > start && unitSizeAt(tokens, i) > 0) return i;
    const road = numberedRoadAt(tokens, i);
    if (road > 0) return afterDirection(tokens, i + road + 1);
    // A type word needs a name before it, so "123 Court St" and "123 St Charles Ave" read right.
    if (i > start && STREET_TYPES.has(tokens[i].norm)) {
      let end = i + 1;
      while (end < tokens.length && STREET_TYPES.has(tokens[end].norm)) end++;
      return afterDirection(tokens, end);
    }
  }
  return tokens.length;
}

// How many tokens a numbered road's name takes at i when its number follows, else 0.
function numberedRoadAt(tokens: Token[], i: number): number {
  for (const words of NUMBERED_ROADS) {
    const number = tokens[i + words.length];
    if (number && /\d/.test(number.norm) && words.every((w, k) => tokens[i + k].key === w)) return words.length;
  }
  return 0;
}

function afterDirection(tokens: Token[], end: number): number {
  return end < tokens.length && POST_DIRECTIONS.has(tokens[end].norm) ? end + 1 : end;
}

// Splits street tokens at the first unit after the house number and a name ("123 Main St Apt 4"):
// the street, then the unit to the end.
function splitUnit(tokens: Token[]): { street: Token[]; unit: Token[] } {
  for (let i = hasHouseNumber(tokens) ? 2 : 1; i < tokens.length; i++) {
    if (unitSizeAt(tokens, i) > 0) return { street: tokens.slice(0, i), unit: tokens.slice(i) };
  }
  return { street: tokens, unit: [] };
}

// How many tokens a unit takes at i: 1 for "#4", 2 for "Apt 4" or "Suite B" (the id has a digit or is
// one letter), 0 when no unit starts there.
function unitSizeAt(tokens: Token[], i: number): number {
  const word = tokens[i];
  if (!word) return 0;
  if (/^#[a-z0-9]/.test(word.norm)) return 1;
  const id = tokens[i + 1];
  return UNIT_WORDS.has(word.norm) && id && /^#?(?:[a-z]|.*\d.*)$/.test(id.norm) ? 2 : 0;
}

function hasHouseNumber(tokens: Token[]): boolean {
  return tokens.length > 0 && /\d/.test(tokens[0].norm) && unitSizeAt(tokens, 0) === 0;
}

// A street has a number and a word in it, and is not a PO box or a unit on its own.
function isStreet(tokens: Token[]): boolean {
  const text = tokens.map((t) => t.norm).join(" ");
  return /\d/.test(text) && /[a-z]/.test(text) && !PO_BOX.test(text) && unitSizeAt(tokens, 0) === 0;
}

// The two-letter code for a state written as a code or a full name, or "" when it is neither.
function stateCode(text: string): string {
  const s = fold(text).replace(/[^a-z]+/g, " ").trim();
  if (s.length === 2 && STATE_CODES.has(s.toUpperCase())) return s.toUpperCase();
  return STATE_NAMES.get(s) ?? "";
}

function provinceKey(value: string | null | undefined): string {
  return stateCode(value ?? "").toLowerCase() || wordKey(value);
}

// A ZIP or ZIP+4 as "73034" or "73034-1234", or "" when it is neither.
function cleanZip(value: unknown): string {
  const m = /^(\d{5})(?:\s*-\s*(\d{4})|(\d{4}))?$/.exec(present(value));
  if (!m) return "";
  const plus4 = m[2] ?? m[3];
  return plus4 ? `${m[1]}-${plus4}` : m[1];
}

function zip5(value: string | null | undefined): string {
  return /^\s*(\d{5})/.exec(value ?? "")?.[1] ?? "";
}

// True when both texts have the same comparison words.
function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = wordKey(a);
  return key !== "" && key === wordKey(b);
}

// Text reduced for comparison: folded, punctuation as spaces, abbreviations applied.
function wordKey(text: string | null | undefined): string {
  return fold(text ?? "")
    .split(/[^a-z0-9#]+/)
    .filter(Boolean)
    .map((w) => ABBREVIATIONS.get(w) ?? w)
    .join(" ");
}

function tokensOf(text: string): Token[] {
  const out: Token[] = [];
  for (const raw of text.split(/\s+/)) {
    const norm = fold(raw).replace(/^[^a-z0-9#]+|[^a-z0-9#]+$/g, "");
    if (norm) out.push({ raw, norm, key: ABBREVIATIONS.get(norm) ?? norm });
  }
  return out;
}

function join(tokens: Token[]): string {
  return tokens.map((t) => t.raw).join(" ");
}

// Lowercase ASCII with accents folded and periods and apostrophes dropped, so "N.W." is "nw".
function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’`]/g, "");
}

// Text typed all in lowercase in title case ("1820 nw 24th st" is "1820 NW 24th St"); text with any
// capital as written.
function caseFix(text: string): string {
  if (/[A-Z]/.test(text)) return text;
  return text
    .replace(/(^|[\s-])([a-z])/g, (_m, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/\b(?:Ne|Nw|Se|Sw)\b/g, (d) => d.toUpperCase());
}

// A one-line address with line breaks and semicolons as commas, and spaces tidied.
function cleanLine(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\r\n;]+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\s*,[\s,]*/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "");
}

function stripCountry(text: string): string {
  return text.replace(COUNTRY_AT_END, "").replace(/[\s,]+$/, "");
}

// The value trimmed with single spaces, or "" when it is not text, is blank or is a stand-in.
function present(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return STAND_INS.has(text.toLowerCase()) ? "" : text;
}
