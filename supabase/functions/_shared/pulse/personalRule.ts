// Financial Pulse: the rule behind the owner's "Personal, not business" button (A10 "Personal or
// owner-draw keys", plan task W2-04).
//
// Pure functions only (no runtime-specific or network APIs), so the same file runs in the edge
// function pulse-transaction-action, on the web (the dialog shows the label, through
// src/lib/pulse/api.ts) and in the vitest suite (src/lib/pulse/personalRule.test.ts).
//
// personalRuleFor(txn) picks the key for "Every charge from {label}", in this order:
// 1. the merchant's entity id (only when the row also has a merchant or counterparty name that
//    names someone, so a PayPal or bank entity id never catches every checkout);
// 2. the merchant name;
// 3. the description key (normalize.ts), which keeps the payee's name on payment-app and transfer
//    rows ("zelle payment to juan martinez").
// A key is used only if the sorter itself would use it on this row: every candidate is checked by
// running classifyAll on that one row with that one rule. So the sorter stays the single source of
// truth for keys, generic keys (D12) and the payment-app rule (a personal rule by entity id or
// merchant name never counts on a payment-app or transfer row), and a rule built here always
// matches the row it was built from. On a payment-app or transfer row that leaves the description
// key, as A10 asks.
// ATM, cash and check rows are always "just this one", even when the bank adds a location that
// makes the description key look specific: they have no payee.
// When no key is left, merchant is null and the owner can only mark "just this one".

import { classifyAll } from "./sorter.ts";
import { descriptionKey, isGenericKey, normalizeText } from "./normalize.ts";
import type { SorterAccount, SorterRule, SorterSettings, SorterTxn } from "./types.ts";

/** The keys an "every charge from ..." rule can use. */
export type PersonalRuleKind = "merchant_entity_id" | "merchant_name" | "description_key";

/** The rule for "Every charge from {label}". */
export interface PersonalMerchantKey {
  match_kind: PersonalRuleKind;
  match_value: string;
  /** A short human name for the merchant or payee ("Shell", "Juan Martinez via Zelle"). */
  label: string;
}

export interface PersonalRuleChoice {
  /** Null when only "just this one" is allowed (the key would be generic or empty). */
  merchant: PersonalMerchantKey | null;
}

/** The transaction fields the choice depends on; any other SorterTxn fields may be passed too. */
export type PersonalRuleTxn = Pick<
  SorterTxn,
  | "transaction_id"
  | "name"
  | "merchant_name"
  | "merchant_entity_id"
  | "counterparty_name"
  | "counterparty_type"
  | "pfc_primary"
  | "pfc_detailed"
> &
  Partial<SorterTxn>;

const LABEL_MAX = 40;
const CHECK_RULE_ID = "personal-rule-check";
const CHECK_ACCOUNT_ID = "personal-rule-account";
const CHECK_SETTINGS: SorterSettings = { card_payment_window_days: 0, transfer_window_days: 0 };
// Cash and check movements (Plaid codes), and the words that name them.
const CASH_CODES = new Set(["TRANSFER_IN_DEPOSIT", "TRANSFER_OUT_WITHDRAWAL"]);
const CASH_WORDS = new Set(["atm", "check", "checks", "cheque", "chk", "withdrawal", "withdrawl"]);
// Payment apps named in the description, for "{payee} via {app}". Longest names first.
const APPS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bapple cash\b/g, "Apple Cash"],
  [/\bsquare cash\b/g, "Cash App"],
  [/\bcash ?app\b/g, "Cash App"],
  [/\bzelle\b/g, "Zelle"],
  [/\bvenmo\b/g, "Venmo"],
  [/\bpaypal\b/g, "PayPal"],
];

const collapse = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// The row as the sorter sees it in step 1: posted, on a business account with no count-from date.
// Nothing else in step 1 depends on the account, the date or the amount.
function sorterRow(txn: PersonalRuleTxn): { account: SorterAccount; row: SorterTxn } {
  const accountId = txn.account_row_id || CHECK_ACCOUNT_ID;
  const amount = typeof txn.amount === "number" && Number.isFinite(txn.amount) ? txn.amount : 1;
  return {
    account: { id: accountId, type: "depository", subtype: "checking", is_business: true, include_from: null },
    row: {
      pending_transaction_id: null,
      authorized_date: null,
      payment_channel: null,
      pfc_confidence: null,
      ...txn,
      account_row_id: accountId,
      pending: false,
      txn_date: "2026-01-01",
      amount,
    },
  };
}

/**
 * The ids of the exclude_personal rules that would exclude this transaction as personal, best
 * first in the sorter's own order (other rule types are ignored). Each rule's account scope counts:
 * a rule scoped to another account never matches.
 */
export function personalRulesMatching(txn: PersonalRuleTxn, rules: readonly SorterRule[]): string[] {
  const { account, row } = sorterRow(txn);
  let left = rules.filter((r) => r.rule_type === "exclude_personal");
  const out: string[] = [];
  while (left.length > 0) {
    const [result] = classifyAll([account], [row], left, CHECK_SETTINGS);
    const id = result?.exclude_reason === "personal" ? result.rule_id : null;
    if (!id) break;
    out.push(id);
    const next = left.filter((r) => r.id !== id);
    if (next.length === left.length) break;
    left = next;
  }
  return out;
}

const titleCase = (words: readonly string[]) => words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function shorten(text: string): string {
  if (text.length <= LABEL_MAX) return text;
  const cut = text.slice(0, LABEL_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

// A label from normalized words: the payment app taken out and named at the end, and the generic
// words at either end dropped ("zelle payment to juan martinez" -> "Juan Martinez via Zelle").
// Null when nothing that names someone is left.
function labelFromKey(key: string): string | null {
  let text = key;
  let app: string | null = null;
  for (const [re, name] of APPS) {
    if (text.match(re)) {
      app = app ?? name;
      text = text.replace(re, " ");
    }
  }
  const tokens = text.split(" ").filter(Boolean);
  let start = 0;
  let end = tokens.length;
  while (start < end && isGenericKey(tokens[start])) start++;
  while (end > start && isGenericKey(tokens[end - 1])) end--;
  const words = tokens.slice(start, end);
  if (!words.some((w) => /[a-z]{2,}/.test(w))) return null;
  const payee = shorten(titleCase(words));
  return app ? `${payee} via ${app}` : payee;
}

// A merchant or counterparty name as the owner would say it. Null when it names no one (empty or
// generic). Plaid's clean names are kept as written ("QT", "Lowe's"); a name that still carries a
// number or code is rebuilt from its normalized words.
function displayName(raw: string | null | undefined): string | null {
  const normalized = normalizeText(raw);
  if (!normalized || isGenericKey(normalized)) return null;
  const written = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!/\d{3,}|[#*]/.test(written)) return shorten(written);
  return labelFromKey(normalized);
}

// An ATM, cash or check row: never a merchant.
function isCashOrCheck(txn: PersonalRuleTxn, key: string): boolean {
  if (CASH_CODES.has((txn.pfc_detailed ?? "").trim().toUpperCase())) return true;
  const words = [...key.split(" "), ...normalizeText(txn.merchant_name).split(" ")];
  return words.some((w) => CASH_WORDS.has(w));
}

function candidates(txn: PersonalRuleTxn, key: string): PersonalMerchantKey[] {
  const out: PersonalMerchantKey[] = [];
  const entity = (txn.merchant_entity_id ?? "").trim();
  const entityLabel = displayName(txn.merchant_name) ?? displayName(txn.counterparty_name);
  if (entity && entityLabel) out.push({ match_kind: "merchant_entity_id", match_value: entity, label: entityLabel });
  const merchant = collapse(txn.merchant_name);
  const merchantLabel = displayName(txn.merchant_name);
  if (merchant && merchantLabel) out.push({ match_kind: "merchant_name", match_value: merchant, label: merchantLabel });
  const keyLabel = key ? labelFromKey(key) : null;
  if (key && keyLabel) out.push({ match_kind: "description_key", match_value: key, label: keyLabel });
  return out;
}

/**
 * The "every charge from ..." rule for a transaction, or merchant: null when only "just this one"
 * is allowed. A returned key is always one the sorter matches this transaction by.
 */
export function personalRuleFor(txn: PersonalRuleTxn): PersonalRuleChoice {
  const key = descriptionKey(txn);
  if (isCashOrCheck(txn, key)) return { merchant: null };
  for (const candidate of candidates(txn, key)) {
    const rule: SorterRule = {
      id: CHECK_RULE_ID,
      rule_type: "exclude_personal",
      match_kind: candidate.match_kind,
      match_value: candidate.match_value,
      account_row_id: null,
      category_key: null,
    };
    if (personalRulesMatching(txn, [rule]).length === 1) return { merchant: candidate };
  }
  return { merchant: null };
}
