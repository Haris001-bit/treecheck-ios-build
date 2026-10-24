// Financial Pulse: Plaid object mapping and webhook handling (synthetic data only).
import { describe, expect, it } from "vitest";
import {
  duplicatesExisting,
  LINK_ACCOUNT_FILTERS,
  mapAccount,
  mapTransaction,
  pickCounterparty,
  plaidDedupeKey,
  type PlaidTransaction,
  webhookAction,
} from "../../../supabase/functions/_shared/pulse/plaidMap";
import { removalVerdict } from "../../../supabase/functions/_shared/pulse/plaidMap";

const txn = (over: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
  transaction_id: "t1",
  account_id: "a1",
  amount: 42.5,
  iso_currency_code: "USD",
  date: "2026-09-10",
  authorized_date: "2026-09-09",
  name: "ACME SUPPLY #12",
  merchant_name: "Acme Supply",
  merchant_entity_id: "ent-acme",
  pending: false,
  pending_transaction_id: null,
  payment_channel: "in store",
  personal_finance_category: { primary: "HOME_IMPROVEMENT", detailed: "HOME_IMPROVEMENT_HARDWARE", confidence_level: "HIGH" },
  counterparties: [{ name: "Acme Supply", type: "merchant", entity_id: "ent-acme", confidence_level: "HIGH" }],
  ...over,
});

describe("mapTransaction", () => {
  it("keeps Plaid's sign (positive = money out) and every field the sorter reads", () => {
    const r = mapTransaction(txn(), "owner-1", "acct-row-1", "2026-09-30T00:00:00.000Z");
    expect(r).toMatchObject({
      owner_id: "owner-1", account_row_id: "acct-row-1", transaction_id: "t1", pending: false, txn_date: "2026-09-10",
      authorized_date: "2026-09-09", amount: 42.5, merchant_name: "Acme Supply", merchant_entity_id: "ent-acme",
      counterparty_name: "Acme Supply", counterparty_type: "merchant", pfc_primary: "HOME_IMPROVEMENT",
      pfc_detailed: "HOME_IMPROVEMENT_HARDWARE", pfc_confidence: "HIGH", payment_channel: "in store",
    });
    expect(mapTransaction(txn({ amount: -12 }), "o", "a", "x").amount).toBe(-12);
  });

  it("rounds to cents and turns empty strings into nulls", () => {
    const r = mapTransaction(txn({ amount: 10.005, merchant_name: "", pending_transaction_id: "" }), "o", "a", "x");
    expect(r.amount).toBe(10.01);
    expect(r.merchant_name).toBeNull();
    expect(r.pending_transaction_id).toBeNull();
  });

  it("copes with no category and no counterparties", () => {
    const r = mapTransaction(txn({ personal_finance_category: null, counterparties: null }), "o", "a", "x");
    expect(r.pfc_primary).toBeNull();
    expect(r.counterparty_type).toBeNull();
  });

  it("refuses a transaction without an amount", () => {
    expect(() => mapTransaction(txn({ amount: Number.NaN }), "o", "a", "x")).toThrow(/no amount/);
  });
});

describe("pickCounterparty", () => {
  it("prefers a payment app (Zelle/Venmo payouts are payroll), else the first", () => {
    const list = [
      { name: "Chase", type: "financial_institution" },
      { name: "Zelle", type: "payment_app" },
    ];
    expect(pickCounterparty(list)?.name).toBe("Zelle");
    expect(pickCounterparty([{ name: "Acme", type: "merchant" }])?.name).toBe("Acme");
    expect(pickCounterparty([{ name: "", type: "payment_app" }])).toBeNull();
    expect(pickCounterparty(null)).toBeNull();
  });
});

describe("mapAccount", () => {
  it("maps balances and never touches the owner's choices", () => {
    const r = mapAccount({
      account_id: "a1", name: "Business Checking", mask: "1234", type: "depository", subtype: "checking",
      balances: { available: 1000.456, current: 1200, limit: null, iso_currency_code: "USD" },
    }, "o", "item-row", "2026-09-30T00:00:00.000Z");
    expect(r).toMatchObject({ balance_available: 1000.46, balance_current: 1200, balance_limit: null, mask: "1234", subtype: "checking" });
    expect(Object.keys(r)).not.toContain("is_business");
    expect(Object.keys(r)).not.toContain("include_from");
    expect(Object.keys(r)).not.toContain("use_for_payroll");
  });
});

describe("duplicatesExisting", () => {
  const existing = [{ mask: "1234", name: "Business Checking" }];
  it("flags the same live account, whatever institution record it came through", () => {
    expect(duplicatesExisting([{ mask: "1234", name: "business checking" }], existing)).toBe(true);
  });
  it("allows a different account, and never compares accounts without a mask", () => {
    expect(duplicatesExisting([{ mask: "9999", name: "Business Checking" }], existing)).toBe(false);
    expect(duplicatesExisting([{ mask: "1234", name: "Savings" }], existing)).toBe(false);
    expect(duplicatesExisting([{ mask: null, name: "Business Checking" }], [{ mask: null, name: "Business Checking" }])).toBe(false);
    expect(duplicatesExisting([], existing)).toBe(false);
  });
});

describe("webhookAction", () => {
  it("syncs on SYNC_UPDATES_AVAILABLE and records the history flags", () => {
    expect(webhookAction({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", initial_update_complete: true, historical_update_complete: false }))
      .toEqual({ item: { initial_update_complete: true }, sync: true, revokeAccountId: null, ignored: false });
  });

  it("ignores the legacy transactions codes", () => {
    for (const code of ["INITIAL_UPDATE", "HISTORICAL_UPDATE", "DEFAULT_UPDATE", "TRANSACTIONS_REMOVED"]) {
      expect(webhookAction({ webhook_type: "TRANSACTIONS", webhook_code: code }).ignored).toBe(true);
    }
  });

  it("maps every ITEM code to the right status", () => {
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "ERROR", error: { error_code: "ITEM_LOGIN_REQUIRED" } }).item)
      .toEqual({ status: "login_required", error_code: "ITEM_LOGIN_REQUIRED" });
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "ERROR", error: { error_code: "INSTITUTION_DOWN" } }).item)
      .toEqual({ status: "error", error_code: "INSTITUTION_DOWN" });
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "ERROR", error: { error_code: "USER_PERMISSION_REVOKED" } }).item.status).toBe("revoked");
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED" })).toMatchObject({ item: { status: "active", error_code: null }, sync: true });
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION", consent_expiration_time: "2026-12-01T00:00:00Z" }).item)
      .toEqual({ status: "pending_expiration", consent_expiration_time: "2026-12-01T00:00:00Z" });
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "PENDING_DISCONNECT" }).item.status).toBe("pending_disconnect");
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "USER_PERMISSION_REVOKED" }).item.status).toBe("revoked");
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "USER_ACCOUNT_REVOKED", account_id: "a9" }).revokeAccountId).toBe("a9");
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "NEW_ACCOUNTS_AVAILABLE" }).item).toEqual({ new_accounts_available: true });
  });

  it("ignores unknown or unrelated codes instead of failing", () => {
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "WEBHOOK_UPDATE_ACKNOWLEDGED" }).ignored).toBe(true);
    expect(webhookAction({ webhook_type: "ITEM", webhook_code: "SOMETHING_NEW" }).ignored).toBe(true);
    expect(webhookAction({ webhook_type: "AUTH", webhook_code: "X" }).ignored).toBe(true);
    expect(webhookAction({}).ignored).toBe(true);
  });
});

describe("plaidDedupeKey", () => {
  it("is the same within a 5-minute window and different across windows or items", () => {
    const b = { item_id: "i1", webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" };
    const t = Date.UTC(2026, 8, 30, 12, 0, 30);
    expect(plaidDedupeKey(b, t)).toBe(plaidDedupeKey(b, t + 60_000));
    expect(plaidDedupeKey(b, t)).not.toBe(plaidDedupeKey(b, t + 5 * 60_000));
    expect(plaidDedupeKey(b, t)).not.toBe(plaidDedupeKey({ ...b, item_id: "i2" }, t));
  });

  it("never drops the full-history update as a repeat of the 30-day one minutes earlier", () => {
    const b = { item_id: "i1", webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" };
    const t = Date.UTC(2026, 8, 30, 12, 0, 30);
    const first = plaidDedupeKey({ ...b, initial_update_complete: true, historical_update_complete: false }, t);
    const full = plaidDedupeKey({ ...b, initial_update_complete: true, historical_update_complete: true }, t + 60_000);
    expect(first).not.toBe(full);
  });
});

describe("Link account filters", () => {
  // The values /link/token/create lists for account_filters (plaid.com/docs/api/link, 2026-09-30).
  // A value outside these lists makes Plaid refuse every Link token.
  const DEPOSITORY = ["checking", "savings", "hsa", "cd", "money market", "paypal", "prepaid", "cash management", "ebt", "limited purpose checking", "all"];
  const CREDIT = ["credit card", "paypal", "all"];

  it("uses only values Plaid lists for the Link token", () => {
    for (const v of LINK_ACCOUNT_FILTERS.depository.account_subtypes) expect(DEPOSITORY).toContain(v);
    for (const v of LINK_ACCOUNT_FILTERS.credit.account_subtypes) expect(CREDIT).toContain(v);
  });

  it("offers every kind of card (charge cards included) and only bank or card accounts", () => {
    expect(LINK_ACCOUNT_FILTERS.credit.account_subtypes).toEqual(["all"]);
    expect(Object.keys(LINK_ACCOUNT_FILTERS).sort()).toEqual(["credit", "depository"]);
    expect(LINK_ACCOUNT_FILTERS.depository.account_subtypes).toContain("checking");
    expect(LINK_ACCOUNT_FILTERS.depository.account_subtypes).not.toContain("limited purpose checking");
  });
});

describe("removalVerdict (closing a bank at Plaid before an account is deleted)", () => {
  it("treats a connection Plaid no longer has as removed", () => {
    expect(removalVerdict("ITEM_NOT_FOUND", "x")).toBe("gone");
    expect(removalVerdict("INVALID_ACCESS_TOKEN", "x")).toBe("gone");
  });
  it("flags a token that can't be read", () => {
    expect(removalVerdict(null, "Plaid item has no stored access token")).toBe("unreadable");
    expect(removalVerdict(null, "token could not be decrypted")).toBe("unreadable");
  });
  it("asks to try again for anything else, so nothing is deleted yet", () => {
    expect(removalVerdict("NETWORK_ERROR", "Plaid error NETWORK_ERROR")).toBe("retry");
    expect(removalVerdict("RATE_LIMIT_EXCEEDED", "")).toBe("retry");
    expect(removalVerdict(null, null)).toBe("retry");
  });
});
