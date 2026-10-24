// Financial Pulse: turns Plaid API objects into Pulse table rows, and Plaid webhooks into item
// status changes (A6, A7).
//
// Pure functions only (no runtime-specific or network APIs); tested in src/lib/pulse/plaidMap.test.ts.
// Field names follow Plaid's API (version 2020-09-14, checked
// 2026-09-30 against plaid.com/docs and the official OpenAPI spec).

// ---------------------------------------------------------------------------
// Plaid shapes (only the fields Pulse reads)
// ---------------------------------------------------------------------------

export interface PlaidCounterparty {
  name?: string | null;
  type?: string | null;
  entity_id?: string | null;
  confidence_level?: string | null;
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  authorized_date?: string | null;
  name?: string | null;
  merchant_name?: string | null;
  merchant_entity_id?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  payment_channel?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null; confidence_level?: string | null } | null;
  counterparties?: PlaidCounterparty[] | null;
}

export interface PlaidAccount {
  account_id: string;
  persistent_account_id?: string | null;
  name?: string | null;
  official_name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  holder_category?: string | null;
  balances?: {
    available?: number | null;
    current?: number | null;
    limit?: number | null;
    iso_currency_code?: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface TransactionRow {
  owner_id: string;
  account_row_id: string;
  transaction_id: string;
  pending: boolean;
  pending_transaction_id: string | null;
  txn_date: string;
  authorized_date: string | null;
  amount: number;
  iso_currency_code: string | null;
  name: string | null;
  merchant_name: string | null;
  merchant_entity_id: string | null;
  counterparty_name: string | null;
  counterparty_type: string | null;
  payee: string | null;
  payment_channel: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  pfc_confidence: string | null;
  plaid_seen_at: string;
}

/** Account fields refreshed on every sync. Owner choices (is_business, include_from, use_for_payroll) are never overwritten. */
export interface AccountRefresh {
  owner_id: string;
  item_row_id: string;
  account_id: string;
  persistent_account_id: string | null;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  holder_category: string | null;
  balance_available: number | null;
  balance_current: number | null;
  balance_limit: number | null;
  iso_currency_code: string | null;
  balance_as_of: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The counterparty the sorter should see: a payment app first (Zelle, Venmo, Cash App payouts
 * are payroll), otherwise the first one Plaid listed.
 */
/**
 * Which accounts Plaid Link offers: business-relevant bank accounts and every kind of card.
 * Only values that /link/token/create lists for account_filters (plaid.com/docs/api/link, checked
 * 2026-09-30). Credit uses "all": that endpoint does not accept "charge card" by name, and charge
 * cards (for example Amex business cards) must still be offered.
 */
export const LINK_ACCOUNT_FILTERS = {
  depository: { account_subtypes: ["checking", "savings", "money market", "cash management", "paypal"] },
  credit: { account_subtypes: ["all"] },
};

export function pickCounterparty(list: PlaidCounterparty[] | null | undefined): PlaidCounterparty | null {
  const all = (list ?? []).filter((c) => c && str(c.name));
  return all.find((c) => (c.type ?? "").toLowerCase() === "payment_app") ?? all[0] ?? null;
}

export function mapTransaction(t: PlaidTransaction, ownerId: string, accountRowId: string, seenAt: string): TransactionRow {
  const cp = pickCounterparty(t.counterparties);
  const amount = num(t.amount);
  if (amount === null) throw new Error(`transaction ${t.transaction_id} has no amount`);
  return {
    owner_id: ownerId,
    account_row_id: accountRowId,
    transaction_id: t.transaction_id,
    pending: t.pending === true,
    pending_transaction_id: str(t.pending_transaction_id),
    txn_date: t.date,
    authorized_date: str(t.authorized_date),
    amount: cents(amount),
    iso_currency_code: str(t.iso_currency_code),
    name: str(t.name),
    merchant_name: str(t.merchant_name),
    merchant_entity_id: str(t.merchant_entity_id),
    counterparty_name: cp ? str(cp.name) : null,
    counterparty_type: cp ? str(cp.type) : null,
    payee: cp && (cp.type ?? "").toLowerCase() !== "financial_institution" ? str(cp.name) : null,
    payment_channel: str(t.payment_channel),
    pfc_primary: str(t.personal_finance_category?.primary),
    pfc_detailed: str(t.personal_finance_category?.detailed),
    pfc_confidence: str(t.personal_finance_category?.confidence_level),
    plaid_seen_at: seenAt,
  };
}

export function mapAccount(a: PlaidAccount, ownerId: string, itemRowId: string, asOf: string): AccountRefresh {
  const b = a.balances ?? {};
  const money = (v: unknown) => (num(v) === null ? null : cents(num(v) as number));
  return {
    owner_id: ownerId,
    item_row_id: itemRowId,
    account_id: a.account_id,
    persistent_account_id: str(a.persistent_account_id),
    name: str(a.name),
    official_name: str(a.official_name),
    mask: str(a.mask),
    type: str(a.type),
    subtype: str(a.subtype),
    holder_category: str(a.holder_category),
    balance_available: money(b.available),
    balance_current: money(b.current),
    balance_limit: money(b.limit),
    iso_currency_code: str(b.iso_currency_code),
    balance_as_of: asOf,
  };
}

// ---------------------------------------------------------------------------
// Link guards
// ---------------------------------------------------------------------------

/**
 * True when a new link would duplicate an account the company already has live (same mask and
 * name), whatever institution record it came through. Checked before the public token is exchanged,
 * so a duplicate never uses up a Trial connection. Accounts without a mask are never compared.
 */
export function duplicatesExisting(
  incoming: Array<{ mask?: string | null; name?: string | null }>,
  existing: Array<{ mask: string | null; name: string | null }>,
): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  return incoming.some((a) =>
    norm(a.mask) !== "" &&
    existing.some((e) => norm(e.mask) === norm(a.mask) && norm(e.name) === norm(a.name))
  );
}

/**
 * What a failed Plaid /item/remove means. "gone": Plaid no longer has the connection (already removed
 * or the token is dead), so it counts as removed. "unreadable": the stored token can't be read (usually
 * the wrong key is deployed), so the connection cannot be closed from here. "retry": anything else
 * (Plaid unreachable, rate limit), so nothing should be deleted yet.
 */
export function removalVerdict(errorCode: string | null | undefined, message: string | null | undefined): "gone" | "unreadable" | "retry" {
  if (errorCode === "ITEM_NOT_FOUND" || errorCode === "INVALID_ACCESS_TOKEN") return "gone";
  if (/no stored access token|could not be decrypted/i.test(message ?? "")) return "unreadable";
  return "retry";
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type ItemStatus =
  | "active"
  | "login_required"
  | "pending_expiration"
  | "pending_disconnect"
  | "revoked"
  | "removed"
  | "error";

export interface PlaidWebhookBody {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  environment?: string;
  error?: { error_code?: string | null; error_type?: string | null } | null;
  initial_update_complete?: boolean;
  historical_update_complete?: boolean;
  account_id?: string;
  consent_expiration_time?: string | null;
}

export interface WebhookAction {
  /** Columns to set on plaid_items (may be empty). */
  item: Partial<{
    status: ItemStatus;
    error_code: string | null;
    new_accounts_available: boolean;
    initial_update_complete: boolean;
    historical_update_complete: boolean;
    consent_expiration_time: string | null;
  }>;
  /** Run a transactions sync for the item. */
  sync: boolean;
  /** A single account Plaid says the owner revoked (USER_ACCOUNT_REVOKED). */
  revokeAccountId: string | null;
  /** Codes Pulse does not act on (logged only). */
  ignored: boolean;
}

/** What to do for a (verified) Plaid webhook. Unknown codes are ignored, never an error. */
export function webhookAction(body: PlaidWebhookBody): WebhookAction {
  const type = (body.webhook_type ?? "").toUpperCase();
  const code = (body.webhook_code ?? "").toUpperCase();
  const none: WebhookAction = { item: {}, sync: false, revokeAccountId: null, ignored: true };

  if (type === "TRANSACTIONS") {
    if (code === "SYNC_UPDATES_AVAILABLE") {
      const item: WebhookAction["item"] = {};
      if (body.initial_update_complete === true) item.initial_update_complete = true;
      if (body.historical_update_complete === true) item.historical_update_complete = true;
      return { item, sync: true, revokeAccountId: null, ignored: false };
    }
    // The legacy codes (INITIAL/HISTORICAL/DEFAULT_UPDATE, TRANSACTIONS_REMOVED) keep firing, but
    // /transactions/sync makes them unnecessary.
    return none;
  }

  if (type === "ITEM") {
    switch (code) {
      case "ERROR": {
        const ec = body.error?.error_code ?? null;
        if (ec === "ITEM_LOGIN_REQUIRED") return { item: { status: "login_required", error_code: ec }, sync: false, revokeAccountId: null, ignored: false };
        if (ec === "USER_PERMISSION_REVOKED" || ec === "ITEM_NOT_FOUND") {
          return { item: { status: "revoked", error_code: ec }, sync: false, revokeAccountId: null, ignored: false };
        }
        return { item: { status: "error", error_code: ec }, sync: false, revokeAccountId: null, ignored: false };
      }
      case "LOGIN_REPAIRED":
        return { item: { status: "active", error_code: null }, sync: true, revokeAccountId: null, ignored: false };
      case "PENDING_EXPIRATION":
        return {
          item: { status: "pending_expiration", consent_expiration_time: body.consent_expiration_time ?? null },
          sync: false, revokeAccountId: null, ignored: false,
        };
      case "PENDING_DISCONNECT":
        return { item: { status: "pending_disconnect" }, sync: false, revokeAccountId: null, ignored: false };
      case "USER_PERMISSION_REVOKED":
        return { item: { status: "revoked", error_code: "USER_PERMISSION_REVOKED" }, sync: false, revokeAccountId: null, ignored: false };
      case "USER_ACCOUNT_REVOKED":
        return { item: {}, sync: false, revokeAccountId: body.account_id ?? null, ignored: false };
      case "NEW_ACCOUNTS_AVAILABLE":
        return { item: { new_accounts_available: true }, sync: false, revokeAccountId: null, ignored: false };
      default:
        return none;
    }
  }
  return none;
}

/**
 * Dedupe key for a Plaid webhook: item, code, the history flags and the 5-minute bucket it arrived
 * in (A6). The flags keep the "full history ready" update from being dropped as a repeat of the
 * "last 30 days ready" one that usually arrives minutes earlier.
 */
export function plaidDedupeKey(body: PlaidWebhookBody, receivedAtMs: number): string {
  const bucket = Math.floor(receivedAtMs / (5 * 60_000));
  const flags = `${body.initial_update_complete === true ? "i" : "-"}${body.historical_update_complete === true ? "h" : "-"}`;
  const err = body.error?.error_code ?? "";
  return `plaid|${body.item_id ?? "none"}|${(body.webhook_type ?? "").toUpperCase()}|${(body.webhook_code ?? "").toUpperCase()}|${flags}|${err}|${bucket}`;
}
