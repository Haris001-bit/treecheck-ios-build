// Financial Pulse: shared types for the sorter and the calculation engine.
//
// Pure types only (no Deno or network APIs), so the edge functions and the vitest suite
// (src/lib/pulse/*.test.ts) use the same definitions. Values mirror the database checks in
// docs/pulse/sql/M2_pulse_core.sql.

// ---------------------------------------------------------------------------
// Sorter (A10 in Project Architecture.md)
// ---------------------------------------------------------------------------

export type Treatment = "cost" | "refund" | "excluded" | "unsorted";

export type ExcludeReason =
  | "card_payment"
  | "loan_payment"
  | "own_transfer"
  | "personal"
  | "before_count_from"
  | "inflow"
  | "non_business_account"
  | "pending";

export type ClassifiedBy =
  | "user_rule"
  | "own_transfer"
  | "card_payment"
  | "merchant_rule"
  | "pfc"
  | "fallback"
  | "guard";

/** The five default category keys (pulse_seed_categories). Companies may have others on request. */
export type DefaultCategoryKey =
  | "payroll_contractors"
  | "fuel_equipment"
  | "job_fees"
  | "operating"
  | "other";

export const DEFAULT_CATEGORY_KEYS: readonly DefaultCategoryKey[] = [
  "payroll_contractors",
  "fuel_equipment",
  "job_fees",
  "operating",
  "other",
];

/** A linked account, as stored in plaid_accounts (only the fields the sorter needs). */
export interface SorterAccount {
  /** plaid_accounts.id (the row id; transactions reference it as account_row_id). */
  id: string;
  /** Plaid account type: depository, credit, loan, investment, other. */
  type: string | null;
  /** Plaid subtype: checking, savings, credit card, cash management, money market, ... */
  subtype: string | null;
  is_business: boolean;
  /** Count-from date (YYYY-MM-DD). Rows dated before it are excluded but can still be matching partners. */
  include_from: string | null;
}

/** A transaction, as stored in plaid_transactions (raw Plaid fields only). */
export interface SorterTxn {
  transaction_id: string;
  account_row_id: string;
  pending: boolean;
  pending_transaction_id: string | null;
  /** Posted date (YYYY-MM-DD), Plaid's `date`. */
  txn_date: string;
  authorized_date: string | null;
  /** Plaid sign: positive = money out of the account, negative = money in. Same for every account type. */
  amount: number;
  name: string | null;
  merchant_name: string | null;
  merchant_entity_id: string | null;
  counterparty_name: string | null;
  counterparty_type: string | null;
  payment_channel: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  pfc_confidence: string | null;
}

/** An owner or support rule (pulse_rules, active rows only). */
export interface SorterRule {
  id: string;
  rule_type: "exclude_personal" | "set_category";
  match_kind: "transaction_id" | "merchant_entity_id" | "description_key" | "merchant_name";
  match_value: string;
  account_row_id: string | null;
  category_key: string | null;
}

export interface SorterSettings {
  card_payment_window_days: number;
  transfer_window_days: number;
}

/** What the sorter decides for one transaction (written back to plaid_transactions). */
export interface Classification {
  transaction_id: string;
  treatment: Treatment;
  category_key: string | null;
  exclude_reason: ExcludeReason | null;
  /** The other side of a matched own transfer or card payment. */
  matched_transaction_id: string | null;
  classified_by: ClassifiedBy;
  rule_id: string | null;
  /** Counted, but worth a look (e.g. a transfer out to an account that is not linked). Not stored; feeds warnings. */
  review: boolean;
  sorter_version: string;
}

// ---------------------------------------------------------------------------
// Calculation engine (A11)
// ---------------------------------------------------------------------------

/** One window as returned by the SQL function pulse_window_totals(owner, tz, windows). */
export interface WindowTotals {
  from: string;
  to: string;
  revenue: number;
  revenue_count: number;
  /** M6: the revenue basis these totals used ('payments', 'job_total' or 'invoiced_total'). */
  revenue_basis?: string;
  /** Posted costs net of refunds (refunds are negative amounts). */
  cost: number;
  cost_count: number;
  cost_by_category: Record<string, number>;
  excluded_by_reason: Record<string, { total: number; count: number }>;
  pending_outflow: number;
  /** M5: payments behind each category (posted costs and refunds). */
  cost_count_by_category?: Record<string, number>;
  /** M5: excluded money out (amount > 0) and money in (as a positive number), kept apart. */
  excluded_flow_by_reason?: Record<string, { out: number; out_count: number; in: number; in_count: number }>;
  /** M5: posted costs the sorter flagged for review (transfers to accounts that are not linked). */
  review_count?: number;
  review_total?: number;
}

/** A window to ask pulse_window_totals for. Dates are local to the company (YYYY-MM-DD, inclusive). */
export interface WindowSpec {
  key: string;
  from: string;
  to: string;
}
