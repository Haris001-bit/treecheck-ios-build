// Financial Pulse: sorts bank and card transactions into costs, refunds and "not counted".
//
// Pure functions only (no runtime-specific or network APIs), so the same file runs in the edge
// functions and in the vitest suite (src/lib/pulse/sorter.test.ts).
//
// Precedence for each transaction (A10 in Project Architecture.md):
// 0.  Account missing or not business: excluded (non_business_account).
// 0a. Pending: excluded (pending). Never counted, never a matching partner.
// 0b. Dated before the account's count-from date: excluded (before_count_from). Still a matching
//     partner for steps 2 and 3; its own result stays before_count_from.
// 1.  Owner or support rule. A rule matches by transaction_id (also through
//     pending_transaction_id, so a rule follows a pending row to its posted row), description_key,
//     merchant_entity_id or merchant_name. A rule is usable only when its key is not generic (an
//     empty key or a bare app or bank name never matches), it is general or scoped to the row's
//     account, and it is not an exclude_personal rule matched by entity id or merchant name on a
//     payment-app or transfer row (A10 "Personal or owner-draw keys": there a personal rule counts
//     only by transaction_id or description key, so a rule on the Zelle merchant name or its
//     entity id can never exclude every payout). Of the usable rules, the single best one wins, in
//     one total order: the narrowest key first (transaction_id, then description_key, then
//     merchant_entity_id and merchant_name as equal width); on equal width exclude_personal before
//     set_category; then a rule scoped to the account before a general one; then the lowest rule
//     id. So a support re-label on the Zelle entity id never overrides the owner's "personal" tap
//     on the payee's description key, and a set_category rule by transaction_id is never
//     overridden by a rule on a wider key (on the same transaction the app replaces the earlier
//     rule when the owner taps again). exclude_personal: excluded (personal). set_category: cost,
//     or refund for money in. A set_category rule matched by a wider key than transaction_id never turns money in into
//     a refund on its own: that row goes through steps 2 to 4 and the rule only names the category
//     if step 4 makes it a refund (so a rule on "Jobber" for the subscription can never turn a
//     Jobber payout into a negative cost).
// 2.  Own transfer: two different business depository accounts, equal and opposite to the cent,
//     within transfer_window_days, at least one side with a transfer signal. A transfer signal is
//     a TRANSFER_IN_* or TRANSFER_OUT_* code other than the payment-app codes
//     (TRANSFER_*_FROM_APPS) and the cash or check codes (TRANSFER_IN_DEPOSIT,
//     TRANSFER_OUT_WITHDRAWAL); or "transfer" / "xfer" (and the like: xfr, tfr, trnsfr) as a whole
//     word in a name, never "transfer station", "transferwise" or "balance transfer", and only on
//     a row whose Plaid code is missing or TRANSFER_* and that is not a known merchant (a dump fee
//     at "NORMAN RECYCLING AND TRANSFER CENTER" with a waste code, or a "WIRE TRANSFER FEE" with a
//     bank-fee code, is a cost, never a transfer).
//     * A payment-app row (Zelle, Venmo, Cash App, Apple Cash by name, or a payment-app code)
//       never pairs.
//     * A side named like a payment processor (PayPal, Square, Stripe, Jobber, Intuit, QuickBooks),
//       on an account whose subtype is "paypal" (a linked PayPal balance, whatever its rows are
//       named), or with counterparty type payment_app pairs only when both sides carry a transfer
//       signal: that covers a linked PayPal balance, Square Checking or QuickBooks Checking
//       account, and still rejects a payout against an ordinary cost. A payment_app counterparty
//       type on a row with no processor name, off a PayPal balance, never pairs.
//     * When only one side carries a signal, the other side must not be a spending row: no
//       Plaid code other than TRANSFER_* and no known merchant (a supplier cost, a dump fee or a
//       fuel stop is never the other half of a transfer).
// 3.  Card payment: a depository outflow and a card inflow, equal to the cent, within
//     card_payment_window_days. The card side's category code is never trusted for pairing. A
//     payment-app outflow (Zelle, Venmo, Cash App, Apple Cash, the payment-app code or counterparty
//     type payment_app) is never a card payment. A returned card payment pairs the other way
//     round: a card outflow with the card-payment code against an equal depository inflow with
//     that code or named like a return. Unmatched: a depository card-payment code, or a card
//     inflow that looks like a payment (and not like a refund), is excluded (card_payment) with
//     review. A bank row that step 5 would leave out as a loan payment pairs only with a card
//     credit that looks like a payment, and after every other bank row of its tier, so a loan
//     payment never takes a card payment's or a refund's place.
// 4.  Money in. On a card: a refund, whoever it is from (processors and payment apps never pay out
//     to a credit card, so a credit from them reverses a charge on that card); it uses up the
//     matching purchase on the same card, if any, and never a purchase on another account. On a
//     bank account: a refund only if it follows a counted outflow (on any business account) to
//     the same merchant within 90 days, is no larger than what is left of it, and is not from a
//     payment processor or app. Otherwise excluded (inflow): revenue comes from Jobber only.
// 5.  Money out, in this order: a loan payment, excluded (loan_payment) because paying back a loan
//     is not a cost (Joe Evans, 2026-10-06): a loan-payment code (any LOAN_PAYMENTS_* code other
//     than the card-payment one, which step 3 handles) on a row that did not move through a payment
//     app (by name, code or counterparty type), is not a known merchant other than software (an
//     equipment rental, fuel card or payroll bill is never a loan, whatever its code; a software
//     name can be a lender's, such as a QuickBooks loan) and does not say lease or leasing (Plaid's
//     car-payment code covers leases too, and a lease is a running cost); sent through Zelle, Venmo,
//     Cash App or Apple Cash by name
//     (payroll_contractors; the payee after the app name is a person, so "JOHN SHELL" is not a
//     fuel station); known merchants (merchantRules.ts); the payment-app code, or counterparty
//     type payment_app when the Plaid code is missing or TRANSFER_OUT_* (payroll_contractors). A
//     PayPal checkout that Plaid gave a spending code goes on to the category map.
// 6.  Plaid category map (pfcMap.ts). Review, on money out only (never on money in or $0): the
//     map's own flag (a TRANSFER_OUT_* code other than the payment-app one), or a depository row
//     with a transfer signal (whose Plaid code is then missing or TRANSFER_*, see step 2). Such a
//     row stays counted: it may be going to an account that is not linked.
// 7.  Otherwise: other.
//
// Invariant (tested): money out of a business account is excluded only by an exclude_personal rule,
// an own transfer, card-payment handling, a loan-payment code (step 5), or the pending, count-from
// and account guards. A payment-app row is never a loan payment, so a payout stays counted. In every
// own transfer, a side without a transfer signal is never a spending row, and neither side is a
// payment-app row.
//
// Pairing is greedy and independent of input order. Candidate pairs share an absolute amount
// (bucketed, so there is no all-against-all scan) and are ranked by signal strength first, then the
// smallest date gap, then the pair whose transaction ids sort first (lower id, then higher id).
// Rows that can never pair in a pass are left out of it before bucketing.
// Strength for own transfers: both sides with a transfer signal (0) before one side (1).
// Strength for card payments: the bank side's tier, then (within a tier) a bank side that is not a
// loan payment (step 5) first, then a card side that looks like a payment first; a loan payment
// pairs only with a card side that looks like a payment. Bank-side tiers: 0 the card-payment code; 1 card-payment wording, as whole
// words or phrases: "credit card", "crd", "card pmt", "card payment", "card services", "autopay"
// or "thank you" (never a bare "card": a debit-card purchase names its card too); 2 a bare
// "payment", "pmt" or "pymt" (bill pay reads like this, so it never outranks a real card
// payment); 3 plain; 4 a payment processor; payment apps never. A bank row whose Plaid code is a
// spending code (anything other than missing, TRANSFER_* or LOAN_PAYMENTS_*) never ranks above
// tier 2, so a bill named "autopay" never outranks a real card payment. Each transaction pairs at
// most once, and a pair needs at least one side that is not before its count-from date.
// Each row keeps only its best CANDIDATES_PER_ROW partners for the ranked pass (found nearest date
// first, stopping as soon as nothing further away can beat them); a row that filled that list and
// is still unpaired then takes its best free partner, rows in transaction id order. With fewer
// same-amount candidates than that inside one window (any real data) this is exactly the ranked
// greedy; with thousands of them it stays fast.
// Known limits (documented, not fixed):
// * Greedy, not maximum, matching: greedy can leave a pair unmatched that a maximum matching would
//   pair (out B on the 10th, out A on the 14th, in X on the 12th, in Y on the 18th: A takes X on
//   the id tie, B stays counted with review and Y is excluded). A maximum matching is
//   deliberately not used: it would trade strong or close pairs for weak ones to make an extra
//   pair, which hides real costs.
// * The overflow pass: in a pathological cluster where rows have more than CANDIDATES_PER_ROW
//   same-amount candidates inside one window, a weaker pair can take a strong row's partner
//   before that row's overflow pass runs, so the result can differ from the full ranked greedy
//   (fewer pairs, and a different cost total). Real data never has that many same-amount
//   candidates in one window, and the result is exact below it.
// * Worst-case time: a row stops scanning early only once it has seen enough partners at its best
//   possible strength. When none of its candidates reach that strength (for example transfer-named
//   outs against thousands of same-amount deposits with no signal, or plain bank outflows against
//   card credits that do not look like payments), the scan is quadratic within one amount and one
//   window: roughly 1 s at 8,000 same-amount rows inside one window and 5 to 9 s at 20,000 (Node,
//   measured in review round 2; sorter-3 measured the same against sorter-2 side by side). Rows
//   that can never pair are left out before bucketing, so a cluster of spending rows, payment-app
//   rows or plain deposits costs nothing in the passes they cannot join. Real data is far below
//   all of that.
// * Cash and check deposits stay possible partners (kept on purpose): a cash or check deposit
//   (TRANSFER_IN_DEPOSIT) or withdrawal (TRANSFER_OUT_WITHDRAWAL) carries no transfer signal but is
//   not a spending row either, so it can still be the unsignalled half of a transfer that carries
//   one (by code or by name). A check written on one of the owner's accounts and deposited into
//   another is a real own transfer. The cost: a transfer out to an account that is not linked,
//   followed within the window by a customer check or cash deposit of exactly the same amount, is
//   excluded as an own transfer and loses its review flag.
//
// Bump SORTER_VERSION whenever this file, pfcMap.ts (PFC_MAP_VERSION), merchantRules.ts
// (MERCHANT_RULES_VERSION) or normalize.ts changes a result, so stored rows get sorted again.

import {
  isPaymentAppPayee,
  isPaymentProcessor,
  knownMerchant,
  merchantTexts,
  type MerchantMatch,
  type MerchantTexts,
} from "./merchantRules.ts";
import { descriptionKey, isGenericKey, normalizeText, type Normalizer } from "./normalize.ts";
import { isCardPaymentPfc, isPaymentAppTransfer, isTransferPfc, pfcCategory, pfcKind, type PfcCategory } from "./pfcMap.ts";
import type {
  ClassifiedBy,
  Classification,
  ExcludeReason,
  SorterAccount,
  SorterRule,
  SorterSettings,
  SorterTxn,
} from "./types.ts";

export const SORTER_VERSION = "sorter-6";

/** How far back a refund on a bank account may look for the purchase it refunds. */
export const REFUND_LOOKBACK_DAYS = 90;

/** How many of its best partners each row keeps for the ranked pairing pass (see the header). */
export const CANDIDATES_PER_ROW = 16;

type AccountKind = "depository" | "credit" | "other";
type RuleKind = SorterRule["match_kind"];
type State = "guard" | "partner_only" | "live";

/** What a transaction's texts and codes say about it, worked out once per row. */
interface Traits {
  /** Normalized merchant name, counterparty name and description key (merchantRules.ts). */
  texts: MerchantTexts;
  /** The known merchant (merchantRules.ts), or null. */
  known: MerchantMatch | null;
  /** The category map's answer for the row's Plaid codes (pfcMap.ts). */
  pfc: PfcCategory;
  /** Zelle, Venmo, Cash App or Apple Cash by name. */
  appPayee: boolean;
  /** The payment-app code (TRANSFER_*_FROM_APPS). */
  appCode: boolean;
  /** Counterparty type payment_app. */
  appType: boolean;
  /** Money moved through a payment app: by name, by the payment-app code, or counterparty type payment_app. */
  app: boolean;
  /** A payment processor or payment app by name (Jobber, Square, Stripe, Intuit, PayPal, Zelle, ...). */
  processor: boolean;
  /** Processor-named, or on a PayPal balance account: the processor test for own transfers (step 2). */
  processorSide: boolean;
  /**
   * A transfer signal (see the header, step 2): the code, or the name as a whole word on a row
   * whose Plaid code is missing or TRANSFER_* and that is not a known merchant.
   */
  transfer: boolean;
  /** Any TRANSFER_IN_* or TRANSFER_OUT_* code, including the payment-app and cash or check ones. */
  transferCode: boolean;
  /** A Plaid code that is neither missing nor TRANSFER_*: Plaid read the row as spending (or income). */
  spendingCode: boolean;
  /** A LOAN_PAYMENTS_* code (the card-payment code among them). */
  loanCode: boolean;
  /** Plaid's credit card payment code. */
  cardCode: boolean;
  /** "lease" or "leasing" as a whole word in the name, merchant or counterparty. */
  lease: boolean;
  /** Left out as a loan payment when nothing pairs it (step 5): see the header. */
  loanPayment: boolean;
  /** A card inflow that looks like a payment toward the card (looksLikeCardPayment). */
  cardLook: boolean;
  /** Card-payment wording in the description (CARD_WORDS), never a bare "card". */
  cardName: boolean;
  /** A bare "payment", "pmt" or "pymt" in the description. */
  paymentName: boolean;
  /** A description that reads like a returned or reversed payment. */
  returnName: boolean;
}

interface Row {
  txn: SorterTxn;
  kind: AccountKind;
  accountId: string;
  /** On an account whose subtype is "paypal" (a linked PayPal balance). */
  paypal: boolean;
  cents: number;
  day: number;
  state: State;
  result: Classification | null;
  /** A set_category rule matched by a wider key on money in; it names the category if step 4 refunds. */
  deferredRule: SorterRule | null;
  paired: boolean;
  /** Position in transaction_id order, so pairs compare as numbers. */
  rank: number;
  /** Worked out on first use: the description key and the traits. */
  descKey: string | null;
  traits: Traits | null;
}

/** The optional fields of a Classification; everything left out is null (review: false). */
type Extra = Partial<
  Pick<Classification, "category_key" | "exclude_reason" | "matched_transaction_id" | "rule_id" | "review">
>;

const DAY_MS = 86_400_000;
const DEPOSITORY_SUBTYPES = new Set([
  "checking", "savings", "cash management", "money market", "cd", "hsa", "prepaid", "paypal",
]);
const PAYMENT_LOOKALIKE = /payment|thank\s*you|autopay|\bpymt\b|\bpmt\b/;
// Bank-side card-payment wording (tier 1), whole words or phrases only. Never a bare "card": a
// debit-card purchase ("PURCHASE AUTHORIZED ON 09/08 ... CARD 1234") names its card too.
const CARD_WORDS =
  /\bcredit\s*card\b|\bcrd\b|\bcard\s+(?:pmt|payment|services)\b|\bcard\b.*\b(?:payments?|pmt|pymt)\b|\b(?:payments?|pmt|pymt)\b.*\bcard\b|\bautopay\b|\bthank\s*you\b/;
// A bare payment word (tier 2): bill pay reads like this too.
const PAYMENT_WORDS = /payment|\bpymt\b|\bpmt\b/;
// Whole words that name a transfer, and the neighbours that make them something else.
const TRANSFER_WORDS = new Set(["transfer", "transfers", "transferred", "xfer", "xfers", "xferred", "xfr", "trnsfr", "tfr", "trf"]);
const NOT_TRANSFER_AFTER = new Set(["station", "stations", "stn", "sta"]); // a dump's transfer station
const NOT_TRANSFER_BEFORE = new Set(["balance", "bal"]); // a card balance transfer
// Cash or check deposits and withdrawals: money moved, but never between two of the owner's accounts.
const CASH_CODES = new Set(["TRANSFER_IN_DEPOSIT", "TRANSFER_OUT_WITHDRAWAL"]);
const REFUND_WORDS = /\b(?:refunds?|refunded|returns?|returned|reversal|reversed|rebate)\b/;
const RETURN_WORDS = /\b(?:returns?|returned|reversal|reversed|nsf)\b/;
const PAYMENT_PRIMARIES = ["LOAN_PAYMENTS", "TRANSFER_IN", "INCOME"];
const LOAN_PRIMARY = "LOAN_PAYMENTS";
const LEASE_WORDS = /\b(?:lease|leases|leasing)\b/;
// Rule keys, narrowest first (see RULE_WIDTH), so the search can stop once a wider key cannot win.
const RULE_KINDS: readonly RuleKind[] = ["transaction_id", "description_key", "merchant_entity_id", "merchant_name"];

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const collapse = (s: string | null | undefined) => lower(s).replace(/\s+/g, " ");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Earlier day first, then the smaller transaction id. An unreadable date sorts first, so the
// order stays total and never depends on the input order.
function byDayThenId(x: Row, y: Row): number {
  const dx = Number.isNaN(x.day) ? -Infinity : x.day;
  const dy = Number.isNaN(y.day) ? -Infinity : y.day;
  if (dx !== dy) return dx < dy ? -1 : 1;
  return cmp(x.txn.transaction_id, y.txn.transaction_id);
}

// Calendar day number of a YYYY-MM-DD date (NaN when unreadable, which never matches anything).
function dayNumber(date: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return Number.NaN;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

function accountKind(a: SorterAccount): AccountKind {
  const type = lower(a.type);
  if (type === "credit") return "credit";
  if (type === "depository") return "depository";
  if (type) return "other";
  const subtype = lower(a.subtype);
  if (subtype.includes("credit")) return "credit";
  return DEPOSITORY_SUBTYPES.has(subtype) ? "depository" : "other";
}

const nameText = (t: SorterTxn) => `${lower(t.name)} ${lower(t.merchant_name)}`;

// "transfer" or "xfer" (and the like) as a whole word in one text, never "transfer station",
// "transferwise" or "balance transfer".
function namesTransfer(raw: string | null | undefined): boolean {
  const words = lower(raw).split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (!TRANSFER_WORDS.has(words[i])) continue;
    if (NOT_TRANSFER_AFTER.has(words[i + 1] ?? "") || NOT_TRANSFER_BEFORE.has(words[i - 1] ?? "")) continue;
    return true;
  }
  return false;
}

// A card inflow that is really a payment toward the card (A10 step 3). By name only when it does
// not also read like a refund ("ACME PAYMENT SYSTEMS REFUND" is a refund). The card side's code
// only ever pushes a row towards "payment", never towards income or a refund.
function looksLikeCardPayment(t: SorterTxn): boolean {
  const text = nameText(t);
  if (PAYMENT_LOOKALIKE.test(text) && !REFUND_WORDS.test(text)) return true;
  const primary = (t.pfc_primary ?? "").trim().toUpperCase();
  const detailed = (t.pfc_detailed ?? "").trim().toUpperCase();
  return PAYMENT_PRIMARIES.some((p) => primary === p || detailed.startsWith(`${p}_`));
}

// `onPaypal`: the row is on a PayPal balance account (subtype "paypal").
function traitsFor(t: SorterTxn, normalize: Normalizer, onPaypal: boolean): Traits {
  const texts = merchantTexts(t, normalize);
  const appCode = isPaymentAppTransfer(t.pfc_primary, t.pfc_detailed);
  const appPayee = isPaymentAppPayee(texts);
  const appType = lower(t.counterparty_type) === "payment_app";
  const pfc = pfcCategory(t.pfc_primary, t.pfc_detailed);
  const transferCode = isTransferPfc(t.pfc_primary, t.pfc_detailed);
  const detailed = (t.pfc_detailed ?? "").trim().toUpperCase();
  const cashCode = CASH_CODES.has(detailed);
  const spendingCode = pfc.source !== "none" && !transferCode;
  const known = knownMerchant(texts);
  const processor = isPaymentProcessor(texts);
  const name = nameText(t);
  // A transfer word counts only when neither Plaid nor the merchant list reads the row as spending
  // (a dump's "TRANSFER CENTER" or a "WIRE TRANSFER FEE" is a cost). A processor-named row keeps its
  // transfer word even when the merchant list also knows the name as software (QuickBooks Checking,
  // Intuit): processor sides pair only when both sides carry a signal (S3).
  const namedTransfer =
    !spendingCode &&
    (known === null || processor) &&
    (namesTransfer(t.name) || namesTransfer(t.merchant_name) || namesTransfer(t.counterparty_name));
  const app = appPayee || appCode || appType;
  const loanCode = (t.pfc_primary ?? "").trim().toUpperCase() === LOAN_PRIMARY || detailed.startsWith(`${LOAN_PRIMARY}_`);
  const cardCode = isCardPaymentPfc(t.pfc_primary, t.pfc_detailed);
  const lease = LEASE_WORDS.test(`${name} ${lower(t.counterparty_name)}`);
  return {
    texts,
    known,
    pfc,
    appPayee,
    appCode,
    appType,
    app,
    processor,
    processorSide: processor || onPaypal,
    transfer: (transferCode && !appCode && !cashCode) || namedTransfer,
    transferCode,
    spendingCode,
    loanCode,
    cardCode,
    lease,
    loanPayment: loanCode && !cardCode && !app && !lease && (known === null || known.kind === "software"),
    cardLook: looksLikeCardPayment(t),
    cardName: CARD_WORDS.test(name),
    paymentName: PAYMENT_WORDS.test(name),
    returnName: RETURN_WORDS.test(name),
  };
}

// How strongly a bank outflow reads as a payment toward a card (0 strongest): 0 the card-payment
// code; 1 card-payment wording (CARD_WORDS); 2 a bare "payment", "pmt" or "pymt" (bill pay reads
// like this); 3 plain; 4 a payment processor; null never (a payment app: Zelle, Venmo and Cash App
// cannot pay a credit card, and such a row is usually a contractor payment). A row Plaid read as
// spending (any code but missing, TRANSFER_* or LOAN_PAYMENTS_*) is at best a bill: never above 2.
function bankSideTier(tr: Traits): number | null {
  if (tr.app) return null;
  if (tr.cardCode) return 0;
  if (tr.processor) return 4;
  const tier = tr.cardName ? 1 : tr.paymentName ? 2 : 3;
  return tr.spendingCode && !tr.loanCode ? Math.max(tier, 2) : tier;
}

// Whether a row can ever be one side of an own transfer. A payment-app row never can; a
// payment_app counterparty type counts as a processor when the row names one or sits on a PayPal
// balance, else never.
function ownTransferSide(tr: Traits): boolean {
  return !tr.appPayee && !tr.appCode && (!tr.appType || tr.processorSide);
}

// A row Plaid or the merchant list reads as spending: never the unsignalled half of a transfer.
const spendingRow = (tr: Traits): boolean => tr.spendingCode || tr.known !== null;

// Own-transfer strength of a pair of rows on two different business depository accounts: 0 both
// sides with a transfer signal, 1 one side (the other not a spending row and neither side a
// processor, a PayPal balance or a payment_app type), null never (see the header, step 2).
function ownTransferStrength(a: Traits, b: Traits): number | null {
  if (!ownTransferSide(a) || !ownTransferSide(b)) return null;
  if (a.transfer && b.transfer) return 0;
  if (!a.transfer && !b.transfer) return null;
  if (a.processorSide || b.processorSide || a.appType || b.appType) return null;
  return spendingRow(a.transfer ? b : a) ? null : 1;
}

// First position in a date-sorted list whose day is on or after `day`.
function firstOnOrAfter(list: readonly Row[], day: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].day < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

type RuleIndex = ReadonlyMap<RuleKind, ReadonlyMap<string, readonly SorterRule[]>>;

// The value a rule is looked up by; null when the rule can never match (empty or generic).
function ruleKey(rule: SorterRule): string | null {
  const value = (rule.match_value ?? "").trim();
  if (!value) return null;
  switch (rule.match_kind) {
    case "transaction_id":
    case "merchant_entity_id":
      return value;
    case "description_key": {
      // Stored keys come from descriptionKey; normalizing again leaves them as they are and lets a
      // key typed by support match too.
      const key = normalizeText(value);
      return isGenericKey(key) ? null : key;
    }
    case "merchant_name":
      return isGenericKey(normalizeText(value)) ? null : collapse(value);
    default:
      return null;
  }
}

// How many transactions a key can cover: a transaction id one, a description key one payee's
// description, an entity id or a merchant name every row with that merchant (equal width).
const RULE_WIDTH: Readonly<Record<RuleKind, number>> = {
  transaction_id: 0,
  description_key: 1,
  merchant_entity_id: 2,
  merchant_name: 2,
};

// Within one key width: exclude_personal first, then a rule scoped to an account, then the lowest id.
function ruleOrder(a: SorterRule, b: SorterRule): number {
  const ta = a.rule_type === "exclude_personal" ? 0 : 1;
  const tb = b.rule_type === "exclude_personal" ? 0 : 1;
  if (ta !== tb) return ta - tb;
  const sa = a.account_row_id ? 0 : 1;
  const sb = b.account_row_id ? 0 : 1;
  if (sa !== sb) return sa - sb;
  return cmp(a.id, b.id);
}

interface RuleHit {
  rule: SorterRule;
  kind: RuleKind;
}

// The one total order over usable rules (see the header, step 1): the narrowest key first, then
// ruleOrder.
const compareHits = (a: RuleHit, b: RuleHit): number => RULE_WIDTH[a.kind] - RULE_WIDTH[b.kind] || ruleOrder(a.rule, b.rule);

function buildRuleIndex(rules: readonly SorterRule[]): RuleIndex {
  const index = new Map<RuleKind, Map<string, SorterRule[]>>();
  for (const kind of RULE_KINDS) index.set(kind, new Map());
  for (const rule of rules) {
    const key = ruleKey(rule);
    const byKey = index.get(rule.match_kind);
    if (key === null || !byKey) continue;
    const list = byKey.get(key) ?? [];
    list.push(rule);
    byKey.set(key, list);
  }
  for (const byKey of index.values()) for (const list of byKey.values()) list.sort(ruleOrder);
  return index;
}

// The single best usable rule for a row, in the total order of compareHits. Each list is sorted
// by ruleOrder, so its first usable rule is its best one.
function findRule(
  index: RuleIndex,
  row: Row,
  keyOf: (row: Row) => string,
  isPayout: () => boolean,
): RuleHit | null {
  const t = row.txn;
  let best: RuleHit | null = null;
  for (const kind of RULE_KINDS) {
    if (best && RULE_WIDTH[kind] > RULE_WIDTH[best.kind]) break; // a wider key never wins
    const byKey = index.get(kind);
    if (!byKey || byKey.size === 0) continue;
    let lists: Array<readonly SorterRule[] | undefined> = [];
    if (kind === "transaction_id") {
      lists = [byKey.get(t.transaction_id), t.pending_transaction_id ? byKey.get(t.pending_transaction_id) : undefined];
    } else if (kind === "merchant_entity_id") {
      lists = t.merchant_entity_id ? [byKey.get(t.merchant_entity_id.trim())] : [];
    } else if (kind === "description_key") {
      const key = keyOf(row);
      lists = key ? [byKey.get(key)] : [];
    } else {
      const name = collapse(t.merchant_name);
      lists = name ? [byKey.get(name)] : [];
    }
    // On a payment-app or transfer row, a personal rule counts only by transaction_id or by the
    // description key (which keeps the payee), never by the app's merchant name or entity id.
    const wide = kind === "merchant_entity_id" || kind === "merchant_name";
    const usable = (r: SorterRule) =>
      (!r.account_row_id || r.account_row_id === row.accountId) &&
      !(wide && r.rule_type === "exclude_personal" && isPayout());
    for (const list of lists) {
      const rule = (list ?? []).find(usable);
      if (!rule) continue;
      const hit: RuleHit = { rule, kind };
      if (!best || compareHits(hit, best) < 0) best = hit;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Sorts every transaction. Returns one Classification per input transaction, in input order.
 * The same inputs in any order give the same result for each transaction_id (transaction ids are
 * unique, as in plaid_transactions). Never returns "unsorted".
 */
export function classifyAll(
  accounts: SorterAccount[],
  txns: SorterTxn[],
  rules: SorterRule[],
  settings: SorterSettings,
  categoryKeys?: readonly string[],
): Classification[] {
  const allowed = categoryKeys ? new Set(categoryKeys) : null;
  const category = (key: string | null): string => (key && (!allowed || allowed.has(key)) ? key : "other");

  const make = (row: Row, treatment: Classification["treatment"], by: ClassifiedBy, extra: Extra = {}): Classification => ({
    transaction_id: row.txn.transaction_id,
    treatment,
    category_key: extra.category_key ?? null,
    exclude_reason: extra.exclude_reason ?? null,
    matched_transaction_id: extra.matched_transaction_id ?? null,
    classified_by: by,
    rule_id: extra.rule_id ?? null,
    review: extra.review ?? false,
    sorter_version: SORTER_VERSION,
  });
  const exclude = (row: Row, reason: ExcludeReason, by: ClassifiedBy, extra: Extra = {}) =>
    make(row, "excluded", by, { ...extra, exclude_reason: reason });
  // Merchant names repeat, so each distinct text is normalized once per run.
  const memo = new Map<string, string>();
  const normalize: Normalizer = (raw) => {
    if (!raw) return "";
    let out = memo.get(raw);
    if (out === undefined) {
      out = normalizeText(raw);
      memo.set(raw, out);
    }
    return out;
  };
  const keyOf = (row: Row): string => {
    if (row.descKey === null) row.descKey = descriptionKey(row.txn, normalize);
    return row.descKey;
  };
  const traitsOf = (row: Row): Traits => {
    if (!row.traits) row.traits = traitsFor(row.txn, normalize, row.paypal);
    return row.traits;
  };

  // Steps 5 to 7: the category a counted row gets from its merchant or its Plaid code.
  const counted = (row: Row, treatment: "cost" | "refund"): Classification => {
    const t = row.txn;
    const tr = traitsOf(row);
    const cost = treatment === "cost";
    const payroll = () => make(row, treatment, "merchant_rule", { category_key: category("payroll_contractors") });
    if (cost && tr.appPayee) return payroll();
    if (tr.known) return make(row, treatment, "merchant_rule", { category_key: category(tr.known.category) });
    // The payment-app code, or counterparty type payment_app when Plaid did not read the row as a
    // purchase (a PayPal checkout with a spending code goes on to the category map).
    if (cost && tr.app) {
      const kind = pfcKind(t.pfc_primary, t.pfc_detailed);
      if (tr.appCode || kind === "unknown" || kind === "transfer_out") return payroll();
    }
    // Money out that may be going to an account that is not linked: counted, flagged for review.
    // Never on money in or $0. The signal-based flag only on a bank account; a row with a transfer
    // signal never has a spending code (step 2), so a dump fee at a transfer station is not flagged.
    const pfc = tr.pfc;
    const review = cost && row.cents > 0 && (pfc.review || (row.kind === "depository" && tr.transfer));
    if (pfc.source !== "none") {
      return make(row, treatment, "pfc", { category_key: category(pfc.category), review });
    }
    return make(row, treatment, "fallback", { category_key: category("other"), review });
  };

  // Step 0: accounts and guards.
  const accountById = new Map<string, SorterAccount>();
  for (const a of accounts) accountById.set(a.id, a);
  const rows: Row[] = txns.map((txn) => {
    const account = accountById.get(txn.account_row_id);
    const row: Row = {
      txn,
      kind: account ? accountKind(account) : "other",
      accountId: txn.account_row_id,
      paypal: lower(account?.subtype) === "paypal",
      cents: Math.round(Number(txn.amount) * 100),
      day: dayNumber(txn.txn_date),
      state: "live",
      result: null,
      deferredRule: null,
      paired: false,
      rank: 0,
      descKey: null,
      traits: null,
    };
    if (!account || !account.is_business) {
      row.state = "guard";
      row.result = exclude(row, "non_business_account", "guard");
    } else if (txn.pending) {
      row.state = "guard";
      row.result = exclude(row, "pending", "guard");
    } else if (account.include_from && row.day < dayNumber(account.include_from)) {
      row.state = "partner_only";
      row.result = exclude(row, "before_count_from", "guard");
    }
    return row;
  });
  const live = rows.filter((r) => r.state === "live");
  const byRank = [...rows].sort((x, y) => cmp(x.txn.transaction_id, y.txn.transaction_id));
  byRank.forEach((r, i) => {
    r.rank = i;
  });

  // Step 1: owner and support rules.
  const ruleIndex = buildRuleIndex(rules);
  for (const row of live) {
    // Payment-app and transfer rows, including cash or check deposits and withdrawals (a bank's
    // entity id or name on them says nothing about who got the money).
    const isPayout = () => {
      const tr = traitsOf(row);
      return tr.app || tr.transfer || tr.transferCode;
    };
    const hit = findRule(ruleIndex, row, keyOf, isPayout);
    if (!hit) continue;
    const { rule, kind } = hit;
    if (rule.rule_type === "exclude_personal") {
      row.result = exclude(row, "personal", "user_rule", { rule_id: rule.id });
    } else if (row.cents >= 0 || kind === "transaction_id") {
      row.result = make(row, row.cents < 0 ? "refund" : "cost", "user_rule", {
        category_key: category(rule.category_key),
        rule_id: rule.id,
      });
    } else {
      row.deferredRule = rule;
    }
  }

  // Steps 2 and 3: pairs. Partners are live rows not decided by a rule, and rows before count-from.
  const open = (r: Row) =>
    !r.paired &&
    Number.isFinite(r.day) &&
    Number.isFinite(r.cents) &&
    ((r.state === "live" && r.result === null) || r.state === "partner_only");
  const n = rows.length;
  const link = (p: Row, q: Row, reason: "own_transfer" | "card_payment") => {
    p.paired = true;
    q.paired = true;
    for (const [self, other] of [[p, q], [q, p]] as const) {
      if (self.state !== "live") continue; // a row before count-from keeps its own result
      self.result = exclude(self, reason, reason, { matched_transaction_id: other.txn.transaction_id });
    }
  };
  // Pairs money out (`outs`, positive) with money in (`ins`, negative) of the same size.
  // `rank.strength` is null for a pair that must never be made, else 0 (strongest) to 19;
  // `rank.floor` is the strongest (lowest) value any partner of that row could get.
  const pairUp = (
    outs: Row[],
    ins: Row[],
    windowDays: number,
    rank: { strength: (out: Row, inn: Row) => number | null; floor: (out: Row) => number },
    reason: "own_transfer" | "card_payment",
  ) => {
    // Windows are a few days; a year is the most that could ever make sense.
    const window = Math.min(366, Math.max(0, Math.floor(Number(windowDays) || 0)));
    // A pair's sort key packs (strength, date gap, lower id rank, higher id rank) into one exact
    // integer (below 2^53 for up to a million rows), so ordering candidate pairs is a plain
    // numeric sort. Any pair with strength >= s and gap >= g has a key of at least (s*span + g)*nn.
    const span = window + 1;
    const nn = n * n;
    const pairKey = (out: Row, inn: Row, s: number): number => {
      const gap = out.day > inn.day ? out.day - inn.day : inn.day - out.day;
      return out.rank < inn.rank
        ? (s * span + gap) * nn + out.rank * n + inn.rank
        : (s * span + gap) * nn + inn.rank * n + out.rank;
    };
    // Visits the free, acceptable partners of `out` one date gap at a time, nearest first (both
    // sides of its day). For one row, pairs with the same strength and gap rank by the partner's
    // id, and each day's rows are in id order, so once `perDay` partners at the row's floor
    // strength are seen on a day, the rest of that day cannot matter. Stops as soon as
    // `enough(bound)` says a partner at the next gap (whose key is at least `bound`) cannot matter.
    const scan = (
      out: Row,
      inList: readonly Row[],
      perDay: number,
      visit: (key: number, inn: Row) => void,
      enough: (bound: number) => boolean,
    ) => {
      const floor = rank.floor(out);
      const walk = (from: number, to: number) => {
        let strongest = 0;
        for (let j = from; j < to && strongest < perDay; j++) {
          const inn = inList[j];
          if (inn.paired || (out.state !== "live" && inn.state !== "live")) continue;
          const s = rank.strength(out, inn);
          if (s === null) continue;
          if (s <= floor) strongest++;
          visit(pairKey(out, inn, s), inn);
        }
      };
      let right = firstOnOrAfter(inList, out.day); // days from out.day on start here
      let left = right; // days before out.day end just before here
      for (;;) {
        const gapRight = right < inList.length ? inList[right].day - out.day : Infinity;
        const gapLeft = left > 0 ? out.day - inList[left - 1].day : Infinity;
        const gap = Math.min(gapRight, gapLeft);
        if (gap > window) return; // also when both sides are used up
        if (gapRight === gap) {
          const end = firstOnOrAfter(inList, out.day + gap + 1);
          walk(right, end);
          right = end;
        }
        if (gapLeft === gap) {
          const start = firstOnOrAfter(inList, out.day - gap);
          walk(start, left);
          left = start;
        }
        if (enough((floor * span + gap + 1) * nn)) return;
      }
    };
    const bucket = (list: Row[], amountOf: (r: Row) => number) => {
      const buckets = new Map<number, Row[]>();
      for (const r of list) {
        const key = amountOf(r);
        const b = buckets.get(key) ?? [];
        b.push(r);
        buckets.set(key, b);
      }
      return buckets;
    };
    const inBuckets = bucket(ins, (r) => -r.cents);
    const outBuckets = bucket(outs, (r) => r.cents);

    // Ranked pass: each row's best CANDIDATES_PER_ROW keys, all sorted together, taken greedily.
    const keys: number[] = [];
    const overflow: Array<{ out: Row; inList: Row[] }> = [];
    for (const [amount, outList] of outBuckets) {
      const inList = inBuckets.get(amount);
      if (!inList) continue;
      inList.sort(byDayThenId);
      for (const out of outList) {
        const best: number[] = []; // smallest first
        scan(
          out,
          inList,
          CANDIDATES_PER_ROW,
          (key) => {
            if (best.length === CANDIDATES_PER_ROW && key >= best[best.length - 1]) return;
            let i = best.length;
            if (i < CANDIDATES_PER_ROW) best.push(key);
            else i -= 1; // full: the worst one drops out
            while (i > 0 && best[i - 1] > key) {
              best[i] = best[i - 1];
              i--;
            }
            best[i] = key;
          },
          (bound) => best.length === CANDIDATES_PER_ROW && best[best.length - 1] < bound,
        );
        for (const key of best) keys.push(key);
        if (best.length === CANDIDATES_PER_ROW) overflow.push({ out, inList });
      }
    }
    for (const key of Float64Array.from(keys).sort()) {
      const hiRank = key % n;
      const q = byRank[hiRank];
      const p = byRank[((key - hiRank) / n) % n];
      if (p.paired || q.paired) continue;
      link(p, q, reason);
    }
    // Rows that may have had more partners than they kept and are still free: each takes its best
    // free partner, rows in transaction id order.
    overflow.sort((x, y) => x.out.rank - y.out.rank);
    for (const { out, inList } of overflow) {
      if (out.paired) continue;
      const found: { key: number; inn: Row | null } = { key: Infinity, inn: null };
      scan(
        out,
        inList,
        1,
        (key, inn) => {
          if (key < found.key) {
            found.key = key;
            found.inn = inn;
          }
        },
        (bound) => found.key < bound,
      );
      if (found.inn) link(out, found.inn, reason);
    }
  };

  // Step 2: own transfers between two business depository accounts (see the header). Strength 0
  // when both sides carry a transfer signal, 1 when one does. Rows that can never pair (a
  // payment-app row, or a row with no signal that is a spending row, a processor or on a PayPal
  // balance) are left out.
  const depository = rows.filter((r) => {
    if (r.kind !== "depository" || r.cents === 0 || !open(r)) return false;
    const tr = traitsOf(r);
    return ownTransferSide(tr) && (tr.transfer || (!tr.processorSide && !tr.appType && !spendingRow(tr)));
  });
  pairUp(
    depository.filter((r) => r.cents > 0),
    depository.filter((r) => r.cents < 0),
    settings.transfer_window_days,
    {
      strength: (out, inn) => (out.accountId === inn.accountId ? null : ownTransferStrength(traitsOf(out), traitsOf(inn))),
      floor: (out) => (traitsOf(out).transfer ? 0 : 1),
    },
    "own_transfer",
  );

  // Step 3: card payments (strength: the bank side's tier, then whether the card side looks like a
  // payment), then returned card payments, then the unmatched ones that still look like card
  // payments.
  pairUp(
    rows.filter((r) => r.kind === "depository" && r.cents > 0 && open(r) && bankSideTier(traitsOf(r)) !== null),
    rows.filter((r) => r.kind === "credit" && r.cents < 0 && open(r)),
    settings.card_payment_window_days,
    {
      strength: (bank, card) => {
        const tier = bankSideTier(traitsOf(bank));
        const loan = traitsOf(bank).loanPayment;
        const look = traitsOf(card).cardLook;
        return tier === null || (loan && !look) ? null : tier * 4 + (loan ? 2 : 0) + (look ? 0 : 1);
      },
      floor: (bank) => (bankSideTier(traitsOf(bank)) ?? 0) * 4 + (traitsOf(bank).loanPayment ? 2 : 0),
    },
    "card_payment",
  );
  const returnSide = (tr: Traits) => !tr.app && !tr.processor && (tr.cardCode || tr.returnName);
  pairUp(
    rows.filter((r) => r.kind === "credit" && r.cents > 0 && open(r) && traitsOf(r).cardCode),
    rows.filter((r) => r.kind === "depository" && r.cents < 0 && open(r) && returnSide(traitsOf(r))),
    settings.card_payment_window_days,
    {
      strength: (card, bank) => (returnSide(traitsOf(bank)) ? 0 : null),
      floor: () => 0,
    },
    "card_payment",
  );
  for (const row of live) {
    if (row.result) continue;
    const bankOut = row.kind === "depository" && row.cents > 0;
    const cardIn = row.kind === "credit" && row.cents < 0;
    if ((bankOut && traitsOf(row).cardCode) || (cardIn && traitsOf(row).cardLook)) {
      row.result = exclude(row, "card_payment", "card_payment", { review: true });
    }
  }

  // Steps 5 to 7 for money out (and zero amounts), before step 4 needs the counted outflows. A loan
  // payment first (step 5): left out, never through a payment app, never the card-payment code.
  for (const row of live) {
    if (row.result || row.cents < 0) continue;
    const tr = traitsOf(row);
    row.result = row.cents > 0 && tr.loanPayment
      ? exclude(row, "loan_payment", "pfc")
      : counted(row, "cost");
  }

  // Step 4: money in.
  const refund = (row: Row): Classification =>
    row.deferredRule
      ? make(row, "refund", "user_rule", { category_key: category(row.deferredRule.category_key), rule_id: row.deferredRule.id })
      : counted(row, "refund");

  // Counted outflows by merchant (entity id and normalized name), for matching refunds to purchases.
  // Each list is sorted by date, then by transaction id from the highest, so a backwards scan from
  // the refund's date meets the closest purchase first and, on one day, the smallest id first.
  // Only the 90 days before each refund are scanned, never the whole history.
  const merchantKeys = (t: SorterTxn): string[] => {
    const keys: string[] = [];
    const entity = (t.merchant_entity_id ?? "").trim();
    if (entity) keys.push(`e:${entity}`);
    const name = normalize(t.merchant_name);
    if (name) keys.push(`n:${name}`);
    return keys;
  };
  const outflowsByMerchant = new Map<string, Row[]>();
  const remaining = new Map<Row, number>();
  for (const row of rows) {
    if (row.cents <= 0 || !Number.isFinite(row.day) || row.result?.treatment !== "cost") continue;
    remaining.set(row, row.cents);
    for (const key of merchantKeys(row.txn)) {
      const list = outflowsByMerchant.get(key) ?? [];
      list.push(row);
      outflowsByMerchant.set(key, list);
    }
  }
  for (const list of outflowsByMerchant.values()) {
    list.sort((x, y) => x.day - y.day || cmp(y.txn.transaction_id, x.txn.transaction_id)); // days are finite here
  }

  // The closest earlier counted purchase at the same merchant with enough left to refund. A card
  // credit only ever reverses a charge on that same card, so on a card only its own purchases count.
  const findPurchase = (row: Row): Row | null => {
    const need = -row.cents;
    const sameAccount = row.kind === "credit";
    let best: Row | null = null;
    for (const key of merchantKeys(row.txn)) {
      const list = outflowsByMerchant.get(key);
      if (!list) continue;
      // Last purchase on or before the refund's date (binary search), then walk back 90 days.
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].day <= row.day) lo = mid + 1;
        else hi = mid;
      }
      for (let j = lo - 1; j >= 0 && list[j].day >= row.day - REFUND_LOOKBACK_DAYS; j--) {
        const out = list[j];
        if (sameAccount && out.accountId !== row.accountId) continue;
        if ((remaining.get(out) ?? 0) < need) continue;
        if (!best || out.day > best.day || (out.day === best.day && out.txn.transaction_id < best.txn.transaction_id)) {
          best = out;
        }
        break;
      }
    }
    return best;
  };
  // A refund uses up that much of the purchase it matched.
  const consume = (purchase: Row, row: Row) => remaining.set(purchase, (remaining.get(purchase) ?? 0) + row.cents);

  const inflows = live
    .filter((r) => !r.result && r.cents < 0)
    .sort(byDayThenId);
  // Card inflows first: they are refunds whatever they match, so they use up the purchases on their
  // own card before a bank inflow can claim the same purchase. They never touch a purchase on
  // another account, so a later card credit cannot take a checking purchase an earlier bank refund
  // was for.
  for (const row of inflows) {
    if (row.kind !== "credit") continue;
    const match = findPurchase(row);
    if (match) consume(match, row);
    row.result = refund(row);
  }
  for (const row of inflows) {
    if (row.kind === "credit") continue;
    const tr = traitsOf(row);
    const match = tr.processor || tr.app ? null : findPurchase(row);
    if (match) {
      consume(match, row);
      row.result = refund(row);
    } else {
      row.result = exclude(row, "inflow", "guard");
    }
  }

  // Every row has a result by now; the fallback only guards against a gap in the steps above.
  return rows.map((row) => row.result ?? make(row, "cost", "fallback", { category_key: category("other") }));
}
