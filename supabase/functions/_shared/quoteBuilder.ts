// TreeCheck Jobber sync: the title, line items and description of a draft quote (plan section 4, D1, D2, D14).
//
// Pure functions only (no Deno globals, no network, no clock), so the same file runs in the edge
// functions and in the vitest suite (src/lib/jobberSync/quoteBuilder.test.ts). Maintained outside
// Lovable. No deployed function imports it yet.
//
// The quote the customer sees:
// * One priced main line, named after the service, carrying the whole sale price. Its description is
//   the AI overview after cleanAiOverview: what was observed, never a dollar figure, a price written as
//   a bare number, talk about how the price was reached, or an internal label such as the price
//   breakdown (D2).
// * Scope lines for what that price includes (stump grinding, haul-away), only when they apply. They
//   are text only at 0, so the priced lines always add up to the sale price to the cent (D1).
// * Tax follows the template. The default is not taxable, so the customer's total is the price picked.
// * Nothing here sets the quote's client message, so Leslee's default message stays (D2).
// * A price changed after the draft exists is never pushed to Jobber from here (D14): the office is
//   texted to change it on the same quote.
//
// Every text a customer can read comes out plain: no em or en dashes and no doubled spaces.
//
// These are TreeCheck's own line items, not Jobber's. PR 4 maps them to Jobber's
// QuoteCreateLineItemAttributes after the T1 test shows how Jobber stores and shows them (the
// customer price goes in unitPrice, never in the cost field).

// ---- Templates ----

/** When a scope line appears: on jobs with stump grinding, on jobs with haul-away, or on every quote. */
export type ScopeCondition = "stump" | "disposal" | "always";

/** One line of a quote template. Its name and description may use {service}. */
export interface QuoteTemplateLine {
  /** "main" carries the whole price and the AI overview; "scope" names something included, text only at 0. */
  kind: "main" | "scope";
  name: string;
  description?: string;
  /** Overrides the template's taxable setting for this line. */
  taxable?: boolean;
  /** Scope lines only: when the line appears (default "always"). The main line always appears. */
  showWhen?: ScopeCondition;
}

/** How a company's draft quotes are laid out. Stored in company_jobber_settings.quote_template with these keys. */
export interface QuoteTemplate {
  /** The quote title, with {service} and {city} placeholders. */
  titlePattern: string;
  /** Exactly one main line plus any scope lines, in the order they appear on the quote. */
  lines: readonly QuoteTemplateLine[];
  /** Whether lines are taxable unless a line says otherwise (set from the T1 tax result). */
  taxable: boolean;
}

const DEFAULT_LINES: readonly QuoteTemplateLine[] = Object.freeze([
  Object.freeze<QuoteTemplateLine>({ kind: "main", name: "{service}" }),
  Object.freeze<QuoteTemplateLine>({
    kind: "scope",
    name: "Stump grinding",
    description: "Included in the price.",
    showWhen: "stump",
  }),
  Object.freeze<QuoteTemplateLine>({
    kind: "scope",
    name: "Haul away wood and debris",
    description: "Included in the price.",
    showWhen: "disposal",
  }),
]);

/**
 * The layout used until Leslee's real quotes are recorded (Step 0, item 6) and Mark approves a
 * screenshot (D1). The service is the one priced line, with the AI overview as its description. Then
 * "Stump grinding" when the job includes it and "Haul away wood and debris" when the crew expects
 * disposal loads, each text only and marked as included. Not taxable, so the customer's total is the
 * price picked. Title: "Tree Removal in Edmond", or "Tree Removal" when the city is unknown.
 */
export const DEFAULT_QUOTE_TEMPLATE: QuoteTemplate = Object.freeze({
  titlePattern: "{service} in {city}",
  lines: DEFAULT_LINES,
  taxable: false,
});

const SCOPE_CONDITIONS: readonly string[] = ["stump", "disposal", "always"];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The template's lines, or null unless every line is well formed and exactly one is the main line. */
function templateLines(raw: unknown): QuoteTemplateLine[] | null {
  if (!Array.isArray(raw)) return null;
  const lines: QuoteTemplateLine[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const { kind, name } = entry;
    const description = entry.description ?? undefined;
    const taxable = entry.taxable ?? undefined;
    const showWhen = entry.showWhen ?? undefined;
    if (kind !== "main" && kind !== "scope") return null;
    if (typeof name !== "string" || !name.trim()) return null;
    if (description !== undefined && typeof description !== "string") return null;
    if (taxable !== undefined && typeof taxable !== "boolean") return null;
    if (showWhen !== undefined && !SCOPE_CONDITIONS.includes(showWhen as string)) return null;
    // typeof (not !== undefined) so the fields narrow under the app's non-strict tsconfig as well as in Deno.
    lines.push({
      kind,
      name,
      ...(typeof description === "string" ? { description } : {}),
      ...(typeof taxable === "boolean" ? { taxable } : {}),
      ...(showWhen !== undefined ? { showWhen: showWhen as ScopeCondition } : {}),
    });
  }
  return lines.filter((l) => l.kind === "main").length === 1 ? lines : null;
}

/** Reads company_jobber_settings.quote_template ('{}' by default), using the default for anything missing or malformed. */
export function quoteTemplateFrom(raw: unknown): QuoteTemplate {
  const stored = isRecord(raw) ? raw : {};
  const { titlePattern, taxable } = stored;
  return {
    titlePattern:
      typeof titlePattern === "string" && titlePattern.trim() ? titlePattern : DEFAULT_QUOTE_TEMPLATE.titlePattern,
    lines: templateLines(stored.lines) ?? DEFAULT_QUOTE_TEMPLATE.lines,
    taxable: typeof taxable === "boolean" ? taxable : DEFAULT_QUOTE_TEMPLATE.taxable,
  };
}

// ---- Prices in text ----

// A number as written (1250, 1,250, 1,250.00, 2.5), never the front part of a longer number.
const NUM = String.raw`\d+(?:,\d+)*(?:\.\d+)?(?![,.]?\d)`;
// "$2k", "1.5 K" (the regex runs with the i flag).
const THOUSANDS = String.raw`(?:\s?k\b)?`;
// A range dash: hyphen, figure, en or em dash, horizontal bar, minus sign.
const DASH = String.raw`\s?[\u2012-\u2015\u2212-]\s?`;
// A dollar amount: $1,250, $ 1,250, +$65, -$0, ~$1,500, US$300, USD 300, USD$300, $300 USD, $2k, $.99.
const SIGN_FIRST = String.raw`(?:[~+\u2212-]\s?)?(?:\bUSD\s?\$?|\bUS\$|\$)\s?(?:${NUM}|\.\d+(?![,.]?\d))${THOUSANDS}(?:\s?(?:USD|dollars?)\b)?`;
// The sign written after the figure: 1,686$, 1,200-1,500$. Not the 2 in "2 $650 trees".
const SIGN_AFTER = String.raw`\b(?:${NUM}${THOUSANDS}(?:${DASH}|\sto\s))?${NUM}${THOUSANDS}\s?\$(?!\s?[\d.])`;
const DOLLARS = `(?:${SIGN_FIRST}|${SIGN_AFTER})`;
// An amount in words: 1,250.00 dollars, 300 USD, 1,000 to 1,500 dollars, 50 cents.
const IN_WORDS = String.raw`\b(?:${NUM}${THOUSANDS}(?:${DASH}|\sto\s))?${NUM}${THOUSANDS}\s?(?:USD|dollars?|bucks|cents?)\b`;
// A unit after a number says it isn't a price: "2 loads", "40 ft", "30%". "in" is inches, but not in
// "1,686 in total" or "1,500 in all".
const NOT_A_UNIT = String.raw`(?!\s?(?:(?:loads?|trees?|stumps?|limbs?|trips?|ft|feet|foot|inch(?:es)?|in(?!\s+(?:total|all)\b)|yards?|yds?|hours?|hrs?|days?|workers?|men|people)\b|%))`;
// A bare number labelled as money, with its colon or equals sign: "Total: 1,632", "Price = 1686".
// Not "Total height: 60 ft".
const PRICE_LABEL = String.raw`(?:price|pricing|costs?|total|subtotal|fees?|charges?|quote|budget|deposit|discount|tax|sale)`;
const LABELLED = String.raw`(?<=\b${PRICE_LABEL})\s?[:=]\s?${NUM}${THOUSANDS}${NOT_A_UNIT}`;
const AMOUNT = `(?:${DOLLARS}|${IN_WORDS})`;
// The rest of the same figure: a range ("$1,200 - $1,500", "$1,200 to 1,500") or a sum ("$650 + $65 = $715").
// A bare number after a dash is the end of a range only when no unit follows ("$1,686 - 2 loads" keeps "2 loads").
const MORE = String.raw`(?:(?:${DASH}|\s(?:to|or|and|plus|minus)\s|\s?[+=x\u00d7*/]\s?)${AMOUNT}|(?:${DASH}|\sto\s)${NUM}${THOUSANDS}${NOT_A_UNIT})`;
// A rate after the figure: "$25/hr", "$100 an hour", "$200 per load", "$50 each".
const RATE = String.raw`(?:\s?\/\s?[a-z]+\b|\s(?:per|an?)\s(?:hour|hr|day|load|trip|tree|stump|person|worker)s?\b|\seach\b)?`;

// Every price-like figure, with its range, sum or rate.
const PRICE = new RegExp(`(?:${AMOUNT}|${LABELLED})(?:${MORE})*${RATE}`, "gi");
const HAS_PRICE = new RegExp(PRICE.source, "i");
// A line (after any bullet) that opens with a price is a breakdown entry: "$1,686 for removal".
const STARTS_WITH_PRICE = new RegExp(`^(?:${AMOUNT})`, "i");
const BULLET = /^[-*\u2022]\s+/;

// Words that only describe a price: a line left with nothing else held only a price.
const PRICE_WORDS = new Set([
  "total", "subtotal", "grand", "price", "priced", "pricing", "cost", "costs", "fee", "fees", "estimate",
  "estimated", "amount", "range", "due", "balance", "deposit", "tax", "sale", "quote", "quoted", "budget",
  "charge", "rate", "approx", "approximately", "about", "around", "between", "and", "or", "to", "of",
  "the", "a", "is", "at", "for", "from", "plus", "minus", "each", "per", "only", "in", "all",
]);

const hasMoney = (text: string): boolean => text.includes("$") || HAS_PRICE.test(text);

// ---- Talk about the price ----
//
// Scout's notes are written for the rep, and their PRICING NOTES explain the "key pricing drivers",
// often with bare numbers ("lifting the total to 2500"). A sentence is about the price when it has a
// dollar amount, a word that only ever speaks of price or pricing rules, a word that can mean price
// next to a bare number, or a bare number with a rate after it ("125 per load").

// Words that speak of the price wherever they appear: "Sale price", "the pricing drivers", "costs",
// "the minimum charge", "Estimator fee", "price protection", "Margin", "Base rate", "adders".
const PRICE_TALK = new RegExp(
  String.raw`\b(?:pric(?:e[ds]?|ing)|costs?|costing|charge[ds]?|surcharges?|fees?|budget(?:ed|s)?|discount(?:ed|s)?` +
    String.raw`|markups?|(?<!\bleaf[\s-])margins?|profits?|billable|adders?|dbh\s+buckets?|(?:base|hourly|labou?r|day)\s+rates?)\b`,
  "i",
);
// Words that speak of the price only next to a bare number: "lifting the total to 2500", "Estimate 1450
// to 1700", "Rigging adds 300". Not "Estimated height: 60 ft" (a unit follows the number).
const PRICE_HINT =
  /\b(?:total(?:s|ed|ing)?|subtotal|minimum|maximum|rates?|quot(?:e[ds]?|ing)|invoic(?:e[ds]?|ing)|estimat(?:e[ds]?|ing)|deposits?|amount|balance|sum|range|paid|pays?|worth|adds?|added|plus)\b/i;
// A number as written, with any range after it: 2500, 1,450-1,700, 1450 to 1700.
const FIGURE = new RegExp(String.raw`\b${NUM}(?:(?:${DASH}|\s(?:to|or)\s)${NUM})*${THOUSANDS}`, "gi");
// A unit right after a number makes it a measurement or a count: "60 ft", "a 30-inch trunk", "2 loads",
// "40%", "24 ft" written with a foot or inch mark. "in" is inches ("30 in at the base"), but not in
// "comes to 1,686 in total" or "1,500 in all".
const MEASURE_AFTER = new RegExp(
  String.raw`^(?:[\s-]?(?:loads?|trees?|stumps?|limbs?|leaders?|trunks?|stems?|branch(?:es)?|trips?|ft|feet|foot|inch(?:es)?|in(?!\s+(?:total|all)\b)` +
    String.raw`|yards?|yds?|meters?|m|miles?|mi|lbs?|pounds?|tons?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|workers?|men` +
    String.raw`|people|persons?|climbers?|crews?|visits?)\b|\s?%|['"\u2032\u2033])`,
  "i",
);
// A bare number with a rate after it: "125 each", "85/hr", "200 per load", "90 an hour".
const BARE_RATE = new RegExp(
  String.raw`\b${NUM}${THOUSANDS}\s?(?:each|apiece|per\s+(?!cent\b)[a-z]+|an?\s+(?:hour|hr|day|load|trip|tree|stump|person|worker)s?\b` +
    String.raw`|\/\s?(?:hour|hr|day|load|trip|tree|stump|person|worker)s?\b)`,
  "i",
);

/** True when the text holds a number with no unit after it, which could be a price. */
function hasBareFigure(text: string): boolean {
  for (const m of text.matchAll(FIGURE)) {
    if (!MEASURE_AFTER.test(text.slice((m.index ?? 0) + m[0].length))) return true;
  }
  return false;
}

/** True when a sentence speaks of the price (see above), with or without a dollar sign. */
function talksPrice(sentence: string): boolean {
  return (
    hasMoney(sentence) ||
    PRICE_TALK.test(sentence) ||
    BARE_RATE.test(sentence) ||
    (PRICE_HINT.test(sentence) && hasBareFigure(sentence))
  );
}

/** Closes the gaps a removed figure leaves: empty brackets, doubled spaces, stray punctuation. */
function closeGaps(line: string): string {
  return line
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ([,.;:!?)\]])/g, "$1")
    .replace(/([([]) /g, "$1")
    .replace(/[,;:](?=[,.;!?])/g, "")
    .trim()
    .replace(/[,;]+$/, "");
}

/** One line without its price figures, or null when it held nothing but a price breakdown. */
function stripLine(line: string): string | null {
  if (!hasMoney(line)) return line;
  if (STARTS_WITH_PRICE.test(line.trim().replace(BULLET, ""))) return null;
  const out = closeGaps(line.replace(PRICE, " ").replace(/\$/g, " "));
  const residue = out.replace(/[^\p{L}\p{N}:]+/gu, " ").trim();
  if (!residue || residue.endsWith(":")) return null;
  if (residue.toLowerCase().split(/[\s:]+/).every((w) => !w || PRICE_WORDS.has(w))) return null;
  // Closing a gap can join a number to a currency word ("300 ( $5 ) dollars"), so go again until clean.
  return hasMoney(out) ? stripLine(out) : out;
}

/** Takes dollar amounts and price-like figures out of a text and drops lines that held only a price breakdown. */
export function stripPrices(text: string | null | undefined): string {
  if (!text) return "";
  const kept: string[] = [];
  for (const line of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    const stripped = stripLine(line);
    if (stripped !== null) kept.push(stripped);
  }
  return kept.join("\n").trim();
}

// ---- Plain text ----

/** Replaces em and en dashes (and their look-alikes) so customer text never shows one. */
function plainDashes(text: string): string {
  return text
    .replace(/^([ \t]*)[\u2012-\u2015\u2212]+[ \t]*/gm, "$1- ") // a dash used as a bullet
    .replace(/(\d)[ \t]*[\u2012-\u2015\u2212][ \t]*(?=[$\d])/g, "$1-") // a range: 18-24, $1,200-$1,500
    .replace(/(\S)[\u2013\u2212](?=\S)/g, "$1-") // joined words: north-south
    .replace(/[ \t]*[\u2012-\u2015\u2212]+[ \t]*$/gm, "") // a dash ending a line
    .replace(/[ \t]*[\u2012-\u2015\u2212]+[ \t]*/g, ", ") // a dash between clauses
    .replace(/,(?:[ \t]*,)+/g, ",");
}

/** One line of plain text: no dashes, single spaces, no stray commas at the ends. */
function plainLine(text: string | null | undefined): string {
  return plainDashes(String(text ?? ""))
    .replace(/\s+/g, " ")
    .replace(/^[\s,;]+|[\s,;]+$/g, "");
}

/** What a quote calls the work when the job has no service. */
const DEFAULT_SERVICE = "Tree work";

/** The service as a customer reads it: plain, no price, "Tree work" when unknown. */
function serviceName(service: string | null | undefined): string {
  return plainLine(stripPrices(service)) || DEFAULT_SERVICE;
}

// ---- The AI overview ----

/** The longest AI overview put on a quote line, in characters. */
export const OVERVIEW_MAX_CHARS = 1500;

// The Scout estimator's section headings. Its notes reach TreeCheck flattened onto one line.
const INLINE_HEADING = /\s*\b(OBSERVATIONS|PRICE BREAKDOWN|COST BREAKDOWN|PRICING NOTES)\b:?\s*/g;
// A flattened bullet: " - Estimated height: ..." (a capitalised label and a colon follow the dash).
const INLINE_BULLET = /[ \t]+[-*\u2022][ \t]+(?=[A-Z][^:\n]{0,60}:)/g;
// A heading: a known section name, alone on its line or as a label in front of the text
// ("Pricing notes: The tree leans..."), or a short label with nothing after its colon ("Scout notes:").
const HEADING_NAMES = String.raw`observations?|(?:price|cost|pricing)\s+breakdown|pricing(?:\s+notes)?|(?:field|scout|rep)\s+notes|notes|summary|findings|details`;
const HEADING = new RegExp(String.raw`^(?:${HEADING_NAMES})\s*:?$`, "i");
const HEADING_LABEL = new RegExp(String.raw`^(?:${HEADING_NAMES})\s*:\s*`, "i");
const LABEL_ONLY = /^[^:]{1,40}:$/;
// Headings whose whole section is internal pricing, dropped up to the next heading or blank line.
const INTERNAL_SECTION = /breakdown|^pricing\s*:?$/i;
// Scout's PRICING NOTES mix hazards and access with the pricing drivers, so up to the next heading or
// blank line (and on a line that opens with the label) a sentence is kept only with no bare number at all.
const PRICING_NOTES = /^pricing\s+notes\b/i;
// Lines meant for the office, not the customer, wherever they appear: "Total: ...", "Estimator fee",
// "Large tree price protection applied: No", "Difficulty: Hard", "Risk: Medium", "Cost estimate: ...",
// "Margin: 30%". Not observations such as "Total height: 60 ft" or "Risk of failure: high".
const INTERNAL_LINE = new RegExp(
  String.raw`^(?:(?:sub|grand\s+)?total(?:\s*[:$\d]|$)|estimator(?:'s)?\s+fees?\b|base\s+price\b` +
    String.raw`|(?:large\s+tree\s+)?price\s+protection\b|owner\s+keeps\b|(?:difficulty|risk)\s*:` +
    String.raw`|(?:sale\s+|estimated\s+)?(?:price|pricing|costs?|fees?|tax|deposit|discount|margin|markup|profit|budget)(?:\s+(?!notes\b)[a-z]+)?\s*:)`,
  "i",
);
// The end of a sentence: ., ! or ? (then any closing quote or bracket) before a space or the end.
const SENTENCE_END = /[.!?]["')\]]*$/;
const SENTENCE_BREAK = /(?<=[.!?]["')\]]*)\s+/;

interface OverviewPart {
  text: string;
  bullet: boolean;
}

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** The overview's lines and bullets that a customer may read, each with its price sentences removed. */
function overviewParts(text: string): OverviewPart[] {
  const lines = plainDashes(text.replace(/\r\n?/g, "\n"))
    .replace(INLINE_HEADING, "\n$1\n")
    .replace(INLINE_BULLET, "\n- ")
    .split("\n");
  const parts: OverviewPart[] = [];
  let internalSection = false;
  let pricingNotes = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) {
      internalSection = false;
      pricingNotes = false;
      continue;
    }
    const bullet = BULLET.test(line);
    const body = line.replace(BULLET, "");
    if (!bullet && (HEADING.test(body) || (LABEL_ONLY.test(body) && wordCount(body) <= 4))) {
      internalSection = INTERNAL_SECTION.test(body);
      pricingNotes = PRICING_NOTES.test(body);
      continue;
    }
    if (internalSection || INTERNAL_LINE.test(body) || STARTS_WITH_PRICE.test(body)) continue;
    const strict = pricingNotes || PRICING_NOTES.test(body);
    // A sentence about the price is dropped whole: the price lives on the line item, and a sentence
    // with its figure cut out reads wrong.
    const kept = body
      .replace(HEADING_LABEL, "")
      .split(SENTENCE_BREAK)
      .filter((s) => !talksPrice(s) && !(strict && hasBareFigure(s)))
      .join(" ");
    if (kept) parts.push({ text: kept, bullet });
  }
  return parts;
}

/** Joins the parts into one paragraph, ending each line or bullet as a sentence. */
function joinParts(parts: OverviewPart[]): string {
  return parts
    .map((part, i) => {
      const next = parts[i + 1];
      // A line that carries on in lower case is one sentence wrapped over two lines.
      const runsOn = !part.bullet && next !== undefined && !next.bullet && /^[a-z]/.test(next.text);
      return runsOn || SENTENCE_END.test(part.text) ? part.text : `${part.text.replace(/[\s,;:]+$/, "")}.`;
    })
    .join(" ");
}

/** Cuts text to at most max characters, ending on a sentence boundary (or a word, closed with a period). */
function capAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  let cut = 0;
  for (const m of head.matchAll(/[.!?]["')\]]*(?=\s|$)/g)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end <= max) cut = end;
  }
  if (cut > 0) return text.slice(0, cut);
  const space = text.lastIndexOf(" ", max - 1);
  return `${text.slice(0, space > 0 ? space : max - 1).replace(/[\s,;:]+$/, "")}.`;
}

/**
 * The AI overview as the main line's description: the observations and notes a customer may read, in
 * one plain paragraph of at most OVERVIEW_MAX_CHARS characters ending on a sentence, with no dollar
 * figure, no sentence about the price (a bare-number price, price protection, margins, base rates),
 * no price breakdown and no internal label (Total, Estimator fee, Difficulty, Risk, headings).
 */
export function cleanAiOverview(text: string | null | undefined): string {
  if (!text) return "";
  const paragraph = joinParts(overviewParts(String(text))).replace(/\s+/g, " ").trim();
  // Joining lines can bring a number next to a currency word, so take out anything that became a price.
  return capAtSentence(plainLine(stripPrices(paragraph)), OVERVIEW_MAX_CHARS);
}

// ---- Line items and title ----

/** One line of a draft quote in TreeCheck's terms. PR 4 maps it to Jobber's line item attributes after T1. */
export interface QuoteLineItem {
  name: string;
  description: string;
  quantity: 1;
  /** Dollars, rounded to cents. Only the main line has a price; scope lines are 0. */
  unitPrice: number;
  taxable: boolean;
  /** A scope line, shown as text with no price. */
  textOnly: boolean;
}

/** What buildQuoteLineItems needs to know about the job. */
export interface QuoteLineInput {
  template: QuoteTemplate;
  /** The sale price in dollars: the price picked, or today's formula price when nothing was picked (D16). */
  salePrice: number;
  /** The service, for example "Tree Removal". */
  service: string | null | undefined;
  /** The AI overview (Scout notes), cleaned with cleanAiOverview before it goes on the quote. */
  overview: string | null | undefined;
  /** bid_requests.needs_stump_grinding. */
  needsStump: boolean;
  /** The awarded crew's estimated disposal loads; 0 or unknown means no haul-away line. */
  disposalLoads: number | null | undefined;
}

/** Whole cents, rounding half up on the number as written (1.005 is 101 cents, where 1.005 * 100 gives 100). */
function toCents(dollars: number): number {
  const shifted = Number(`${dollars}e2`);
  return Math.round(Number.isFinite(shifted) ? shifted : dollars * 100);
}

/** The sale price in whole cents, or a clear error when there is no usable price. */
function saleCents(salePrice: number): number {
  if (typeof salePrice !== "number" || !Number.isFinite(salePrice)) {
    throw new Error("The quote has no valid sale price.");
  }
  const cents = toCents(salePrice);
  if (cents <= 0) throw new Error("The quote needs a sale price above zero.");
  return cents;
}

/** Whether a scope line belongs on this quote. A stump line is left off when the service already is stump grinding. */
function scopeApplies(line: QuoteTemplateLine, service: string, input: QuoteLineInput): boolean {
  if (line.showWhen === "stump") return input.needsStump === true && !/stump/i.test(service);
  if (line.showWhen === "disposal") return Number(input.disposalLoads) > 0;
  return true;
}

const withService = (text: string | undefined, service: string): string =>
  plainLine((text ?? "").replace(/\{service\}/g, service));

/**
 * The draft quote's line items in template order. Exactly the main line carries the sale price,
 * rounded to cents, with the cleaned AI overview after any description of its own; scope lines are
 * text only at 0, so the priced lines add up to the sale price to the cent. Throws when the price is
 * missing, not a number or not above zero, or when the template is malformed.
 */
export function buildQuoteLineItems(input: QuoteLineInput): QuoteLineItem[] {
  const cents = saleCents(input.salePrice);
  const lines = input.template?.lines;
  if (!Array.isArray(lines) || lines.filter((l) => l.kind === "main").length !== 1) {
    throw new Error("The quote template must have exactly one main line.");
  }
  const service = serviceName(input.service);
  const overview = cleanAiOverview(input.overview);
  const items: QuoteLineItem[] = [];
  for (const line of lines) {
    const main = line.kind === "main";
    if (!main && !scopeApplies(line, service, input)) continue;
    const name = withService(line.name, service);
    if (!name) throw new Error("Every line in the quote template needs a name.");
    const description = withService(line.description, service);
    items.push({
      name,
      description: main ? [description, overview].filter(Boolean).join("\n\n") : description,
      quantity: 1,
      unitPrice: main ? cents / 100 : 0,
      taxable: (line.taxable ?? input.template.taxable) === true,
      textOnly: !main,
    });
  }
  return items;
}

// Text in a title pattern that only joins two parts: separators and at most one small word.
const JOINER = /^[\s,;:|/&+\u00b7-]*(?:\b(?:in|at|near|for|of|by|and|from)\b[\s,;:|/&+\u00b7-]*)?$/i;
const TITLE_EDGES = /^[\s,;:|/&+\u00b7-]+|[\s,;:|/&+\u00b7-]+$/g;

/** Removes an empty placeholder's joining text ("{service} in {city}" with no city), or its brackets. */
function dropJoiner(parts: string[], i: number): void {
  const before = parts[i - 1];
  const after = parts[i + 1] ?? "";
  if (/[([]\s*$/.test(before) && /^\s*[)\]]/.test(after)) {
    parts[i - 1] = before.replace(/\s*[([]\s*$/, "");
    parts[i + 1] = after.replace(/^\s*[)\]]/, "");
  } else if (parts.slice(0, i).join("").trim() && JOINER.test(before)) {
    parts[i - 1] = "";
  } else if (JOINER.test(after)) {
    parts[i + 1] = "";
  }
}

/** The quote's title from the template's pattern, with no doubled spaces or dangling separators when the city is unknown. */
export function quoteTitle({
  template,
  service,
  city,
}: {
  template: QuoteTemplate;
  service: string | null | undefined;
  city: string | null | undefined;
}): string {
  const pattern = template?.titlePattern?.trim() ? template.titlePattern : DEFAULT_QUOTE_TEMPLATE.titlePattern;
  const values: Record<string, string> = { "{service}": serviceName(service), "{city}": plainLine(city) };
  // Splitting on a captured placeholder puts every placeholder at an odd index.
  const parts = pattern.split(/(\{service\}|\{city\})/);
  for (let i = 1; i < parts.length; i += 2) {
    parts[i] = values[parts[i]];
    if (!parts[i]) dropJoiner(parts, i);
  }
  return plainLine(parts.join(""))
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([,;:)\]])/g, "$1")
    .replace(/([,;:|/-])(?:\s*[,;:|/-])+/g, "$1")
    .replace(TITLE_EDGES, "");
}
