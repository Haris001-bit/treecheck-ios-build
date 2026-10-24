// Financial Pulse: Plaid's personal finance categories (PFC) mapped to the default cost categories.
//
// Pure data and functions only (no runtime-specific or network APIs), so the same file runs in
// the edge functions and in the vitest suite (src/lib/pulse/pfcMap.test.ts).
//
// Source: Plaid's PFC taxonomy, version 2 (the version the link token and /transactions/sync ask for).
// * CSV: https://plaid.com/documents/pfc-taxonomy-all.csv (columns "PFCv2 Primary" and "PFCv2 Detailed").
// * Linked as the taxonomy from https://plaid.com/docs/api/products/transactions/ and
//   https://plaid.com/docs/transactions/pfc-migration/ (PFCv2 released December 2025).
// * Read on 2026-09-29: 18 primary and 127 detailed codes, copied below in the CSV's order
//   (file SHA-256 c585fae8e48b834f78791c13c1fd013ae8594df337cf27f4de85bf9cae89f1bc).
// * Three v1 codes were renamed in v2 (INCOME_WAGES, INCOME_OTHER_INCOME,
//   TRANSFER_IN_CASH_ADVANCES_AND_LOANS). They are not in the table and fall back to their primary,
//   which gives the same answer.
// When Plaid adds or changes a code: update the table, bump PFC_MAP_VERSION and rerun the tests.
//
// Mapping (A10 in Project Architecture.md, "PFC mapping corrections"):
// * payroll_contractors: only money sent out through payment apps (TRANSFER_OUT_TRANSFER_OUT_FROM_APPS).
//   The sorter also sends counterparty type payment_app and payroll-provider merchants there.
// * Generic transfers out (account transfer, wire, savings, withdrawal and the like) stay counted as
//   "other" with a review flag, because they may be going to an account that is not linked.
// * fuel_equipment: TRANSPORTATION_*, GENERAL_SERVICES_AUTOMOTIVE, HOME_IMPROVEMENT_*,
//   LOAN_PAYMENTS_CAR_PAYMENT.
// * job_fees: waste disposal (dump fees) and government departments (permits, licenses).
// * operating: the other GENERAL_SERVICES_*, the other RENT_AND_UTILITIES_*, BANK_FEES_*, office
//   supplies, electronics, online marketplaces and tax payments. Software has no PFC code of its own;
//   the sorter's merchant rules handle it.
// * Everything else: other.
// The category only matters for money going out. Card payments and money coming in are flagged
// separately so the sorter can handle them first (A10 steps 3 and 4).

import type { DefaultCategoryKey } from "./types.ts";

/** The taxonomy version the table was copied from (personal_finance_category_version). */
export const PFC_TAXONOMY_VERSION = "v2";

/** Bump whenever a code's category or flags change, so stored rows get sorted again. */
export const PFC_MAP_VERSION = "pfc-map-1";

/** Plaid's detailed code for a payment to a credit card. The sorter excludes these (A10 step 3). */
export const CARD_PAYMENT_PFC = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

/**
 * What a code says about the direction of the money, before any category applies:
 * * inflow: money in by nature (INCOME_*, TRANSFER_IN_*, LOAN_DISBURSEMENTS_*);
 * * card_payment: a payment to a credit card;
 * * transfer_out: TRANSFER_OUT_* (counted unless the sorter pairs it with an own account);
 * * spend: everything else;
 * * unknown: no usable code.
 */
export type PfcKind = "inflow" | "card_payment" | "transfer_out" | "spend" | "unknown";

export interface PfcCategory {
  category: DefaultCategoryKey;
  /** Counted, but worth a look (a transfer out that may be going to an unlinked account). */
  review: boolean;
  /** Which code decided: the detailed one, the primary one, or neither (fallback to "other"). */
  source: "detailed" | "primary" | "none";
}

type Row = readonly [primary: string, detailed: string, category: DefaultCategoryKey, review: boolean];

// Every v2 detailed code with its primary, its default category and its review flag.
const TABLE: readonly Row[] = [
  // INCOME
  ["INCOME", "INCOME_CHILD_SUPPORT", "other", false],
  ["INCOME", "INCOME_CONTRACTOR", "other", false],
  ["INCOME", "INCOME_DIVIDENDS", "other", false],
  ["INCOME", "INCOME_GIG_ECONOMY", "other", false],
  ["INCOME", "INCOME_INTEREST_EARNED", "other", false],
  ["INCOME", "INCOME_LONG_TERM_DISABILITY", "other", false],
  ["INCOME", "INCOME_MILITARY", "other", false],
  ["INCOME", "INCOME_RENTAL", "other", false],
  ["INCOME", "INCOME_RETIREMENT_PENSION", "other", false],
  ["INCOME", "INCOME_SALARY", "other", false],
  ["INCOME", "INCOME_TAX_REFUND", "other", false],
  ["INCOME", "INCOME_UNEMPLOYMENT", "other", false],
  ["INCOME", "INCOME_OTHER", "other", false],
  // LOAN_DISBURSEMENTS
  ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_AUTO", "other", false],
  ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_CASH_ADVANCES", "other", false],
  ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_EWA", "other", false],
  ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_MORTGAGE", "other", false],
  ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_PERSONAL", "other", false],
  ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_STUDENT", "other", false],
  ["LOAN_DISBURSEMENTS", "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT", "other", false],
  // LOAN_PAYMENTS
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_BNPL", "other", false],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CAR_PAYMENT", "fuel_equipment", false],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CASH_ADVANCES", "other", false],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "other", false],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_EWA", "other", false],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT", "other", false],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", "other", false],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", "other", false],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_OTHER_PAYMENT", "other", false],
  // TRANSFER_IN
  ["TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER", "other", false],
  ["TRANSFER_IN", "TRANSFER_IN_DEPOSIT", "other", false],
  ["TRANSFER_IN", "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS", "other", false],
  ["TRANSFER_IN", "TRANSFER_IN_SAVINGS", "other", false],
  ["TRANSFER_IN", "TRANSFER_IN_TRANSFER_IN_FROM_APPS", "other", false],
  ["TRANSFER_IN", "TRANSFER_IN_WIRE", "other", false],
  ["TRANSFER_IN", "TRANSFER_IN_OTHER_TRANSFER_IN", "other", false],
  // TRANSFER_OUT
  ["TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER", "other", true],
  ["TRANSFER_OUT", "TRANSFER_OUT_CRYPTO", "other", true],
  ["TRANSFER_OUT", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", "other", true],
  ["TRANSFER_OUT", "TRANSFER_OUT_SAVINGS", "other", true],
  ["TRANSFER_OUT", "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS", "payroll_contractors", false],
  ["TRANSFER_OUT", "TRANSFER_OUT_WIRE", "other", true],
  ["TRANSFER_OUT", "TRANSFER_OUT_WITHDRAWAL", "other", true],
  ["TRANSFER_OUT", "TRANSFER_OUT_OTHER_TRANSFER_OUT", "other", true],
  // BANK_FEES
  ["BANK_FEES", "BANK_FEES_ATM_FEES", "operating", false],
  ["BANK_FEES", "BANK_FEES_INSUFFICIENT_FUNDS", "operating", false],
  ["BANK_FEES", "BANK_FEES_INTEREST_CHARGE", "operating", false],
  ["BANK_FEES", "BANK_FEES_FOREIGN_TRANSACTION_FEES", "operating", false],
  ["BANK_FEES", "BANK_FEES_OVERDRAFT_FEES", "operating", false],
  ["BANK_FEES", "BANK_FEES_LATE_FEES", "operating", false],
  ["BANK_FEES", "BANK_FEES_CASH_ADVANCE", "operating", false],
  ["BANK_FEES", "BANK_FEES_OTHER_BANK_FEES", "operating", false],
  // ENTERTAINMENT
  ["ENTERTAINMENT", "ENTERTAINMENT_CASINOS_AND_GAMBLING", "other", false],
  ["ENTERTAINMENT", "ENTERTAINMENT_MUSIC_AND_AUDIO", "other", false],
  ["ENTERTAINMENT", "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS", "other", false],
  ["ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES", "other", false],
  ["ENTERTAINMENT", "ENTERTAINMENT_VIDEO_GAMES", "other", false],
  ["ENTERTAINMENT", "ENTERTAINMENT_OTHER_ENTERTAINMENT", "other", false],
  // FOOD_AND_DRINK
  ["FOOD_AND_DRINK", "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR", "other", false],
  ["FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", "other", false],
  ["FOOD_AND_DRINK", "FOOD_AND_DRINK_FAST_FOOD", "other", false],
  ["FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "other", false],
  ["FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT", "other", false],
  ["FOOD_AND_DRINK", "FOOD_AND_DRINK_VENDING_MACHINES", "other", false],
  ["FOOD_AND_DRINK", "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK", "other", false],
  // GENERAL_MERCHANDISE
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_CONVENIENCE_STORES", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_DEPARTMENT_STORES", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_DISCOUNT_STORES", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ELECTRONICS", "operating", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_OFFICE_SUPPLIES", "operating", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES", "operating", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_PET_SUPPLIES", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SPORTING_GOODS", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SUPERSTORES", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_TOBACCO_AND_VAPE", "other", false],
  ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE", "other", false],
  // HOME_IMPROVEMENT
  ["HOME_IMPROVEMENT", "HOME_IMPROVEMENT_FURNITURE", "fuel_equipment", false],
  ["HOME_IMPROVEMENT", "HOME_IMPROVEMENT_HARDWARE", "fuel_equipment", false],
  ["HOME_IMPROVEMENT", "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE", "fuel_equipment", false],
  ["HOME_IMPROVEMENT", "HOME_IMPROVEMENT_SECURITY", "fuel_equipment", false],
  ["HOME_IMPROVEMENT", "HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT", "fuel_equipment", false],
  // MEDICAL
  ["MEDICAL", "MEDICAL_DENTAL_CARE", "other", false],
  ["MEDICAL", "MEDICAL_EYE_CARE", "other", false],
  ["MEDICAL", "MEDICAL_NURSING_CARE", "other", false],
  ["MEDICAL", "MEDICAL_PHARMACIES_AND_SUPPLEMENTS", "other", false],
  ["MEDICAL", "MEDICAL_PRIMARY_CARE", "other", false],
  ["MEDICAL", "MEDICAL_VETERINARY_SERVICES", "other", false],
  ["MEDICAL", "MEDICAL_OTHER_MEDICAL", "other", false],
  // PERSONAL_CARE
  ["PERSONAL_CARE", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", "other", false],
  ["PERSONAL_CARE", "PERSONAL_CARE_HAIR_AND_BEAUTY", "other", false],
  ["PERSONAL_CARE", "PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING", "other", false],
  ["PERSONAL_CARE", "PERSONAL_CARE_OTHER_PERSONAL_CARE", "other", false],
  // GENERAL_SERVICES
  ["GENERAL_SERVICES", "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING", "operating", false],
  ["GENERAL_SERVICES", "GENERAL_SERVICES_AUTOMOTIVE", "fuel_equipment", false],
  ["GENERAL_SERVICES", "GENERAL_SERVICES_CHILDCARE", "operating", false],
  ["GENERAL_SERVICES", "GENERAL_SERVICES_CONSULTING_AND_LEGAL", "operating", false],
  ["GENERAL_SERVICES", "GENERAL_SERVICES_EDUCATION", "operating", false],
  ["GENERAL_SERVICES", "GENERAL_SERVICES_INSURANCE", "operating", false],
  ["GENERAL_SERVICES", "GENERAL_SERVICES_POSTAGE_AND_SHIPPING", "operating", false],
  ["GENERAL_SERVICES", "GENERAL_SERVICES_STORAGE", "operating", false],
  ["GENERAL_SERVICES", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", "operating", false],
  // GOVERNMENT_AND_NON_PROFIT
  ["GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_DONATIONS", "other", false],
  ["GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES", "job_fees", false],
  ["GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", "operating", false],
  ["GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT", "other", false],
  // TRANSPORTATION
  ["TRANSPORTATION", "TRANSPORTATION_BIKES_AND_SCOOTERS", "fuel_equipment", false],
  ["TRANSPORTATION", "TRANSPORTATION_GAS", "fuel_equipment", false],
  ["TRANSPORTATION", "TRANSPORTATION_PARKING", "fuel_equipment", false],
  ["TRANSPORTATION", "TRANSPORTATION_PUBLIC_TRANSIT", "fuel_equipment", false],
  ["TRANSPORTATION", "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", "fuel_equipment", false],
  ["TRANSPORTATION", "TRANSPORTATION_TOLLS", "fuel_equipment", false],
  ["TRANSPORTATION", "TRANSPORTATION_OTHER_TRANSPORTATION", "fuel_equipment", false],
  // TRAVEL
  ["TRAVEL", "TRAVEL_FLIGHTS", "other", false],
  ["TRAVEL", "TRAVEL_LODGING", "other", false],
  ["TRAVEL", "TRAVEL_RENTAL_CARS", "other", false],
  ["TRAVEL", "TRAVEL_OTHER_TRAVEL", "other", false],
  // RENT_AND_UTILITIES
  ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", "operating", false],
  ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_INTERNET_AND_CABLE", "operating", false],
  ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT", "operating", false],
  ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT", "job_fees", false],
  ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_TELEPHONE", "operating", false],
  ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_WATER", "operating", false],
  ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_OTHER_UTILITIES", "operating", false],
  // OTHER
  ["OTHER", "OTHER_OTHER", "other", false],
];

// Used when the detailed code is missing or newer than this table.
interface Fallback {
  category: DefaultCategoryKey;
  review: boolean;
}

const PRIMARY_FALLBACK: ReadonlyMap<string, Fallback> = new Map<string, Fallback>([
  ["INCOME", { category: "other", review: false }],
  ["LOAN_DISBURSEMENTS", { category: "other", review: false }],
  ["LOAN_PAYMENTS", { category: "other", review: false }],
  ["TRANSFER_IN", { category: "other", review: false }],
  ["TRANSFER_OUT", { category: "other", review: true }],
  ["BANK_FEES", { category: "operating", review: false }],
  ["ENTERTAINMENT", { category: "other", review: false }],
  ["FOOD_AND_DRINK", { category: "other", review: false }],
  ["GENERAL_MERCHANDISE", { category: "other", review: false }],
  ["HOME_IMPROVEMENT", { category: "fuel_equipment", review: false }],
  ["MEDICAL", { category: "other", review: false }],
  ["PERSONAL_CARE", { category: "other", review: false }],
  ["GENERAL_SERVICES", { category: "operating", review: false }],
  ["GOVERNMENT_AND_NON_PROFIT", { category: "other", review: false }],
  ["TRANSPORTATION", { category: "fuel_equipment", review: false }],
  ["TRAVEL", { category: "other", review: false }],
  ["RENT_AND_UTILITIES", { category: "operating", review: false }],
  ["OTHER", { category: "other", review: false }],
]);

const BY_DETAILED: ReadonlyMap<string, Row> = new Map<string, Row>(
  TABLE.map((row): [string, Row] => [row[1], row]),
);

/** Every v2 detailed code, in the order of Plaid's CSV. */
export const PFC_DETAILED_CODES: readonly string[] = Object.freeze(TABLE.map((row) => row[1]));

/** Every v2 primary code, in the order of Plaid's CSV. */
export const PFC_PRIMARY_CODES: readonly string[] = Object.freeze([...PRIMARY_FALLBACK.keys()]);

const INFLOW_PRIMARIES = new Set(["INCOME", "TRANSFER_IN", "LOAN_DISBURSEMENTS"]);
const TRANSFER_PRIMARIES = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);
const PAYMENT_APP_CODES = new Set([
  "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS",
  "TRANSFER_IN_TRANSFER_IN_FROM_APPS",
]);

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** The known primary a detailed code starts with (longest match), for a code newer than the table. */
function primaryPrefix(detailed: string): string | null {
  let best: string | null = null;
  for (const p of PRIMARY_FALLBACK.keys()) {
    if (detailed.startsWith(`${p}_`) && (best === null || p.length > best.length)) best = p;
  }
  return best;
}

interface Resolved {
  /** The table row when the detailed code is known. */
  row: Row | null;
  /** The primary that applies: the row's own, else the given one, else the detailed code's prefix. */
  primary: string | null;
}

// Detailed code first; then the primary as given; then the primary the detailed code starts with.
function resolve(primary: string | null | undefined, detailed: string | null | undefined): Resolved {
  const d = norm(detailed);
  const row = BY_DETAILED.get(d) ?? null;
  if (row) return { row, primary: row[0] };
  const p = norm(primary);
  if (PRIMARY_FALLBACK.has(p)) return { row: null, primary: p };
  return { row: null, primary: d ? primaryPrefix(d) : null };
}

/** The default category for a transaction's PFC codes: detailed first, then primary, else "other". */
export function pfcCategory(primary: string | null, detailed: string | null): PfcCategory {
  const r = resolve(primary, detailed);
  if (r.row) return { category: r.row[2], review: r.row[3], source: "detailed" };
  const fallback = r.primary ? PRIMARY_FALLBACK.get(r.primary) : undefined;
  if (fallback) return { category: fallback.category, review: fallback.review, source: "primary" };
  return { category: "other", review: false, source: "none" };
}

/** What the codes say about the direction of the money (see PfcKind). */
export function pfcKind(primary: string | null, detailed: string | null): PfcKind {
  const r = resolve(primary, detailed);
  if (r.row?.[1] === CARD_PAYMENT_PFC) return "card_payment";
  if (!r.primary) return "unknown";
  if (INFLOW_PRIMARIES.has(r.primary)) return "inflow";
  if (r.primary === "TRANSFER_OUT") return "transfer_out";
  return "spend";
}

/** A payment to a credit card. Needs the detailed code; the primary alone cannot tell. */
export function isCardPaymentPfc(primary: string | null, detailed: string | null): boolean {
  return pfcKind(primary, detailed) === "card_payment";
}

/** Money in by nature: INCOME_*, TRANSFER_IN_* or LOAN_DISBURSEMENTS_*. */
export function isInflowPfc(primary: string | null, detailed: string | null): boolean {
  return pfcKind(primary, detailed) === "inflow";
}

/** Any transfer in or out (TRANSFER_IN_* or TRANSFER_OUT_*). Card payments are not transfers here. */
export function isTransferPfc(primary: string | null, detailed: string | null): boolean {
  const r = resolve(primary, detailed);
  return r.primary !== null && TRANSFER_PRIMARIES.has(r.primary);
}

/**
 * Money moved through a payment app (Venmo, Zelle, Cash App and the like), in either direction.
 * Needs the detailed code. Only the outgoing code maps to payroll_contractors; use pfcCategory
 * for the category.
 */
export function isPaymentAppTransfer(primary: string | null, detailed: string | null): boolean {
  const r = resolve(primary, detailed);
  return r.row !== null && PAYMENT_APP_CODES.has(r.row[1]);
}
