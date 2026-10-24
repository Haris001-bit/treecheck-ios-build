// Financial Pulse: merchants the sorter knows by name (A10 step 5 and the refund guard in step 4).
//
// Pure data and functions only (no runtime-specific or network APIs), so the same file runs in the
// edge functions and in the vitest suite (src/lib/pulse/merchantRules.test.ts).
//
// A merchant is recognised in three normalized texts (normalize.ts): the merchant name, the
// counterparty name and the description key. A pattern matches whole words, so "shell" matches
// "shell oil" but not "shellfish". Patterns marked exact must be the whole text (short or common
// names such as "76" or "gusto"). When several patterns match, the longest wins (most words, then
// most letters), then the one listed first.
//
// Known merchants (money out):
// * payroll_contractors: payroll providers (Gusto, ADP, Paychex, Intuit and QuickBooks payroll,
//   Square payroll, OnPay, Rippling, Patriot, and a few other payroll-only providers).
// * job_fees: equipment rental (Sunbelt, United Rentals, Home Depot tool rental, Herc and the like).
// * operating: software and SaaS the trade uses (Google Workspace, Microsoft, Adobe, Intuit and
//   QuickBooks, Jobber, CompanyCam and the like).
// * fuel_equipment: fuel stations and fleet fuel cards.
// Payment processors and apps (Jobber, Square, Stripe, Intuit/QuickBooks, PayPal, Venmo, Zelle,
// Cash App, Apple Cash) are listed separately: money into a bank account from them is a payout or a
// transfer, never a refund, and they are never one side of an own transfer.
// Payment-app payees (Zelle, Venmo, Cash App, Apple Cash) are listed separately again: money sent
// through them counts as payroll and contractors.
// When a pattern is added or changed: bump MERCHANT_RULES_VERSION and SORTER_VERSION.

import { descriptionKey, normalizeText, type DescriptionFields, type Normalizer } from "./normalize.ts";
import type { DefaultCategoryKey } from "./types.ts";

export const MERCHANT_RULES_VERSION = "merchant-rules-2";

export type MerchantKind = "payroll" | "equipment_rental" | "software" | "fuel";

export interface MerchantMatch {
  category: DefaultCategoryKey;
  kind: MerchantKind;
  /** The pattern that matched (normalized words). */
  pattern: string;
}

/** The normalized texts a merchant is recognised in (see merchantTexts). */
export type MerchantTexts = readonly string[];

type Mode = "word" | "exact";
type Row = readonly [pattern: string, kind: MerchantKind, mode: Mode];

const CATEGORY: Readonly<Record<MerchantKind, DefaultCategoryKey>> = {
  payroll: "payroll_contractors",
  equipment_rental: "job_fees",
  software: "operating",
  fuel: "fuel_equipment",
};

const KNOWN: readonly Row[] = [
  // Payroll providers
  ["gusto", "payroll", "exact"],
  ["gusto pay", "payroll", "word"],
  ["gusto net", "payroll", "word"],
  ["gusto tax", "payroll", "word"],
  ["gusto fee", "payroll", "word"],
  ["gusto payroll", "payroll", "word"],
  ["gusto com", "payroll", "word"],
  ["adp", "payroll", "word"],
  ["paychex", "payroll", "word"],
  ["intuit payroll", "payroll", "word"],
  ["quickbooks payroll", "payroll", "word"],
  ["qbooks payroll", "payroll", "word"],
  ["square payroll", "payroll", "word"],
  ["sq payroll", "payroll", "word"],
  ["onpay", "payroll", "word"],
  ["rippling", "payroll", "word"],
  ["patriot software", "payroll", "word"],
  ["patriot payroll", "payroll", "word"],
  ["paycor", "payroll", "word"],
  ["paylocity", "payroll", "word"],
  ["paycom", "payroll", "word"],
  ["justworks", "payroll", "word"],
  ["trinet", "payroll", "word"],
  // Equipment rental
  ["sunbelt rentals", "equipment_rental", "word"],
  ["sunbelt rental", "equipment_rental", "word"],
  ["united rentals", "equipment_rental", "word"],
  ["united rental", "equipment_rental", "word"],
  ["home depot tool rental", "equipment_rental", "word"],
  ["home depot rental", "equipment_rental", "word"],
  ["lowes tool rental", "equipment_rental", "word"],
  ["herc rentals", "equipment_rental", "word"],
  ["herc", "equipment_rental", "word"],
  ["ahern rentals", "equipment_rental", "word"],
  ["equipmentshare", "equipment_rental", "word"],
  ["he equipment", "equipment_rental", "word"],
  ["h e equipment", "equipment_rental", "word"],
  ["sunstate equipment", "equipment_rental", "word"],
  ["tool rental", "equipment_rental", "word"],
  ["equipment rental", "equipment_rental", "word"],
  ["equipment rentals", "equipment_rental", "word"],
  // Software and SaaS
  ["google workspace", "software", "word"],
  ["google gsuite", "software", "word"],
  ["gsuite", "software", "word"],
  ["g suite", "software", "word"],
  ["google cloud", "software", "word"],
  ["google ads", "software", "word"],
  ["microsoft", "software", "word"],
  ["msft", "software", "word"],
  ["adobe", "software", "word"],
  ["dropbox", "software", "word"],
  ["zoom", "software", "exact"],
  ["zoom us", "software", "word"],
  ["zoom com", "software", "word"],
  ["zoom video", "software", "word"],
  ["slack", "software", "word"],
  ["intuit", "software", "word"],
  ["quickbooks", "software", "word"],
  ["qbooks", "software", "word"],
  ["jobber", "software", "word"],
  ["companycam", "software", "word"],
  ["calendly", "software", "word"],
  ["mailchimp", "software", "word"],
  ["canva", "software", "word"],
  ["godaddy", "software", "word"],
  ["squarespace", "software", "word"],
  ["wix", "software", "word"],
  ["shopify", "software", "word"],
  ["hubspot", "software", "word"],
  ["openai", "software", "word"],
  ["chatgpt", "software", "word"],
  ["docusign", "software", "word"],
  ["github", "software", "word"],
  ["aws", "software", "word"],
  ["amazon services", "software", "word"], // "Amazon Web Services" ("web" is bank boilerplate)
  ["twilio", "software", "word"],
  ["ringcentral", "software", "word"],
  ["openphone", "software", "word"],
  ["housecall pro", "software", "word"],
  ["servicetitan", "software", "word"],
  ["arborgold", "software", "word"],
  ["singleops", "software", "word"],
  ["treecheck", "software", "word"],
  ["lovable", "software", "word"],
  ["facebk", "software", "word"],
  ["yelp", "software", "word"],
  ["thumbtack", "software", "word"],
  // Fuel stations and fleet fuel cards
  ["shell", "fuel", "word"],
  ["chevron", "fuel", "word"],
  ["exxon", "fuel", "word"],
  ["exxonmobil", "fuel", "word"],
  ["mobil", "fuel", "word"],
  ["bp", "fuel", "word"],
  ["texaco", "fuel", "word"],
  ["valero", "fuel", "word"],
  ["marathon", "fuel", "exact"],
  ["marathon petro", "fuel", "word"],
  ["marathon gas", "fuel", "word"],
  ["phillips 66", "fuel", "word"],
  ["76", "fuel", "exact"],
  ["conoco", "fuel", "word"],
  ["sunoco", "fuel", "word"],
  ["citgo", "fuel", "word"],
  ["sinclair", "fuel", "word"],
  ["arco", "fuel", "word"],
  ["speedway", "fuel", "word"],
  ["circle k", "fuel", "word"],
  ["quiktrip", "fuel", "word"],
  ["racetrac", "fuel", "word"],
  ["raceway", "fuel", "word"],
  ["wawa", "fuel", "word"],
  ["sheetz", "fuel", "word"],
  ["caseys", "fuel", "word"],
  ["loves", "fuel", "exact"],
  ["loves travel", "fuel", "word"],
  ["loves country", "fuel", "word"],
  ["pilot travel", "fuel", "word"],
  ["pilot flying j", "fuel", "word"],
  ["flying j", "fuel", "word"],
  ["murphy usa", "fuel", "word"],
  ["murphy express", "fuel", "word"],
  ["kum go", "fuel", "word"],
  ["kum and go", "fuel", "word"],
  ["maverik", "fuel", "word"],
  ["kwik trip", "fuel", "word"],
  ["kwik star", "fuel", "word"],
  ["costco gas", "fuel", "word"],
  ["sams club fuel", "fuel", "word"],
  ["buc ees", "fuel", "word"],
  ["bucees", "fuel", "word"],
  ["holiday stationstores", "fuel", "word"],
  ["fleetcor", "fuel", "word"],
  ["wex", "fuel", "word"],
];

// Money into a bank account from these is a payout or a transfer, never a refund (A10 step 4).
const PROCESSORS: readonly string[] = [
  "jobber", "square", "stripe", "intuit", "quickbooks", "qbooks", "paypal", "venmo", "zelle",
  "cash app", "cashapp", "square cash", "apple cash",
];

// Money sent through these goes to a person: payroll and contractors (A10 step 5).
const PAYMENT_APPS: readonly string[] = ["zelle", "venmo", "cash app", "cashapp", "square cash", "apple cash"];

interface Entry {
  tokens: readonly string[];
  exact: boolean;
  /** Position in its list, for the final tie-break. */
  order: number;
  row: Row | null;
}

// Entries grouped by their first word, so each text is scanned once per word.
type Index = ReadonlyMap<string, readonly Entry[]>;

function buildIndex(entries: Entry[]): Index {
  const index = new Map<string, Entry[]>();
  for (const e of entries) {
    const list = index.get(e.tokens[0]) ?? [];
    list.push(e);
    index.set(e.tokens[0], list);
  }
  return index;
}

const KNOWN_INDEX = buildIndex(
  KNOWN.map((row, order) => ({ tokens: row[0].split(" "), exact: row[2] === "exact", order, row })),
);
const wordEntries = (patterns: readonly string[]): Entry[] =>
  patterns.map((p, order) => ({ tokens: p.split(" "), exact: false, order, row: null }));
const PROCESSOR_INDEX = buildIndex(wordEntries(PROCESSORS));
const PAYMENT_APP_INDEX = buildIndex(wordEntries(PAYMENT_APPS));

function entryMatchesAt(e: Entry, tokens: readonly string[], i: number): boolean {
  if (e.exact && (i !== 0 || tokens.length !== e.tokens.length)) return false;
  if (i + e.tokens.length > tokens.length) return false;
  for (let k = 1; k < e.tokens.length; k++) if (tokens[i + k] !== e.tokens[k]) return false;
  return true;
}

// Longer patterns win (more words, then more letters), then the one listed first.
function better(a: Entry, b: Entry | null): boolean {
  if (!b) return true;
  if (a.tokens.length !== b.tokens.length) return a.tokens.length > b.tokens.length;
  const la = a.tokens.join(" ").length;
  const lb = b.tokens.join(" ").length;
  if (la !== lb) return la > lb;
  return a.order < b.order;
}

function bestMatch(index: Index, texts: MerchantTexts): Entry | null {
  let best: Entry | null = null;
  for (const text of texts) {
    if (!text) continue;
    const tokens = text.split(" ");
    for (let i = 0; i < tokens.length; i++) {
      for (const e of index.get(tokens[i]) ?? []) {
        if (entryMatchesAt(e, tokens, i) && better(e, best)) best = e;
      }
    }
  }
  return best;
}

/** The normalized merchant name, counterparty name and description key of a transaction. */
export function merchantTexts(txn: DescriptionFields, normalize: Normalizer = normalizeText): MerchantTexts {
  return [normalize(txn.merchant_name), normalize(txn.counterparty_name), descriptionKey(txn, normalize)];
}

/** The known merchant a transaction is with, or null. */
export function knownMerchant(texts: MerchantTexts): MerchantMatch | null {
  const e = bestMatch(KNOWN_INDEX, texts);
  if (!e?.row) return null;
  return { category: CATEGORY[e.row[1]], kind: e.row[1], pattern: e.row[0] };
}

/** A payment processor or payment app by name: money into a bank account from it is never a refund. */
export function isPaymentProcessor(texts: MerchantTexts): boolean {
  return bestMatch(PROCESSOR_INDEX, texts) !== null;
}

/** Zelle, Venmo, Cash App or Apple Cash by name: money sent through it counts as payroll and contractors. */
export function isPaymentAppPayee(texts: MerchantTexts): boolean {
  return bestMatch(PAYMENT_APP_INDEX, texts) !== null;
}

/** Every known-merchant pattern with its category (for tests and support). */
export const KNOWN_MERCHANT_PATTERNS: readonly { pattern: string; category: DefaultCategoryKey }[] =
  Object.freeze(KNOWN.map((row) => ({ pattern: row[0], category: CATEGORY[row[1]] })));
