// Financial Pulse: description keys, so one rule can match every payment to the same payee.
//
// Pure functions only (no runtime-specific or network APIs), so the same file runs in the edge
// functions and in the vitest suite (src/lib/pulse/normalize.test.ts).
//
// A description key (A10 "Personal or owner-draw keys") is Plaid's description (`name`, else the
// merchant name, else the counterparty name) with everything that changes from one payment to the
// next taken out:
// * card numbers and masks (xxxx1234, ****1234, "card ending in 1234");
// * reference and confirmation numbers (conf# 8XJ2K9QZ, ref 123, trace#: 0412, id:98765);
// * dates and times (09/28, 2026-09-28, 09-28-26, sep 28, 14:05);
// * store numbers (#0423, store 12) and any run of 3 or more digits;
// * codes that mix letters and digits (JPM99B4XYZ12);
// * punctuation, and bank boilerplate words (pos, purchase authorized on, debit card, ach, ppd).
// Words stay, so payment-app and transfer rows keep their payee: "Zelle payment to JOHN SMITH
// Conf# 8XJ2K9QZ" becomes "zelle payment to john smith".
//
// Generic keys (A10, D12): a key made only of words like zelle, venmo, cash app, transfer, atm,
// check, deposit, payment or withdrawal says nothing about who was paid, so a rule on it would catch
// every payout. Rules on generic keys apply to one transaction only: the app makes a transaction_id
// rule instead, and the sorter ignores description-key and merchant-name rules whose value is
// generic.

import type { SorterTxn } from "./types.ts";

/** The fields a description key is built from. */
export type DescriptionFields = Pick<SorterTxn, "name" | "merchant_name" | "counterparty_name">;

// Month names, so "sep 28" style dates can be taken out.
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

// Keywords whose value is a reference. After "#" or ":" the next token goes whatever it is;
// without one, only a next token that holds a digit goes.
const REF_ANY = "(?:confirmation|conf|reference|ref|trace|trn|txn|transaction|id)";
const REF_DIGIT = "(?:confirmation|conf|reference|ref|trace|trn|txn|transaction|trans|id|seq|authorization|auth|approval|invoice|inv|order)";

// Applied in this order to the lowercased text.
const CLEANUPS: readonly RegExp[] = [
  /\brecurring\s+(?:payment|pymt)\s+authorized\s+on\b/g,
  /\b(?:purchase\s+)?authorized\s+on\b/g,
  /\b(?:card\s+)?ending\s+in\s*[#:]?\s*\d+/g,
  new RegExp(`\\b${REF_ANY}(?![a-z])\\s*(?:number|num|no)?\\s*[#:]+\\s*[a-z0-9-]+`, "g"),
  new RegExp(`\\b${REF_DIGIT}(?![a-z])\\s*(?:number|num|no)?\\s*[a-z0-9-]*\\d[a-z0-9-]*`, "g"),
  /\b\d{4}-\d{1,2}-\d{1,2}\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g,
  new RegExp(`\\b${MONTH}(?![a-z])\\.?\\s*\\d{1,2}(?:\\s*,?\\s*\\d{4})?\\b`, "g"),
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?\b/g,
  /#\s*\d+/g,
  /\b(?:store|str|shop|loc|location|unit)\s*[#:]?\s*\d+\b/g,
];

// Bank boilerplate that says how a payment was made, never who was paid.
const BOILERPLATE = new Set([
  "pos", "purchase", "purch", "authorized", "debit", "dbt", "card", "checkcard", "chkcard", "visa",
  "mastercard", "recurring", "ach", "web", "ppd", "ccd", "tel", "des", "indn", "ind", "orig",
  "descr", "entry", "sec", "co", "name", "eff",
]);

function keepToken(token: string): boolean {
  if (!token || BOILERPLATE.has(token)) return false;
  if (/^x{2,}$/.test(token)) return false; // a card mask
  const digits = token.replace(/[^0-9]/g, "").length;
  if (digits === 0) return true;
  if (digits === token.length) return digits < 3; // 3+ digits: store, check or reference number
  return digits < 3 && token.length < 8; // a code mixing letters and digits
}

function cleanOnce(text: string): string {
  let s = text;
  for (const re of CLEANUPS) s = s.replace(re, " ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  return s.split(" ").filter(keepToken).join(" ");
}

/**
 * Lowercase ASCII words with the changing parts taken out (see the header). Idempotent:
 * normalizeText(normalizeText(x)) === normalizeText(x).
 */
export function normalizeText(raw: string | null | undefined): string {
  // Fold accents, then drop apostrophes and ampersands so "Lowe's" is "lowes" and "AT&T" is "att".
  let s = (raw ?? "").normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/['\u2019`&]/g, "");
  // Taking a word out can bring a keyword next to a number ("ref card 12"), so repeat until stable.
  // Every pass after the first either changes nothing or makes the text shorter, so this ends.
  for (let prev: string | null = null; s !== prev; ) {
    prev = s;
    s = cleanOnce(s);
  }
  return s;
}

/** A text normalizer: normalizeText, or a memoized copy of it (the sorter passes one per run). */
export type Normalizer = (raw: string | null | undefined) => string;

/** The description key for a transaction: its description, else merchant name, else counterparty name. */
export function descriptionKey(txn: DescriptionFields, normalize: Normalizer = normalizeText): string {
  for (const raw of [txn.name, txn.merchant_name, txn.counterparty_name]) {
    const key = normalize(raw);
    if (key) return key;
  }
  return "";
}

// Words that never identify a payee: payment apps, transfer and cash words, account words, fillers,
// and the bank names that appear in transfer descriptions.
const GENERIC_WORDS = new Set([
  // Payment apps
  "zelle", "venmo", "cash", "app", "cashapp", "paypal", "sq",
  // Transfers
  "transfer", "transfers", "transferred", "xfer", "trnsfr", "tfr", "trf", "trans", "transaction",
  // Cash, checks and deposits
  "atm", "withdrawal", "withdrawl", "withdraw", "wd", "wdl", "deposit", "deposits", "deposited",
  "dep", "check", "checks", "cheque", "chk", "ck", "draft", "mobile", "remote", "branch", "teller",
  "counter",
  // Payments
  "payment", "payments", "pmt", "pymt", "pay", "paid", "bill", "billpay", "autopay", "auto",
  // Movement and fillers
  "to", "from", "for", "the", "an", "of", "on", "and", "in", "at", "by", "via", "with", "sent",
  "send", "received", "receive", "recv", "request", "requested", "instant", "inst", "standard",
  "std", "internal", "external", "ext", "p2p", "person", "online", "internet", "banking", "bank",
  "electronic", "wire", "domestic", "international", "intl", "outgoing", "incoming", "out", "funds",
  "fund", "money", "ach", "debit", "credit", "new",
  // Accounts and references
  "account", "acct", "checking", "savings", "saving", "sav", "dda", "mmda", "share", "primary",
  "ref", "conf", "confirmation", "id", "number", "no", "memo",
  // Banks
  "chase", "jpm", "jpmorgan", "bofa", "boa", "wells", "fargo", "wf", "citi", "citibank", "usaa",
  "pnc", "td", "truist", "regions", "us", "usbank", "capital", "one",
]);

// Payment apps named in two words whose first word alone is a merchant ("square", "apple"): the
// pair counts as one generic word.
const GENERIC_PHRASES = /\b(?:square|apple)\s+cash\b/g;

/**
 * True when a key names no payee (A10, D12): it is empty, or it has a generic word and nothing else
 * but generic words, numbers and single letters ("zelle payment", "check 12", "zelle to j s",
 * "square cash"). A key that names someone ("zelle payment to john smith") or has no generic word
 * at all ("76", "square") is specific.
 */
export function isGenericKey(key: string): boolean {
  const tokens = key.toLowerCase().replace(GENERIC_PHRASES, "cash").split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const named = tokens.some((t) => !GENERIC_WORDS.has(t) && t.replace(/[^a-z]/g, "").length >= 2);
  return !named && tokens.some((t) => GENERIC_WORDS.has(t));
}
