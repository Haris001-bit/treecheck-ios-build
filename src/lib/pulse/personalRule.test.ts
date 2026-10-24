// Financial Pulse: the key behind the "Personal, not business" button (synthetic fixtures only,
// never real data). A10 "Personal or owner-draw keys", plan task W2-04.
import { describe, expect, it } from "vitest";
import { personalRuleFor, personalRulesMatching } from "../../../supabase/functions/_shared/pulse/personalRule";
import { classifyAll } from "../../../supabase/functions/_shared/pulse/sorter";
import type { SorterAccount, SorterRule, SorterTxn } from "../../../supabase/functions/_shared/pulse/types";

const SETTINGS = { card_payment_window_days: 5, transfer_window_days: 5 };

const account = (id: string, over: Partial<SorterAccount> = {}): SorterAccount => ({
  id,
  type: "depository",
  subtype: "checking",
  is_business: true,
  include_from: null,
  ...over,
});
const ACCOUNTS = [account("chk"), account("card", { type: "credit", subtype: "credit card" })];

const txn = (id: string, over: Partial<SorterTxn> = {}): SorterTxn => ({
  transaction_id: id,
  account_row_id: "chk",
  pending: false,
  pending_transaction_id: null,
  txn_date: "2026-09-15",
  authorized_date: null,
  amount: 25,
  name: "ACME SUPPLY",
  merchant_name: null,
  merchant_entity_id: null,
  counterparty_name: null,
  counterparty_type: null,
  payment_channel: null,
  pfc_primary: null,
  pfc_detailed: null,
  pfc_confidence: null,
  ...over,
});

const code = (detailed: string): Pick<SorterTxn, "pfc_primary" | "pfc_detailed"> => ({
  pfc_primary: detailed.startsWith("TRANSFER_OUT_")
    ? "TRANSFER_OUT"
    : detailed.startsWith("TRANSFER_IN_")
      ? "TRANSFER_IN"
      : detailed.split("_")[0],
  pfc_detailed: detailed,
});

const rule = (id: string, over: Partial<SorterRule>): SorterRule => ({
  id,
  rule_type: "exclude_personal",
  match_kind: "transaction_id",
  match_value: "",
  account_row_id: null,
  category_key: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Synthetic transactions
// ---------------------------------------------------------------------------

const SHELL = txn("t-shell", {
  name: "SHELL OIL 57444 OKLAHOMA CITY OK",
  merchant_name: "Shell",
  merchant_entity_id: "eShell0001",
  ...code("TRANSPORTATION_GAS"),
});
const QT_NAME_ONLY = txn("t-qt", { name: "QT 123 OKLAHOMA CITY OK", merchant_name: "QT", ...code("TRANSPORTATION_GAS") });
const ZELLE_JUAN = txn("t-zelle-juan", {
  name: "Zelle payment to JUAN MARTINEZ Conf# 8XJ2K9QZ",
  merchant_name: "Zelle",
  merchant_entity_id: "eZelle0001",
  counterparty_name: "Zelle",
  counterparty_type: "payment_app",
  ...code("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS"),
});
const TRANSFER_JUAN = txn("t-xfer-juan", { name: "ONLINE TRANSFER TO JUAN MARTINEZ", ...code("TRANSFER_OUT_ACCOUNT_TRANSFER") });
const PAYPAL_CHECKOUT = txn("t-paypal", {
  name: "PAYPAL *JOESTREESUPPLY",
  merchant_name: "PayPal",
  merchant_entity_id: "ePayPal0001",
  ...code("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE"),
});
const SQUARE_SELLER = txn("t-sq", { name: "SQ *JOES COFFEE 1234", merchant_name: "SQ *JOES COFFEE 1234" });
const HARDWARE_NO_MERCHANT = txn("t-hw", { name: "POS PURCHASE 0423 LOCAL HARDWARE STORE", ...code("HOME_IMPROVEMENT_HARDWARE") });

const NO_PAYEE: Array<[string, SorterTxn]> = [
  ["a Zelle payment with no payee", txn("t-zelle", {
    name: "ZELLE PAYMENT CONF# 9QX2ABCD",
    merchant_name: "Zelle",
    merchant_entity_id: "eZelle0001",
    counterparty_type: "payment_app",
    ...code("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS"),
  })],
  ["a Venmo payment with no payee", txn("t-venmo", {
    name: "VENMO PAYMENT 1023456789 WEB ID: 3264681992",
    merchant_name: "Venmo",
    merchant_entity_id: "eVenmo0001",
    ...code("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS"),
  })],
  ["a Cash App payment with no payee", txn("t-cashapp", {
    name: "CASH APP*CASH OUT",
    merchant_name: "Cash App",
    merchant_entity_id: "eCashApp001",
    ...code("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS"),
  })],
  ["a Zelle payment with no Plaid code and no payee", txn("t-zelle-bare", { name: "Zelle Transfer Conf# J8K2L9" })],
  ["a transfer between own accounts", txn("t-xfer", {
    name: "ONLINE TRANSFER TO CHK ...1234 TRANSACTION#: 12345678 09/28",
    ...code("TRANSFER_OUT_ACCOUNT_TRANSFER"),
  })],
  ["a bank transfer with only a bank name", txn("t-xfer-bank", {
    name: "Online Banking transfer to SAV 5678 Confirmation# 1234567",
    merchant_name: "Bank of America",
    merchant_entity_id: "eBofA0001",
    ...code("TRANSFER_OUT_SAVINGS"),
  })],
  ["an ATM withdrawal with a location", txn("t-atm", {
    name: "ATM WITHDRAWAL 000123 09/28 5000 N MAY AVE OKLAHOMA CITY OK",
    ...code("TRANSFER_OUT_WITHDRAWAL"),
  })],
  ["an ATM withdrawal with no Plaid code", txn("t-atm-bare", {
    name: "ATM WITHDRAWAL 000123 MAIN ST",
    merchant_name: "Chase",
    merchant_entity_id: "eChase0001",
  })],
  ["a check", txn("t-check", { name: "CHECK 1045" })],
  ["a check with a number sign", txn("t-check2", { name: "CHECK # 1046", ...code("TRANSFER_OUT_WITHDRAWAL") })],
  ["a row with no names at all", txn("t-empty", { name: null, merchant_name: null, merchant_entity_id: "eSomething1" })],
];

const WITH_MERCHANT = [SHELL, QT_NAME_ONLY, ZELLE_JUAN, TRANSFER_JUAN, PAYPAL_CHECKOUT, SQUARE_SELLER, HARDWARE_NO_MERCHANT];

// The rule the edge function would create for "every charge from ...".
const merchantRule = (t: SorterTxn, id = "r-merchant"): SorterRule => {
  const key = personalRuleFor(t).merchant;
  if (!key) throw new Error(`no merchant key for ${t.transaction_id}`);
  return rule(id, { match_kind: key.match_kind, match_value: key.match_value });
};

const sortedWith = (txns: SorterTxn[], rules: SorterRule[]) =>
  new Map(classifyAll(ACCOUNTS, txns, rules, SETTINGS).map((c) => [c.transaction_id, c]));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("personalRuleFor", () => {
  it("uses the entity id for a normal merchant, labelled with its name", () => {
    expect(personalRuleFor(SHELL)).toEqual({
      merchant: { match_kind: "merchant_entity_id", match_value: "eShell0001", label: "Shell" },
    });
  });

  it("uses the merchant name when there is no entity id, keeping Plaid's spelling in the label", () => {
    expect(personalRuleFor(QT_NAME_ONLY)).toEqual({
      merchant: { match_kind: "merchant_name", match_value: "qt", label: "QT" },
    });
  });

  it("uses the description key for a Zelle payment that names its payee, never the Zelle entity id", () => {
    expect(personalRuleFor(ZELLE_JUAN)).toEqual({
      merchant: { match_kind: "description_key", match_value: "zelle payment to juan martinez", label: "Juan Martinez via Zelle" },
    });
  });

  it("uses the description key for a transfer that names its payee", () => {
    expect(personalRuleFor(TRANSFER_JUAN).merchant).toEqual({
      match_kind: "description_key",
      match_value: "online transfer to juan martinez",
      label: "Juan Martinez",
    });
  });

  it("never uses a PayPal entity id or name: the seller in the description is the merchant", () => {
    expect(personalRuleFor(PAYPAL_CHECKOUT).merchant).toEqual({
      match_kind: "description_key",
      match_value: "paypal joestreesupply",
      label: "Joestreesupply via PayPal",
    });
  });

  it("rebuilds a label that carries a code from its words", () => {
    const key = personalRuleFor(SQUARE_SELLER).merchant;
    expect(key?.match_kind).toBe("merchant_name");
    expect(key?.label).toBe("Joes Coffee");
  });

  it("falls back to the description key when a row has no merchant name", () => {
    expect(personalRuleFor(HARDWARE_NO_MERCHANT).merchant).toEqual({
      match_kind: "description_key",
      match_value: "local hardware store",
      label: "Local Hardware Store",
    });
  });

  it.each(NO_PAYEE)("allows only this one for %s", (_label, t) => {
    expect(personalRuleFor(t)).toEqual({ merchant: null });
  });

  it("never shows a raw code in a label", () => {
    for (const t of WITH_MERCHANT) {
      const label = personalRuleFor(t).merchant?.label ?? "";
      expect(label, t.transaction_id).not.toBe("");
      expect(label.length, t.transaction_id).toBeLessThanOrEqual(60);
      expect(/\d{3,}|[#*]|^e[A-Z]/.test(label), `${t.transaction_id}: ${label}`).toBe(false);
      if (t.merchant_entity_id) expect(label).not.toContain(t.merchant_entity_id);
    }
  });

  it("does not depend on whether the row is pending or which account it is on", () => {
    for (const t of WITH_MERCHANT) {
      const base = personalRuleFor(t);
      expect(personalRuleFor({ ...t, pending: true, account_row_id: "card", amount: -12 })).toEqual(base);
    }
  });
});

describe("a rule from personalRuleFor matches in the sorter", () => {
  it.each(WITH_MERCHANT.map((t) => [t.transaction_id, t] as const))("%s is excluded as personal by its own rule", (_id, t) => {
    const r = merchantRule(t);
    const c = sortedWith([t], [r]).get(t.transaction_id);
    expect(c).toMatchObject({ treatment: "excluded", exclude_reason: "personal", classified_by: "user_rule", rule_id: r.id });
  });

  it("also excludes the merchant's next charge, with a new id, amount, date and reference", () => {
    const next = (t: SorterTxn): SorterTxn => ({
      ...t,
      transaction_id: `${t.transaction_id}-next`,
      amount: 61.37,
      txn_date: "2026-09-29",
      name: (t.name ?? "").replace("8XJ2K9QZ", "Q7M4P2ZT").replace("57444", "57991").replace("0423", "0519"),
    });
    for (const t of WITH_MERCHANT) {
      const r = merchantRule(t);
      const c = sortedWith([next(t)], [r]).get(`${t.transaction_id}-next`);
      expect(c?.exclude_reason, t.transaction_id).toBe("personal");
      expect(c?.rule_id, t.transaction_id).toBe(r.id);
    }
  });

  it("never excludes a payment to someone else through the same app", () => {
    const other = txn("t-zelle-ana", { ...ZELLE_JUAN, transaction_id: "t-zelle-ana", name: "Zelle payment to ANA LOPEZ Conf# 7PL2QX" });
    const c = sortedWith([other], [merchantRule(ZELLE_JUAN)]).get("t-zelle-ana");
    expect(c?.exclude_reason).not.toBe("personal");
    expect(c?.treatment).toBe("cost");
  });

  it("agrees with personalRulesMatching for every synthetic row", () => {
    for (const t of [...WITH_MERCHANT, ...NO_PAYEE.map(([, row]) => row)]) {
      const key = personalRuleFor(t).merchant;
      if (!key) continue;
      expect(personalRulesMatching(t, [merchantRule(t)]), t.transaction_id).toEqual(["r-merchant"]);
    }
  });
});

describe("personalRulesMatching (count as business)", () => {
  it("finds the transaction's own rule and its merchant rule, best first, and nothing else", () => {
    const rules = [
      rule("r-merchant", { match_kind: "merchant_entity_id", match_value: "eShell0001" }),
      rule("r-own", { match_kind: "transaction_id", match_value: "t-shell" }),
      rule("r-other-merchant", { match_kind: "merchant_name", match_value: "qt" }),
      rule("r-other-account", { match_kind: "merchant_name", match_value: "shell", account_row_id: "card" }),
      rule("r-category", { rule_type: "set_category", match_kind: "transaction_id", match_value: "t-shell", category_key: "operating" }),
    ];
    expect(personalRulesMatching(SHELL, rules)).toEqual(["r-own", "r-merchant"]);
  });

  it("counts a rule scoped to the transaction's own account", () => {
    const scoped = rule("r-scoped", { match_kind: "merchant_name", match_value: "shell", account_row_id: "chk" });
    expect(personalRulesMatching(SHELL, [scoped])).toEqual(["r-scoped"]);
    expect(personalRulesMatching({ ...SHELL, account_row_id: "card" }, [scoped])).toEqual([]);
  });

  it("follows a rule made on the pending row to the posted row", () => {
    const posted = { ...SHELL, transaction_id: "t-posted", pending_transaction_id: "t-pending" };
    expect(personalRulesMatching(posted, [rule("r-pending", { match_value: "t-pending" })])).toEqual(["r-pending"]);
  });

  it("ignores rules the sorter would never use on a payment-app row (D12 and A10)", () => {
    const rules = [
      rule("r-zelle-entity", { match_kind: "merchant_entity_id", match_value: "eZelle0001" }),
      rule("r-zelle-name", { match_kind: "merchant_name", match_value: "zelle" }),
      rule("r-generic-key", { match_kind: "description_key", match_value: "zelle payment" }),
    ];
    expect(personalRulesMatching(ZELLE_JUAN, rules)).toEqual([]);
    expect(personalRulesMatching(NO_PAYEE[0][1], rules)).toEqual([]);
  });
});
