// Financial Pulse web client: request bodies, parsed results and owner-facing messages.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(fn: string, options: { body: object }) => Promise<{ data: unknown; error: unknown }>>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

import {
  BANK_UPDATED_MESSAGE,
  GENERIC_ERROR,
  NOT_ENABLED_MESSAGE,
  NOT_PERSONAL_MESSAGE,
  SET_BY_SUPPORT_MESSAGE,
  STILL_NEEDS_LOGIN_MESSAGE,
  UPDATE_NOT_CONFIRMED_MESSAGE,
  afterUpdateOutcome,
  exchange,
  linkToken,
  personalRuleFor,
  pulseErrorMessage,
  pulseHomeSummary,
  setup,
  sync,
  transactionAction,
  type PulseFailure,
  type SyncResult,
} from "./api";

function replyWith(data: unknown) {
  mocks.invoke.mockResolvedValueOnce({ data, error: null });
}

function failure(code: string, error = "server text"): PulseFailure {
  return { ok: false, code, error };
}

describe("Pulse api calls", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("sends after_update to plaid-sync and returns the problems list", async () => {
    replyWith({ ok: true, items: 1, added: 2, modified: 0, removed: 0, problems: ["login_required"] });
    const res = await sync({ item_row_id: "item-1", after_update: true });
    expect(mocks.invoke).toHaveBeenCalledWith("plaid-sync", { body: { item_row_id: "item-1", after_update: true } });
    expect(res).toEqual({ ok: true, items: 1, added: 2, modified: 0, removed: 0, problems: ["login_required"] });
  });

  it("treats a missing or malformed problems list as no problems", async () => {
    replyWith({ ok: true, items: 1, added: 0, modified: 0, removed: 0 });
    const missing = await sync({});
    replyWith({ ok: true, items: 1, added: 0, modified: 0, removed: 0, problems: [1, "", null, "error"] });
    const mixed = await sync({});
    expect(missing.ok && missing.problems).toEqual([]);
    expect(mixed.ok && mixed.problems).toEqual(["error"]);
  });

  it("passes a refusal through with its code", async () => {
    replyWith({ ok: false, code: "store_failed", error: "x" });
    const res = await exchange({
      public_token: "public-sandbox-1",
      metadata: { institution: null, accounts: [], link_session_id: null },
      consent_version: "v",
    });
    expect(res).toEqual({ ok: false, code: "store_failed", error: "x" });
  });

  it("turns a transport error into the network code", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error("offline") });
    const res = await linkToken({ mode: "new" });
    expect(res).toEqual({ ok: false, code: "network", error: GENERIC_ERROR });
  });

  it("sends count_from_chosen with set_accounts", async () => {
    replyWith({ ok: true, sorted: 3 });
    const accounts = [
      { id: "a1", is_business: true, include_from: null, use_for_payroll: false, count_from_chosen: true },
      { id: "a2", is_business: false, include_from: null, use_for_payroll: false, count_from_chosen: false },
    ];
    const res = await setup({ action: "set_accounts", accounts });
    expect(mocks.invoke).toHaveBeenCalledWith("pulse-setup", { body: { action: "set_accounts", accounts } });
    expect(res).toEqual({ ok: true, history_repull: false });
  });

  it("passes on that an account switched to business is bringing in its past transactions", async () => {
    replyWith({ ok: true, sorted: 0, history_repull: true });
    const res = await setup({ action: "set_accounts", accounts: [{ id: "a1", is_business: true, include_from: null, use_for_payroll: false }] });
    expect(res).toEqual({ ok: true, history_repull: true });
  });

  it("returns personal_rows_removed_from for the complete action", async () => {
    replyWith({ ok: true, personal_rows_removed_from: 2 });
    const res = await setup({ action: "complete" });
    expect(mocks.invoke).toHaveBeenCalledWith("pulse-setup", { body: { action: "complete" } });
    expect(res).toEqual({ ok: true, personal_rows_removed_from: 2 });
  });
});

describe("transactionAction", () => {
  const RULE_ID = "7d6f3a2e-1b4c-4d5e-9f00-1234567890ab";

  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("sends mark_personal and returns the rule and the scope the server applied", async () => {
    replyWith({ ok: true, rule_id: RULE_ID, scope_applied: "merchant" });
    const res = await transactionAction({ action: "mark_personal", transaction_id: "txn1", scope: "merchant" });
    expect(mocks.invoke).toHaveBeenCalledWith("pulse-transaction-action", {
      body: { action: "mark_personal", transaction_id: "txn1", scope: "merchant" },
    });
    expect(res).toEqual({ ok: true, rule_id: RULE_ID, scope_applied: "merchant", pending: false });
  });

  it("reports this payment only when the server narrowed the scope or sent something unexpected", async () => {
    replyWith({ ok: true, rule_id: RULE_ID, scope_applied: "one" });
    const narrowed = await transactionAction({ action: "mark_personal", transaction_id: "txn1", scope: "merchant" });
    replyWith({ ok: true, rule_id: RULE_ID, scope_applied: "everything" });
    const odd = await transactionAction({ action: "mark_personal", transaction_id: "txn1", scope: "merchant" });
    expect(narrowed.ok && narrowed.scope_applied).toBe("one");
    expect(odd.ok && odd.scope_applied).toBe("one");
  });

  it("treats a mark_personal reply without a rule id as a network failure", async () => {
    replyWith({ ok: true, scope_applied: "one" });
    const res = await transactionAction({ action: "mark_personal", transaction_id: "txn1", scope: "one" });
    expect(res).toEqual({ ok: false, code: "network", error: GENERIC_ERROR });
  });

  it("sends undo with the rule id", async () => {
    replyWith({ ok: true });
    const res = await transactionAction({ action: "undo", rule_id: RULE_ID });
    expect(mocks.invoke).toHaveBeenCalledWith("pulse-transaction-action", { body: { action: "undo", rule_id: RULE_ID } });
    expect(res).toEqual({ ok: true, pending: false });
  });

  it("returns how many rules count_as_business switched off", async () => {
    replyWith({ ok: true, deactivated: 2 });
    const res = await transactionAction({ action: "count_as_business", transaction_id: "txn1" });
    expect(res).toEqual({ ok: true, deactivated: 2, pending: false });
  });

  it.each(["not_personal", "set_by_support", "not_found", "not_enabled"])("passes the %s refusal through", async (code) => {
    replyWith({ ok: false, code, error: "server text" });
    const res = await transactionAction({ action: "count_as_business", transaction_id: "txn1" });
    expect(res).toEqual({ ok: false, code, error: "server text" });
  });

  it("re-exports personalRuleFor for the dialog label", () => {
    const choice = personalRuleFor({
      transaction_id: "txn1",
      name: "SHELL OIL 57444",
      merchant_name: "Shell",
      merchant_entity_id: "eShell0001",
      counterparty_name: null,
      counterparty_type: null,
      pfc_primary: null,
      pfc_detailed: null,
    });
    expect(choice.merchant?.label).toBe("Shell");
  });
});

describe("pulseErrorMessage", () => {
  it.each([
    ["same_institution", "This bank is already linked. Press Reconnect or Add accounts on that bank in Setup, or contact TreeCheck if it has no buttons."],
    ["duplicate_accounts", "One or more of these accounts is already linked. To add another account at that bank, press Add accounts on it in Setup."],
    ["company_limit", "Your company has reached its number of bank connections. Please contact TreeCheck to link another bank."],
    ["team_limit", "TreeCheck's bank connections are full right now. Please contact TreeCheck."],
    ["not_configured", "Bank linking is not set up yet. Please contact TreeCheck."],
    ["store_failed", "The bank connected but could not be saved. Please contact TreeCheck before trying again."],
    ["exchange_unclear", "We could not confirm the bank connection. Please contact TreeCheck before trying again."],
    ["not_enabled", NOT_ENABLED_MESSAGE],
    ["not_personal", "This payment isn't marked as personal, so there's nothing to change."],
    ["set_by_support", "TreeCheck support marked this payment as personal. Please contact TreeCheck if it should count as business."],
  ])("%s has fixed wording", (code, text) => {
    expect(pulseErrorMessage(failure(code))).toBe(text);
  });

  it("uses plain owner words for the personal-button codes, with no em dashes", () => {
    for (const text of [NOT_PERSONAL_MESSAGE, SET_BY_SUPPORT_MESSAGE]) {
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/rule|exclude_personal|owner_tap|transaction_id/i);
    }
  });

  it("shows the server text for not_found from the personal button", () => {
    const text = "We couldn't find that payment. Refresh the page and try again.";
    expect(pulseErrorMessage(failure("not_found", text))).toBe(text);
  });

  it("shows the server text for bad_request and unknown codes", () => {
    expect(pulseErrorMessage(failure("bad_request", "No accounts to save."))).toBe("No accounts to save.");
    expect(pulseErrorMessage(failure("plaid_error", "The bank is down."))).toBe("The bank is down.");
    expect(pulseErrorMessage(failure("plaid_error", ""))).toBe(GENERIC_ERROR);
  });
});

describe("afterUpdateOutcome", () => {
  const synced = (problems: string[]): SyncResult => ({ ok: true, items: 1, added: 0, modified: 0, removed: 0, problems });

  it("says Bank updated only when the sync had no problems", () => {
    expect(afterUpdateOutcome(synced([]))).toEqual({ ok: true, message: BANK_UPDATED_MESSAGE });
  });

  it("asks for Reconnect again when the bank still needs a login", () => {
    expect(afterUpdateOutcome(synced(["login_required"]))).toEqual({ ok: false, message: STILL_NEEDS_LOGIN_MESSAGE });
  });

  it("never says Bank updated for other problems or a failed sync", () => {
    for (const result of [synced(["error"]), synced(["revoked"]), synced(["busy"]), failure("plaid_error"), failure("network")]) {
      const outcome = afterUpdateOutcome(result);
      expect(outcome.ok).toBe(false);
      expect(outcome.message).not.toBe(BANK_UPDATED_MESSAGE);
    }
    expect(afterUpdateOutcome(synced(["error"])).message).toBe(UPDATE_NOT_CONFIRMED_MESSAGE);
    expect(afterUpdateOutcome(failure("not_enabled")).message).toBe(NOT_ENABLED_MESSAGE);
  });
});

describe("pulseHomeSummary (Home's Pulse card, engine-6)", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  const window = (key: string, from: string, to: string, revenue: number, cost: number) => ({
    key, from, to, revenue, revenue_count: 1, cost, cost_count: 1, profit: revenue - cost, has_data: true,
    partial: false, partial_from: null, partial_label: null,
  });
  const summary = {
    engine_version: "engine-6",
    today: "2026-10-20",
    month: {
      current: window("MTD", "2026-10-01", "2026-10-20", 3000, 1800),
      previous: window("PMTD", "2026-09-01", "2026-09-20", 2500, 2000),
      revenue: { amount: 500, percent: 20 },
      cost: { amount: -200, percent: -10 },
      profit: { amount: 700, percent: 140 },
      comparable: true,
    },
    revenue_basis: "payments",
    updated_at: "2026-10-20T12:00:00Z",
    arriving: false,
  };

  it("asks pulse-get for the summary only", async () => {
    replyWith({ ok: true, setup_done: true, summary, computed_at: "2026-10-20T17:00:00Z" });
    const r = await pulseHomeSummary();
    expect(mocks.invoke).toHaveBeenCalledWith("pulse-get", { body: { summary: true } });
    expect(r).toEqual({ ok: true, setup_done: true, summary, computed_at: "2026-10-20T17:00:00Z" });
  });

  it("passes setup not finished through", async () => {
    replyWith({ ok: true, setup_done: false });
    expect(await pulseHomeSummary()).toEqual({ ok: true, setup_done: false });
  });

  it("treats a reply without the month comparison as a network failure (an older pulse-get)", async () => {
    replyWith({ ok: true, snapshot: { status: {}, periods: {} }, computed_at: "x", cached: true, refreshing: false });
    expect(await pulseHomeSummary()).toEqual(failure("network", GENERIC_ERROR));
    replyWith({ ok: true, setup_done: true, summary: { ...summary, month: null } });
    expect(await pulseHomeSummary()).toEqual(failure("network", GENERIC_ERROR));
  });

  it("passes a refusal through", async () => {
    replyWith({ ok: false, code: "not_enabled", error: NOT_ENABLED_MESSAGE });
    expect(await pulseHomeSummary()).toEqual(failure("not_enabled", NOT_ENABLED_MESSAGE));
  });
});
