// Financial Pulse: the transaction sorter (synthetic fixtures only, never real data).
import { describe, expect, it } from "vitest";
import {
  isPaymentAppPayee,
  isPaymentProcessor,
  knownMerchant,
  MERCHANT_RULES_VERSION,
  merchantTexts,
} from "../../../supabase/functions/_shared/pulse/merchantRules";
import { descriptionKey } from "../../../supabase/functions/_shared/pulse/normalize";
import {
  isCardPaymentPfc,
  isPaymentAppTransfer,
  isTransferPfc,
  pfcCategory,
  PFC_DETAILED_CODES,
  PFC_MAP_VERSION,
  PFC_PRIMARY_CODES,
} from "../../../supabase/functions/_shared/pulse/pfcMap";
import {
  CANDIDATES_PER_ROW,
  classifyAll,
  REFUND_LOOKBACK_DAYS,
  SORTER_VERSION,
} from "../../../supabase/functions/_shared/pulse/sorter";
import type {
  Classification,
  SorterAccount,
  SorterRule,
  SorterSettings,
  SorterTxn,
} from "../../../supabase/functions/_shared/pulse/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SETTINGS: SorterSettings = { card_payment_window_days: 5, transfer_window_days: 5 };

const account = (id: string, over: Partial<SorterAccount> = {}): SorterAccount => ({
  id,
  type: "depository",
  subtype: "checking",
  is_business: true,
  include_from: null,
  ...over,
});

const CHK = account("chk");
const CHK2 = account("chk2");
const SAV = account("sav", { subtype: "savings" });
const CARD = account("card", { type: "credit", subtype: "credit card" });
const CARD2 = account("card2", { type: "credit", subtype: "credit card" });
/** A linked PayPal balance: a business depository account run by a payment processor. */
const PP = account("pp", { subtype: "paypal" });
const PERSONAL = account("personal", { is_business: false });
const ACCOUNTS = [CHK, CHK2, SAV, CARD, CARD2, PP, PERSONAL];

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

/** Plaid codes for a detailed category, with its primary. */
const pfc = (detailed: string): Pick<SorterTxn, "pfc_primary" | "pfc_detailed"> => ({
  pfc_primary: PFC_PRIMARY_CODES.find((p) => detailed.startsWith(`${p}_`)) ?? null,
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

interface RunOptions {
  accounts?: SorterAccount[];
  rules?: SorterRule[];
  settings?: SorterSettings;
  keys?: readonly string[];
}

const run = (txns: SorterTxn[], opts: RunOptions = {}): Map<string, Classification> =>
  new Map(
    classifyAll(opts.accounts ?? ACCOUNTS, txns, opts.rules ?? [], opts.settings ?? SETTINGS, opts.keys).map((c) => [
      c.transaction_id,
      c,
    ]),
  );

const get = (m: Map<string, Classification>, id: string): Classification => {
  const c = m.get(id);
  if (!c) throw new Error(`no classification for ${id}`);
  return c;
};

/** The parts of a classification the tests compare. */
const brief = (c: Classification) => ({
  treatment: c.treatment,
  category_key: c.category_key,
  exclude_reason: c.exclude_reason,
  matched_transaction_id: c.matched_transaction_id,
  classified_by: c.classified_by,
  rule_id: c.rule_id,
  review: c.review,
});

const excluded = (reason: Classification["exclude_reason"], by: Classification["classified_by"], extra: Partial<Classification> = {}) => ({
  treatment: "excluded",
  category_key: null,
  exclude_reason: reason,
  matched_transaction_id: null,
  classified_by: by,
  rule_id: null,
  review: false,
  ...extra,
});

const counted = (
  treatment: "cost" | "refund",
  category_key: string,
  by: Classification["classified_by"],
  extra: Partial<Classification> = {},
) => ({
  treatment,
  category_key,
  exclude_reason: null,
  matched_transaction_id: null,
  classified_by: by,
  rule_id: null,
  review: false,
  ...extra,
});

// Deterministic pseudo-random numbers (mulberry32), so every property run can be replayed.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Versions and output shape
// ---------------------------------------------------------------------------

describe("versions and output", () => {
  it("pairs a no-code transfer with QuickBooks Checking or Intuit in both directions (round-4 repro)", () => {
    const pairs: Array<[string, SorterTxn, SorterTxn]> = [
      ["checking to QuickBooks Checking",
        txn("qb-out", { account_row_id: "chk2", txn_date: "2026-09-10", amount: 700, name: "TRANSFER TO CHASE" }),
        txn("qb-in", { account_row_id: "chk", txn_date: "2026-09-10", amount: -700, name: "ONLINE TRANSFER FROM QUICKBOOKS CHECKING" })],
      ["QuickBooks Checking out",
        txn("qb-out", { account_row_id: "chk", txn_date: "2026-09-10", amount: 700, name: "ONLINE TRANSFER TO QUICKBOOKS CHECKING" }),
        txn("qb-in", { account_row_id: "chk2", txn_date: "2026-09-10", amount: -700, name: "TRANSFER FROM CHASE" })],
      ["Intuit",
        txn("qb-out", { account_row_id: "chk", txn_date: "2026-09-10", amount: 700, name: "INTUIT TRANSFER 123" }),
        txn("qb-in", { account_row_id: "chk2", txn_date: "2026-09-11", amount: -700, name: "TRANSFER FROM CHECKING" })],
    ];
    for (const [label, out, inn] of pairs) {
      const r = run([out, inn]);
      expect(get(r, "qb-out").exclude_reason, label).toBe("own_transfer");
      expect(get(r, "qb-in").exclude_reason, label).toBe("own_transfer");
    }
    // A QuickBooks subscription is still a software cost, and never pairs with a plain deposit.
    const sub = txn("qb-sub", { txn_date: "2026-09-10", amount: 90, name: "INTUIT QUICKBOOKS" });
    const dep = txn("dep", { account_row_id: "chk2", txn_date: "2026-09-10", amount: -90, name: "MOBILE DEPOSIT", ...pfc("TRANSFER_IN_DEPOSIT") });
    const r = run([sub, dep]);
    expect(get(r, "qb-sub").treatment).toBe("cost");
    expect(get(r, "dep").exclude_reason).toBe("inflow");
  });

  it("reads 'card' together with a payment word as a card payment, in either order (round-4 repro)", () => {
    for (const name of ["Payment to Chase card ending in 1234 09/06", "CITI CARD ONLINE PAYMENT", "DISCOVER CARD E-PAYMENT"]) {
      const cardPay = txn("pay", { txn_date: "2026-09-06", amount: 1000, name });
      const bill = txn("bill", {
        txn_date: "2026-09-10", amount: 1000, name: "Online Payment 18273645 To ACME TREE SUPPLY 09/10",
        ...pfc("GENERAL_SERVICES_OTHER_GENERAL_SERVICES"),
      });
      const cardIn = txn("card-in", { account_row_id: "card", txn_date: "2026-09-10", amount: -1000, name: "PAYMENT THANK YOU" });
      const r = run([bill, cardIn, cardPay]);
      expect(get(r, "pay").exclude_reason, name).toBe("card_payment");
      expect(get(r, "pay").matched_transaction_id, name).toBe("card-in");
      expect(get(r, "bill").treatment, name).toBe("cost");
    }
    // A debit-card purchase names its card but has no payment word: still a purchase.
    const hd = txn("hd", { txn_date: "2026-09-09", amount: 60, name: "DEBIT CARD PURCHASE THE HOME DEPOT CARD 1234", ...pfc("HOME_IMPROVEMENT_HARDWARE") });
    expect(get(run([hd]), "hd").treatment).toBe("cost");
  });

  it("pins the versions together (bump SORTER_VERSION with any of them)", () => {
    expect(SORTER_VERSION).toBe("sorter-6");
    expect(PFC_MAP_VERSION).toBe("pfc-map-1");
    expect(MERCHANT_RULES_VERSION).toBe("merchant-rules-2");
  });

  it("returns one result per transaction, in input order, never unsorted", () => {
    const txns = [
      txn("b", { amount: 10 }),
      txn("a", { amount: -10 }),
      txn("c", { account_row_id: "personal" }),
      txn("d", { pending: true }),
      txn("e", { amount: 0 }),
    ];
    const out = classifyAll(ACCOUNTS, txns, [], SETTINGS);
    expect(out.map((c) => c.transaction_id)).toEqual(["b", "a", "c", "d", "e"]);
    for (const c of out) {
      expect(c.treatment).not.toBe("unsorted");
      expect(c.sorter_version).toBe(SORTER_VERSION);
    }
    expect(classifyAll(ACCOUNTS, [], [], SETTINGS)).toEqual([]);
  });

  it("counts a zero amount as a cost of nothing, never as a partner", () => {
    const m = run([
      txn("zero-out", { amount: 0, name: "ONLINE TRANSFER TO SAV" }),
      txn("zero-in", { account_row_id: "sav", amount: 0, name: "ONLINE TRANSFER FROM CHK" }),
    ]);
    expect(brief(get(m, "zero-out"))).toEqual(counted("cost", "other", "fallback"));
    expect(get(m, "zero-in").treatment).toBe("cost");
  });
});

// ---------------------------------------------------------------------------
// Step 0: guards
// ---------------------------------------------------------------------------

describe("guards (step 0)", () => {
  it("excludes rows on non-business or unknown accounts", () => {
    const m = run([txn("p", { account_row_id: "personal", amount: 80 }), txn("u", { account_row_id: "gone", amount: 80 })]);
    expect(brief(get(m, "p"))).toEqual(excluded("non_business_account", "guard"));
    expect(brief(get(m, "u"))).toEqual(excluded("non_business_account", "guard"));
  });

  it("excludes pending rows and never uses them as partners", () => {
    const m = run([
      txn("pend-out", { pending: true, amount: 500, name: "ONLINE TRANSFER TO SAV" }),
      txn("in", { account_row_id: "sav", amount: -500, name: "ONLINE TRANSFER FROM CHK", txn_date: "2026-09-16" }),
    ]);
    expect(brief(get(m, "pend-out"))).toEqual(excluded("pending", "guard"));
    expect(brief(get(m, "in"))).toEqual(excluded("inflow", "guard"));
  });

  it("counts from the count-from date: the day before is excluded, the day itself counts", () => {
    const card = account("card", { type: "credit", subtype: "credit card", include_from: "2026-09-15" });
    const m = run(
      [
        txn("before", { account_row_id: "card", txn_date: "2026-09-14", amount: 60 }),
        txn("on", { account_row_id: "card", txn_date: "2026-09-15", amount: 60 }),
        txn("pending-before", { account_row_id: "card", txn_date: "2026-09-14", amount: 60, pending: true }),
      ],
      { accounts: [CHK, card] },
    );
    expect(brief(get(m, "before"))).toEqual(excluded("before_count_from", "guard"));
    expect(get(m, "on").treatment).toBe("cost");
    // Pending comes first (0a before 0b).
    expect(get(m, "pending-before").exclude_reason).toBe("pending");
  });

  it("lets a row before count-from be the partner of a card payment, keeping its own result", () => {
    const card = account("card", { type: "credit", subtype: "credit card", include_from: "2026-09-15" });
    const m = run(
      [
        txn("pay", { txn_date: "2026-09-16", amount: 812.4, name: "CARD SERVICES AUTOPAY" }),
        txn("card-in", { account_row_id: "card", txn_date: "2026-09-14", amount: -812.4, name: "PAYMENT THANK YOU" }),
      ],
      { accounts: [CHK, card] },
    );
    expect(brief(get(m, "pay"))).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "card-in" }));
    expect(brief(get(m, "card-in"))).toEqual(excluded("before_count_from", "guard"));
  });

  it("never pairs two rows that are both before their count-from dates", () => {
    const chkB = account("chk-b", { include_from: "2026-09-10" });
    const savB = account("sav-b", { subtype: "savings", include_from: "2026-09-10" });
    const m = run(
      [
        txn("old-out", { account_row_id: "chk-b", txn_date: "2026-09-05", amount: 300, name: "ONLINE TRANSFER" }),
        txn("old-in", { account_row_id: "sav-b", txn_date: "2026-09-06", amount: -300, name: "ONLINE TRANSFER" }),
        txn("new-in", { account_row_id: "sav", txn_date: "2026-09-07", amount: -300, name: "ONLINE TRANSFER" }),
      ],
      { accounts: [chkB, savB, SAV] },
    );
    expect(get(m, "old-out").exclude_reason).toBe("before_count_from");
    expect(get(m, "old-in").exclude_reason).toBe("before_count_from");
    expect(brief(get(m, "new-in"))).toEqual(excluded("own_transfer", "own_transfer", { matched_transaction_id: "old-out" }));
  });
});

// ---------------------------------------------------------------------------
// Step 1: owner and support rules
// ---------------------------------------------------------------------------

describe("owner and support rules (step 1)", () => {
  const shop = txn("t1", {
    amount: 45,
    name: "PURCHASE AUTHORIZED ON 09/14 ACME SUPPLY #0423",
    merchant_name: "Acme Supply",
    merchant_entity_id: "ent-acme",
  });

  it("excludes a personal item and records the rule", () => {
    const m = run([shop], { rules: [rule("r1", { match_value: "t1" })] });
    expect(brief(get(m, "t1"))).toEqual(excluded("personal", "user_rule", { rule_id: "r1" }));
  });

  it("matches the narrowest key first: transaction_id > description_key > merchant_entity_id = merchant_name", () => {
    // sorter-4 (G3): the description key now comes before the entity id (sorter-3 had the entity id
    // first); the entity id and the merchant name are equal width, so the lower rule id breaks the tie.
    const rules = [
      rule("r-txn", { rule_type: "set_category", match_kind: "transaction_id", match_value: "t1", category_key: "fuel_equipment" }),
      rule("r-desc", { rule_type: "set_category", match_kind: "description_key", match_value: "acme supply", category_key: "operating" }),
      rule("r-ent", { rule_type: "set_category", match_kind: "merchant_entity_id", match_value: "ent-acme", category_key: "job_fees" }),
      rule("r-name", { rule_type: "set_category", match_kind: "merchant_name", match_value: "ACME SUPPLY", category_key: "payroll_contractors" }),
    ];
    const expected = [
      ["r-txn", "fuel_equipment"],
      ["r-desc", "operating"],
      ["r-ent", "job_fees"],
      ["r-name", "payroll_contractors"],
    ];
    for (let i = 0; i < rules.length; i++) {
      const c = get(run([shop], { rules: rules.slice(i) }), "t1");
      expect(brief(c)).toEqual(counted("cost", expected[i][1], "user_rule", { rule_id: expected[i][0] }));
    }
    // Equal width: a merchant-name rule with a lower id beats the entity-id rule.
    const aName = rule("a-name", { rule_type: "set_category", match_kind: "merchant_name", match_value: "ACME SUPPLY", category_key: "other" });
    expect(get(run([shop], { rules: [rules[2], aName] }), "t1").rule_id).toBe("a-name");
  });

  it("orders usable rules in one total order: narrowest key, then exclude_personal, then account-scoped, then lowest id (G3)", () => {
    const setCat = (id: string, kind: SorterRule["match_kind"], value: string, over: Partial<SorterRule> = {}) =>
      rule(id, { rule_type: "set_category", match_kind: kind, match_value: value, category_key: "operating", ...over });
    const personal = (id: string, kind: SorterRule["match_kind"], value: string, over: Partial<SorterRule> = {}) =>
      rule(id, { match_kind: kind, match_value: value, ...over });
    const winner = (rules: SorterRule[]) => get(run([shop], { rules }), "t1").rule_id;
    // Equal width and type: the rule scoped to this account beats a general one, whatever the ids.
    expect(winner([setCat("a-general", "merchant_name", "Acme Supply"), setCat("z-scoped", "merchant_entity_id", "ent-acme", { account_row_id: "chk" })])).toBe("z-scoped");
    // Equal width: a general exclude_personal beats a scoped set_category.
    expect(winner([setCat("a-scoped", "merchant_entity_id", "ent-acme", { account_row_id: "chk" }), personal("z-personal", "merchant_name", "Acme Supply")])).toBe("z-personal");
    // A narrower key beats everything wider: a general set_category by description key beats a
    // scoped exclude_personal by merchant name.
    expect(winner([personal("a-scoped-personal", "merchant_name", "Acme Supply", { account_row_id: "chk" }), setCat("z-desc", "description_key", "acme supply")])).toBe("z-desc");
    // A full tie: the lowest id.
    expect(winner([personal("r-2", "merchant_entity_id", "ent-acme"), personal("r-1", "merchant_name", "Acme Supply")])).toBe("r-1");
    // Guards come before the order: a rule scoped to another account, or on a generic key, is never usable.
    expect(winner([personal("a-other", "description_key", "acme supply", { account_row_id: "sav" }), setCat("z-ent", "merchant_entity_id", "ent-acme")])).toBe("z-ent");
    expect(winner([personal("a-generic", "description_key", "  "), setCat("z-ent", "merchant_entity_id", "ent-acme")])).toBe("z-ent");
  });

  it("picks the description-key set_category over a merchant-name personal rule and an entity-id set_category, in every combination and order (round-3 cycle)", () => {
    // sorter-3 flipped to p-name once s-ent was added: s-ent beat s-desc (entity before
    // description), p-name beat s-ent (equal width), s-desc beat p-name (narrower key).
    const store = txn("t1", { amount: 45, name: "ACME SUPPLY #0423", merchant_name: "Acme Supply", merchant_entity_id: "ent-acme" });
    const sDesc = rule("s-desc", { rule_type: "set_category", match_kind: "description_key", match_value: "acme supply", category_key: "job_fees" });
    const pName = rule("p-name", { match_kind: "merchant_name", match_value: "Acme Supply" });
    const sEnt = rule("s-ent", { rule_type: "set_category", match_kind: "merchant_entity_id", match_value: "ent-acme", category_key: "operating" });
    const permutations = <T,>(items: readonly T[]): T[][] =>
      items.length <= 1 ? [[...items]] : items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
    const all = [sDesc, pName, sEnt];
    let checked = 0;
    for (let mask = 1; mask < 8; mask++) {
      const subset = all.filter((_, i) => mask & (1 << i));
      const want = subset.includes(sDesc)
        ? counted("cost", "job_fees", "user_rule", { rule_id: "s-desc" })
        : subset.includes(pName)
          ? excluded("personal", "user_rule", { rule_id: "p-name" })
          : counted("cost", "operating", "user_rule", { rule_id: "s-ent" });
      for (const order of permutations(subset)) {
        expect(brief(get(run([store], { rules: order }), "t1")), order.map((r) => r.id).join(",")).toEqual(want);
        checked++;
      }
    }
    expect(checked).toBe(15);
  });

  it("applies an account-scoped rule only on that account, and prefers it over a general one", () => {
    const onSav = txn("t2", { account_row_id: "sav", amount: 45, merchant_name: "Acme Supply" });
    const scoped = rule("r-sav", { match_kind: "merchant_name", match_value: "acme supply", account_row_id: "sav" });
    const general = rule("r-all", {
      rule_type: "set_category",
      match_kind: "merchant_name",
      match_value: "acme supply",
      category_key: "operating",
    });
    const m = run([shop, onSav], { rules: [general, scoped] });
    expect(get(m, "t1").rule_id).toBe("r-all");
    expect(brief(get(m, "t2"))).toEqual(excluded("personal", "user_rule", { rule_id: "r-sav" }));
    expect(get(run([shop], { rules: [scoped] }), "t1").classified_by).not.toBe("user_rule");
  });

  it("prefers exclude_personal over set_category on the same key", () => {
    const rules = [
      rule("r-b", { rule_type: "set_category", match_kind: "merchant_entity_id", match_value: "ent-acme", category_key: "operating" }),
      rule("r-a", { rule_type: "exclude_personal", match_kind: "merchant_entity_id", match_value: "ent-acme" }),
    ];
    expect(get(run([shop], { rules }), "t1").exclude_reason).toBe("personal");
  });

  it("falls back to other for a category the company does not have (when the list is given)", () => {
    const r = rule("r1", { rule_type: "set_category", match_value: "t1", category_key: "marketing" });
    expect(get(run([shop], { rules: [r], keys: ["operating", "other"] }), "t1").category_key).toBe("other");
    expect(get(run([shop], { rules: [r], keys: ["marketing", "other"] }), "t1").category_key).toBe("marketing");
    // Without a list, the rule's key is kept as written.
    expect(get(run([shop], { rules: [r] }), "t1").category_key).toBe("marketing");
    // A set_category rule with no key at all lands in other.
    const empty = rule("r2", { rule_type: "set_category", match_value: "t1", category_key: null });
    expect(get(run([shop], { rules: [empty] }), "t1").category_key).toBe("other");
  });

  it("follows a pending row to its posted row through pending_transaction_id", () => {
    const posted = txn("posted-1", { pending_transaction_id: "pend-1", amount: 70 });
    const m = run([posted], { rules: [rule("r1", { match_value: "pend-1" })] });
    expect(brief(get(m, "posted-1"))).toEqual(excluded("personal", "user_rule", { rule_id: "r1" }));
  });

  it("does not apply rules to guarded rows", () => {
    const m = run([txn("t1", { pending: true })], { rules: [rule("r1", { match_value: "t1" })] });
    expect(get(m, "t1").exclude_reason).toBe("pending");
  });

  it("ignores rules on generic keys, so one tap never excludes every payout", () => {
    const pay = (id: string, name: string) => txn(id, { amount: 400, name, merchant_name: "Zelle", ...pfc("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS") });
    const txns = [
      pay("z1", "Zelle payment to JOHN SAMPLE Conf# 8XJ2K9QZ"),
      pay("z2", "Zelle payment to JOHN SAMPLE Conf# 7QW1E3RT"),
      pay("z3", "Zelle payment to JANE EXAMPLE Conf# 5RT6Y7UI"),
    ];
    const generic = [
      rule("r-desc", { match_kind: "description_key", match_value: "zelle payment" }),
      rule("r-name", { match_kind: "merchant_name", match_value: "Zelle" }),
      rule("r-empty", { match_kind: "description_key", match_value: "  " }),
    ];
    const m = run(txns, { rules: generic });
    for (const id of ["z1", "z2", "z3"]) {
      expect(brief(get(m, id))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    }
    // A key that names the payee matches every payment to that payee, and only those.
    const payee = rule("r-john", { match_kind: "description_key", match_value: descriptionKey(txns[0]) });
    const m2 = run(txns, { rules: [...generic, payee] });
    expect(get(m2, "z1").rule_id).toBe("r-john");
    expect(get(m2, "z2").rule_id).toBe("r-john");
    expect(get(m2, "z3").treatment).toBe("cost");
  });

  it("ignores personal rules by entity id or merchant name on payment-app and transfer rows", () => {
    const zelle = (id: string, name: string) =>
      txn(id, { amount: 400, name, merchant_name: "Zelle", merchant_entity_id: "ent-zelle", ...pfc("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS") });
    const txns = [
      zelle("z1", "Zelle payment to OWNER NAME"),
      zelle("z2", "Zelle payment to JOHN SAMPLE"),
      zelle("z3", "Zelle payment to JANE EXAMPLE"),
    ];
    const byEntity = rule("r-ent", { match_kind: "merchant_entity_id", match_value: "ent-zelle" });
    const m = run(txns, { rules: [byEntity] });
    for (const id of ["z1", "z2", "z3"]) {
      expect(brief(get(m, id)), id).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    }
    // The description key keeps the payee, so the owner's own key still works, for that payee only.
    const owner = rule("r-owner", { match_kind: "description_key", match_value: descriptionKey(txns[0]) });
    const m2 = run(txns, { rules: [byEntity, owner] });
    expect(brief(get(m2, "z1"))).toEqual(excluded("personal", "user_rule", { rule_id: "r-owner" }));
    expect(get(m2, "z2").treatment).toBe("cost");
    // A set_category rule on the same entity id still applies: it re-labels, it never excludes.
    const label = rule("r-label", { rule_type: "set_category", match_kind: "merchant_entity_id", match_value: "ent-zelle", category_key: "job_fees" });
    expect(brief(get(run(txns, { rules: [byEntity, label] }), "z2"))).toEqual(counted("cost", "job_fees", "user_rule", { rule_id: "r-label" }));
    // A transfer row too: a personal rule on the bank's entity id or name is ignored.
    const xfer = txn("x1", { amount: 900, name: "ONLINE TRANSFER TO CHK 9999", merchant_name: "Example Bank", merchant_entity_id: "ent-bank" });
    const bankRules = [
      rule("r-bank", { match_kind: "merchant_entity_id", match_value: "ent-bank" }),
      rule("r-bank-name", { match_kind: "merchant_name", match_value: "Example Bank" }),
    ];
    expect(get(run([xfer], { rules: bankRules }), "x1").treatment).toBe("cost");
    // The same rules still exclude an ordinary purchase from that merchant.
    const fee = txn("f1", { amount: 15, name: "MONTHLY SERVICE FEE", merchant_name: "Example Bank", merchant_entity_id: "ent-bank" });
    expect(get(run([fee], { rules: bankRules }), "f1").exclude_reason).toBe("personal");
    // A cash withdrawal is a payout row too: a personal rule on the bank's entity id never excludes it.
    const atm = txn("a1", { amount: 200, name: "ATM WITHDRAWAL", merchant_entity_id: "ent-bank", ...pfc("TRANSFER_OUT_WITHDRAWAL") });
    expect(get(run([atm], { rules: bankRules }), "a1").treatment).toBe("cost");
  });

  it("lets the owner's personal rule beat a set_category rule on a wider or equal key, never a transaction_id one from a wider key", () => {
    // Round-2 note: support re-labels Zelle by its entity id; the owner marks one payee as personal.
    const zelle = txn("z-owner", { amount: 400, name: "Zelle payment to OWNER NAME", merchant_entity_id: "ent-zelle" });
    const support = rule("sup", {
      rule_type: "set_category",
      match_kind: "merchant_entity_id",
      match_value: "ent-zelle",
      category_key: "payroll_contractors",
    });
    const owner = rule("own", { match_kind: "description_key", match_value: "zelle payment to owner name" });
    expect(brief(get(run([zelle], { rules: [support, owner] }), "z-owner"))).toEqual(excluded("personal", "user_rule", { rule_id: "own" }));
    // An equal key: a set_category rule on the same description key loses too, even scoped to this account.
    const sameKey = rule("label", {
      rule_type: "set_category",
      match_kind: "description_key",
      match_value: "zelle payment to owner name",
      account_row_id: "chk",
      category_key: "job_fees",
    });
    expect(get(run([zelle], { rules: [sameKey, owner] }), "z-owner").rule_id).toBe("own");
    // A set_category rule by transaction_id is never overridden.
    const byId = rule("by-id", { rule_type: "set_category", match_value: "z-owner", category_key: "job_fees" });
    expect(brief(get(run([zelle], { rules: [support, owner, byId] }), "z-owner"))).toEqual(
      counted("cost", "job_fees", "user_rule", { rule_id: "by-id" }),
    );

    // On an ordinary purchase: a personal rule on the merchant name beats a set_category rule on the
    // entity id (equal width), but a set_category rule on the narrower description key beats it.
    const shop = txn("t1", { amount: 45, name: "ACME SUPPLY #0423", merchant_name: "Acme Supply", merchant_entity_id: "ent-acme" });
    const personalName = rule("p-name", { match_kind: "merchant_name", match_value: "Acme Supply" });
    const byEntity = rule("s-ent", { rule_type: "set_category", match_kind: "merchant_entity_id", match_value: "ent-acme", category_key: "operating" });
    const byDesc = rule("s-desc", { rule_type: "set_category", match_kind: "description_key", match_value: "acme supply", category_key: "operating" });
    expect(brief(get(run([shop], { rules: [byEntity, personalName] }), "t1"))).toEqual(excluded("personal", "user_rule", { rule_id: "p-name" }));
    expect(brief(get(run([shop], { rules: [byDesc, personalName] }), "t1"))).toEqual(counted("cost", "operating", "user_rule", { rule_id: "s-desc" }));
  });

  it("treats Square Cash and Apple Cash as payment apps whose names are generic keys", () => {
    const m = run(
      [
        txn("sq", { amount: 50, name: "SQUARE CASH JOHN SAMPLE", merchant_name: "Square Cash" }),
        txn("ap", { amount: 50, name: "APPLE CASH SENT MONEY", merchant_name: "Apple Cash" }),
      ],
      {
        rules: [
          rule("r-sq", { match_kind: "merchant_name", match_value: "Square Cash" }),
          rule("r-ap", { match_kind: "merchant_name", match_value: "Apple Cash" }),
        ],
      },
    );
    expect(brief(get(m, "sq"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(brief(get(m, "ap"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
  });

  it("normalizes rule values: a raw description or a short merchant name still matches", () => {
    const pay = txn("z1", { amount: 400, name: "Zelle payment to JOHN SAMPLE Conf# 8XJ2K9QZ" });
    const typed = rule("r-typed", { match_kind: "description_key", match_value: "ZELLE PAYMENT TO JOHN SAMPLE conf# 1QA2WS3E" });
    expect(get(run([pay], { rules: [typed] }), "z1").rule_id).toBe("r-typed");
    const fuel = txn("f1", { amount: 60, merchant_name: "76" });
    const byName = rule("r-76", { match_kind: "merchant_name", match_value: " 76 " });
    expect(get(run([fuel], { rules: [byName] }), "f1").exclude_reason).toBe("personal");
  });

  it("wins over pairing: a rule-decided row is not a partner", () => {
    const m = run(
      [
        txn("out", { amount: 250, name: "ONLINE TRANSFER TO SAV" }),
        txn("in", { account_row_id: "sav", amount: -250, name: "ONLINE TRANSFER FROM CHK" }),
      ],
      { rules: [rule("r1", { match_value: "out" })] },
    );
    expect(get(m, "out").exclude_reason).toBe("personal");
    expect(brief(get(m, "in"))).toEqual(excluded("inflow", "guard"));
  });

  it("turns money in into a refund only by transaction_id, or once step 4 agrees", () => {
    const payout = txn("payout", { amount: -1800, name: "JOBBER PAYMENTS PAYOUT", merchant_name: "Jobber" });
    const cardRefund = txn("card-refund", { account_row_id: "card", amount: -49, name: "JOBBER SUBSCRIPTION", merchant_name: "Jobber" });
    const byName = rule("r-name", { rule_type: "set_category", match_kind: "merchant_name", match_value: "jobber", category_key: "operating" });
    const m = run([payout, cardRefund], { rules: [byName] });
    expect(brief(get(m, "payout"))).toEqual(excluded("inflow", "guard"));
    expect(brief(get(m, "card-refund"))).toEqual(counted("refund", "operating", "user_rule", { rule_id: "r-name" }));

    const byId = rule("r-id", { rule_type: "set_category", match_value: "payout", category_key: "other" });
    expect(brief(get(run([payout], { rules: [byId] }), "payout"))).toEqual(counted("refund", "other", "user_rule", { rule_id: "r-id" }));
  });
});

// ---------------------------------------------------------------------------
// Step 2: own transfers
// ---------------------------------------------------------------------------

describe("own transfers (step 2)", () => {
  const out = (id: string, date: string, over: Partial<SorterTxn> = {}) =>
    txn(id, { txn_date: date, amount: 1000, name: "ONLINE TRANSFER TO SAV", ...over });
  const inn = (id: string, date: string, over: Partial<SorterTxn> = {}) =>
    txn(id, { account_row_id: "sav", txn_date: date, amount: -1000, name: "ONLINE TRANSFER FROM CHK", ...over });

  it("excludes both sides and links them", () => {
    const m = run([out("o", "2026-09-10"), inn("i", "2026-09-11")]);
    expect(brief(get(m, "o"))).toEqual(excluded("own_transfer", "own_transfer", { matched_transaction_id: "i" }));
    expect(brief(get(m, "i"))).toEqual(excluded("own_transfer", "own_transfer", { matched_transaction_id: "o" }));
  });

  it("accepts a transfer code on either side, or transfer / xfer in the name", () => {
    const plain = { name: "ACME" };
    expect(get(run([out("o", "2026-09-10", { ...plain, ...pfc("TRANSFER_OUT_ACCOUNT_TRANSFER") }), inn("i", "2026-09-10", plain)]), "o").exclude_reason).toBe("own_transfer");
    expect(get(run([out("o", "2026-09-10", plain), inn("i", "2026-09-10", { ...plain, ...pfc("TRANSFER_IN_ACCOUNT_TRANSFER") })]), "o").exclude_reason).toBe("own_transfer");
    expect(get(run([out("o", "2026-09-10", { name: "ONLINE XFER 1234" }), inn("i", "2026-09-10", plain)]), "o").exclude_reason).toBe("own_transfer");
    // No signal on either side: not a transfer.
    const m = run([out("o", "2026-09-10", plain), inn("i", "2026-09-10", plain)]);
    expect(get(m, "o").treatment).toBe("cost");
    expect(get(m, "i").exclude_reason).toBe("inflow");
  });

  it("needs two different business depository accounts", () => {
    const same = run([out("o", "2026-09-10"), inn("i", "2026-09-10", { account_row_id: "chk" })]);
    expect(get(same, "o").treatment).toBe("cost");
    const personal = run([out("o", "2026-09-10"), inn("i", "2026-09-10", { account_row_id: "personal" })]);
    expect(get(personal, "o").treatment).toBe("cost");
    // A card inflow is never an own transfer; step 3 treats it as a card payment instead.
    const card = run([out("o", "2026-09-10"), inn("i", "2026-09-10", { account_row_id: "card" })]);
    expect(get(card, "o").exclude_reason).toBe("card_payment");
  });

  it("pairs 4 days apart but not 6 with a 5-day window (5 is inside)", () => {
    expect(get(run([out("o", "2026-09-10"), inn("i", "2026-09-14")]), "o").exclude_reason).toBe("own_transfer");
    expect(get(run([out("o", "2026-09-10"), inn("i", "2026-09-15")]), "o").exclude_reason).toBe("own_transfer");
    const far = run([out("o", "2026-09-10", pfc("TRANSFER_OUT_ACCOUNT_TRANSFER")), inn("i", "2026-09-16")]);
    // Unmatched transfer out: counted, flagged for review.
    expect(brief(get(far, "o"))).toEqual(counted("cost", "other", "pfc", { review: true }));
    expect(brief(get(far, "i"))).toEqual(excluded("inflow", "guard"));
  });

  it("amounts must match to the cent", () => {
    const m = run([out("o", "2026-09-10", { amount: 1000.01 }), inn("i", "2026-09-10")]);
    expect(get(m, "o").treatment).toBe("cost");
  });

  it("picks the same partner whatever the input order (equal amounts, equal gaps)", () => {
    const txns = [out("out-1", "2026-09-10"), inn("in-b", "2026-09-11"), inn("in-a", "2026-09-11")];
    const rand = rng(7);
    for (let i = 0; i < 20; i++) {
      const m = run(shuffle(txns, rand));
      expect(get(m, "out-1").matched_transaction_id).toBe("in-a");
      expect(get(m, "in-a").matched_transaction_id).toBe("out-1");
      expect(brief(get(m, "in-b"))).toEqual(excluded("inflow", "guard"));
    }
  });

  it("prefers the smallest date gap over the transaction id order", () => {
    const m = run([out("o", "2026-09-10"), inn("a", "2026-09-12"), inn("z", "2026-09-11")]);
    expect(get(m, "o").matched_transaction_id).toBe("z");
  });

  it("uses each transaction at most once", () => {
    const m = run([out("o1", "2026-09-10"), out("o2", "2026-09-10"), inn("i1", "2026-09-10"), inn("i2", "2026-09-11")]);
    expect(get(m, "o1").matched_transaction_id).toBe("i1");
    expect(get(m, "o2").matched_transaction_id).toBe("i2");
    expect(get(m, "i2").matched_transaction_id).toBe("o2");
  });

  it("prefers a pair named like a transfer on both sides over a closer pair with one", () => {
    const m = run([out("o", "2026-09-10"), inn("a-plain", "2026-09-10", { name: "ACME" }), inn("b-named", "2026-09-12")]);
    expect(get(m, "o").matched_transaction_id).toBe("b-named");
    expect(brief(get(m, "a-plain"))).toEqual(excluded("inflow", "guard"));
  });

  it("never pairs a payment app, or a payment processor against a row that is not a transfer (round-1 cases)", () => {
    const fromApps = pfc("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS");
    // (a) A Zelle contractor payment and a mobile deposit into savings two days later.
    const a = run([
      txn("zelle", { txn_date: "2026-09-10", amount: 500, name: "Zelle payment to JOHN SAMPLE", ...fromApps }),
      txn("dep", { account_row_id: "sav", txn_date: "2026-09-12", amount: -500, name: "MOBILE DEPOSIT", ...pfc("TRANSFER_IN_DEPOSIT") }),
    ]);
    expect(brief(get(a, "zelle"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(brief(get(a, "dep"))).toEqual(excluded("inflow", "guard"));
    // (b) A supplier cost and a Stripe payout named "transfer" into the other checking account.
    const b = run([
      txn("acme", { txn_date: "2026-09-10", amount: 250, name: "ACME SUPPLY", ...pfc("HOME_IMPROVEMENT_HARDWARE") }),
      txn("stripe", { account_row_id: "chk2", txn_date: "2026-09-11", amount: -250, name: "STRIPE TRANSFER ST-X1Y2Z3" }),
    ]);
    expect(brief(get(b, "acme"))).toEqual(counted("cost", "fuel_equipment", "pfc"));
    expect(brief(get(b, "stripe"))).toEqual(excluded("inflow", "guard"));
    // (c) A Zelle payment and a Jobber payout on the same day.
    const c = run([
      txn("zelle", { txn_date: "2026-09-10", amount: 740, name: "Zelle payment to JOHN SAMPLE", ...fromApps }),
      txn("payout", { account_row_id: "chk2", txn_date: "2026-09-10", amount: -740, name: "JOBBER PAYMENTS PAYOUT" }),
    ]);
    expect(brief(get(c, "zelle"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(brief(get(c, "payout"))).toEqual(excluded("inflow", "guard"));
    // The payment-app code alone is no transfer signal either, and a transfer-named payout on the
    // other side does not make one.
    const d = run([
      out("o", "2026-09-10", { name: "ACME", ...fromApps }),
      inn("i", "2026-09-10", { account_row_id: "chk2", name: "PAYPAL TRANSFER" }),
    ]);
    expect(get(d, "o").category_key).toBe("payroll_contractors");
    expect(get(d, "i").exclude_reason).toBe("inflow");
  });

  it("never pairs a cash or check deposit or withdrawal, or a dump fee, with a cost (round-2 repros 1 to 4)", () => {
    const deposit = pfc("TRANSFER_IN_DEPOSIT");
    // 1. A supplier cost from the second checking account and a customer's mobile deposit two days later.
    const m1 = run([
      txn("supplier", { account_row_id: "chk2", txn_date: "2026-09-10", amount: 500, name: "ACME TREE SUPPLY", ...pfc("HOME_IMPROVEMENT_HARDWARE") }),
      txn("deposit", { txn_date: "2026-09-12", amount: -500, name: "MOBILE DEPOSIT", ...deposit }),
    ]);
    expect(brief(get(m1, "supplier"))).toEqual(counted("cost", "fuel_equipment", "pfc"));
    expect(brief(get(m1, "deposit"))).toEqual(excluded("inflow", "guard"));
    // 2. A crew member paid by check from the payroll account, and a customer's check deposited the next day.
    const m2 = run([
      txn("check", { account_row_id: "chk2", txn_date: "2026-09-10", amount: 1200, name: "CHECK 1043" }),
      txn("deposit", { txn_date: "2026-09-11", amount: -1200, name: "DEPOSIT", ...deposit }),
    ]);
    expect(brief(get(m2, "check"))).toEqual(counted("cost", "other", "fallback"));
    expect(brief(get(m2, "deposit"))).toEqual(excluded("inflow", "guard"));
    // 3. ATM cash for the crew and a remote deposit on the same day (the withdrawal keeps its map review).
    const m3 = run([
      txn("atm", { account_row_id: "chk2", txn_date: "2026-09-10", amount: 400, name: "ATM WITHDRAWAL", ...pfc("TRANSFER_OUT_WITHDRAWAL") }),
      txn("deposit", { txn_date: "2026-09-10", amount: -400, name: "REMOTE DEPOSIT", ...deposit }),
    ]);
    expect(brief(get(m3, "atm"))).toEqual(counted("cost", "other", "pfc", { review: true }));
    expect(brief(get(m3, "deposit"))).toEqual(excluded("inflow", "guard"));
    // 4. A dump fee at a transfer station and a mobile deposit into savings two days later.
    const m4 = run([
      txn("dump", { txn_date: "2026-09-10", amount: 250, name: "CLEVELAND COUNTY TRANSFER STATION", ...pfc("RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT") }),
      txn("deposit", { account_row_id: "sav", txn_date: "2026-09-12", amount: -250, name: "MOBILE DEPOSIT", ...deposit }),
    ]);
    expect(brief(get(m4, "dump"))).toEqual(counted("cost", "job_fees", "pfc"));
    expect(brief(get(m4, "deposit"))).toEqual(excluded("inflow", "guard"));
  });

  it("never reads a transfer word as a signal on a row Plaid reads as spending or a known merchant (round-3 finding 1, G1)", () => {
    const deposit = pfc("TRANSFER_IN_DEPOSIT");
    const waste = pfc("RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT");
    const cases: Array<[string, number, Pick<SorterTxn, "pfc_primary" | "pfc_detailed">, string]> = [
      ["NORMAN RECYCLING AND TRANSFER CENTER", 250, waste, "job_fees"],
      ["WM TRANSFER FACILITY", 250, waste, "job_fees"],
      ["CITY SOLID WASTE TRANSFER", 250, waste, "job_fees"],
      ["WIRE TRANSFER FEE", 25, pfc("BANK_FEES_OTHER_BANK_FEES"), "operating"],
    ];
    for (const [name, amount, codes, category] of cases) {
      const m = run([
        txn("cost", { txn_date: "2026-09-10", amount, name, ...codes }),
        txn("deposit", { account_row_id: "sav", txn_date: "2026-09-12", amount: -amount, name: "MOBILE DEPOSIT", ...deposit }),
      ]);
      expect(brief(get(m, "cost")), name).toEqual(counted("cost", category, "pfc"));
      expect(brief(get(m, "deposit")), name).toEqual(excluded("inflow", "guard"));
    }
    // A known merchant named like a transfer, with no Plaid code: a payroll cost, not a transfer.
    const gusto = run([
      txn("gusto", { txn_date: "2026-09-10", amount: 900, name: "GUSTO NET TRANSFER 123456" }),
      txn("deposit", { account_row_id: "sav", txn_date: "2026-09-12", amount: -900, name: "MOBILE DEPOSIT", ...deposit }),
    ]);
    expect(brief(get(gusto, "gusto"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(brief(get(gusto, "deposit"))).toEqual(excluded("inflow", "guard"));
    // A transfer code still counts on such a row, and the name still counts with no code.
    const coded = run([out("o", "2026-09-10", { name: "WIRE TRANSFER FEE", ...pfc("TRANSFER_OUT_WIRE") }), inn("i", "2026-09-10", { name: "ACME" })]);
    expect(get(coded, "o").exclude_reason).toBe("own_transfer");
    const named = run([out("o", "2026-09-10", { name: "ONLINE TRANSFER TO SAV" }), inn("i", "2026-09-11", { name: "MOBILE DEPOSIT", ...deposit })]);
    expect(get(named, "o").exclude_reason).toBe("own_transfer");
  });

  it("with a transfer signal on one side only, never takes a spending row as the other side", () => {
    const outCode = pfc("TRANSFER_OUT_ACCOUNT_TRANSFER");
    // A named transfer out against money in that Plaid reads as a purchase, or from a known merchant.
    for (const other of [
      { name: "ACME", ...pfc("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE") },
      { name: "ACME", ...pfc("INCOME_OTHER") },
      { name: "SHELL OIL 57442341234" },
    ]) {
      const m = run([out("o", "2026-09-10", outCode), inn("i", "2026-09-10", other)]);
      expect(brief(get(m, "o")), other.name).toEqual(counted("cost", "other", "pfc", { review: true }));
      expect(brief(get(m, "i")), other.name).toEqual(excluded("inflow", "guard"));
    }
    // A supplier cost against a named transfer in.
    const m = run([out("o", "2026-09-10", { name: "ACME TREE SUPPLY", ...pfc("HOME_IMPROVEMENT_HARDWARE") }), inn("i", "2026-09-10")]);
    expect(brief(get(m, "o"))).toEqual(counted("cost", "fuel_equipment", "pfc"));
    expect(brief(get(m, "i"))).toEqual(excluded("inflow", "guard"));
    // A deposit code is no signal, but not spending either: it can be the other half of a named
    // transfer (kept on purpose, G5: a check moved between the owner's accounts is a real own
    // transfer; the header's known limits list the cost).
    const named = run([out("o", "2026-09-10", outCode), inn("i", "2026-09-11", { name: "MOBILE DEPOSIT", ...pfc("TRANSFER_IN_DEPOSIT") })]);
    expect(brief(get(named, "o"))).toEqual(excluded("own_transfer", "own_transfer", { matched_transaction_id: "i" }));
  });

  it("reads transfer and xfer as whole words, never a transfer station, TransferWise or a balance transfer", () => {
    const plain = { name: "ACME" };
    for (const name of ["ONLINE TRANSFER TO SAV", "ONLINE XFER 1234", "INTERNET TFR TO SAVINGS", "XFR TO CHK 9999", "E-TRANSFER SENT"]) {
      expect(get(run([out("o", "2026-09-10", { name }), inn("i", "2026-09-10", plain)]), "o").exclude_reason, name).toBe("own_transfer");
    }
    for (const name of ["CLEVELAND COUNTY TRANSFER STATION", "TRANSFERWISE INC", "BALANCE TRANSFER", "BAL XFER", "XFERSTORE 12"]) {
      const m = run([out("o", "2026-09-10", { name }), inn("i", "2026-09-10", plain)]);
      expect(brief(get(m, "o")), name).toEqual(counted("cost", "other", "fallback"));
      expect(get(m, "i").exclude_reason, name).toBe("inflow");
    }
  });

  it("pairs a linked processor-run account (PayPal balance, Square or QuickBooks Checking) when both sides read as a transfer", () => {
    const outCode = pfc("TRANSFER_OUT_ACCOUNT_TRANSFER");
    const inCode = pfc("TRANSFER_IN_ACCOUNT_TRANSFER");
    const layouts: Array<[string, SorterTxn, SorterTxn]> = [
      [
        "PayPal balance to checking",
        txn("x-out", { account_row_id: "pp", txn_date: "2026-09-10", amount: 500, name: "TRANSFER TO BANK", merchant_name: "PayPal", ...outCode }),
        txn("x-in", { txn_date: "2026-09-11", amount: -500, name: "PAYPAL TRANSFER", counterparty_type: "payment_app", ...inCode }),
      ],
      [
        "checking to PayPal balance",
        txn("x-out", { txn_date: "2026-09-10", amount: 800, name: "PAYPAL TRANSFER", ...outCode }),
        txn("x-in", { account_row_id: "pp", txn_date: "2026-09-11", amount: -800, name: "ADD FUNDS FROM BANK", ...inCode }),
      ],
      [
        "Square Checking to checking",
        txn("x-out", { account_row_id: "chk2", txn_date: "2026-09-10", amount: 1200, name: "TRANSFER TO CHASE CHECKING", ...outCode }),
        txn("x-in", { txn_date: "2026-09-10", amount: -1200, name: "SQUARE INC TRANSFER", ...inCode }),
      ],
      [
        "QuickBooks Checking to checking",
        txn("x-out", { account_row_id: "chk2", txn_date: "2026-09-10", amount: 700, name: "ONLINE TRANSFER TO CHK 1234", ...outCode }),
        txn("x-in", { txn_date: "2026-09-10", amount: -700, name: "ONLINE TRANSFER FROM QUICKBOOKS CHECKING", ...inCode }),
      ],
    ];
    for (const [label, o, i] of layouts) {
      const m = run([o, i]);
      expect(brief(get(m, "x-out")), label).toEqual(excluded("own_transfer", "own_transfer", { matched_transaction_id: "x-in" }));
      expect(brief(get(m, "x-in")), label).toEqual(excluded("own_transfer", "own_transfer", { matched_transaction_id: "x-out" }));
    }
  });

  it("still never pairs a processor side unless both sides read as a transfer, nor a payment app", () => {
    const outCode = pfc("TRANSFER_OUT_ACCOUNT_TRANSFER");
    const inCode = pfc("TRANSFER_IN_ACCOUNT_TRANSFER");
    // A PayPal checkout from the PayPal balance and a PayPal transfer into checking.
    const checkout = run([
      txn("pp-buy", { account_row_id: "pp", txn_date: "2026-09-10", amount: 500, name: "PAYPAL *TREEPARTS", ...pfc("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE") }),
      txn("chk-in", { txn_date: "2026-09-11", amount: -500, name: "PAYPAL TRANSFER", ...inCode }),
    ]);
    expect(brief(get(checkout, "pp-buy"))).toEqual(counted("cost", "other", "pfc"));
    expect(brief(get(checkout, "chk-in"))).toEqual(excluded("inflow", "guard"));
    // A Stripe payout named transfer against an outflow with no signal (and no spending code).
    const payout = run([
      txn("acme", { txn_date: "2026-09-10", amount: 250, name: "ACME" }),
      txn("stripe", { account_row_id: "chk2", txn_date: "2026-09-11", amount: -250, name: "STRIPE TRANSFER ST-X1Y2Z3", ...inCode }),
    ]);
    expect(brief(get(payout, "acme"))).toEqual(counted("cost", "other", "fallback"));
    expect(brief(get(payout, "stripe"))).toEqual(excluded("inflow", "guard"));
    // A Zelle payment named transfer is a payment-app row, even when both sides read as a transfer.
    const zelle = run([
      txn("zelle", { txn_date: "2026-09-10", amount: 600, name: "Zelle transfer to JOHN SAMPLE", ...outCode }),
      txn("in", { account_row_id: "sav", txn_date: "2026-09-10", amount: -600, name: "ONLINE TRANSFER FROM CHK", ...inCode }),
    ]);
    expect(brief(get(zelle, "zelle"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(get(zelle, "in").exclude_reason).toBe("inflow");
    // Counterparty type payment_app on a row that names no processor never pairs.
    const typed = run([
      txn("typed", { txn_date: "2026-09-10", amount: 700, name: "ONLINE TRANSFER TO SAV", counterparty_type: "payment_app", ...outCode }),
      txn("in", { account_row_id: "sav", txn_date: "2026-09-10", amount: -700, name: "ONLINE TRANSFER FROM CHK", ...inCode }),
    ]);
    expect(get(typed, "typed").exclude_reason).toBeNull();
    expect(get(typed, "in").exclude_reason).toBe("inflow");
  });

  it("treats every row on a PayPal balance as processor-named (round-3 note, G4)", () => {
    // The PayPal side names no processor and carries counterparty type payment_app; the account
    // (subtype paypal) makes it processor-named, and both sides carry a transfer code.
    const m = run([
      txn("pp-out", {
        account_row_id: "pp",
        txn_date: "2026-09-10",
        amount: 500,
        name: "TRANSFER TO BANK",
        counterparty_type: "payment_app",
        ...pfc("TRANSFER_OUT_ACCOUNT_TRANSFER"),
      }),
      txn("chk-in", { txn_date: "2026-09-11", amount: -500, name: "PAYPAL TRANSFER", ...pfc("TRANSFER_IN_ACCOUNT_TRANSFER") }),
    ]);
    expect(brief(get(m, "pp-out"))).toEqual(excluded("own_transfer", "own_transfer", { matched_transaction_id: "chk-in" }));
    expect(brief(get(m, "chk-in"))).toEqual(excluded("own_transfer", "own_transfer", { matched_transaction_id: "pp-out" }));
    // Processor-named also means a PayPal-balance row pairs only when both sides carry a signal:
    // a plain row on it is never the unsignalled half of a named transfer.
    const oneSide = run([
      txn("o", { txn_date: "2026-09-10", amount: 300, name: "ONLINE TRANSFER TO SAV" }),
      txn("pp-in", { account_row_id: "pp", txn_date: "2026-09-10", amount: -300, name: "ACME" }),
    ]);
    expect(brief(get(oneSide, "o"))).toEqual(counted("cost", "other", "fallback", { review: true }));
    expect(brief(get(oneSide, "pp-in"))).toEqual(excluded("inflow", "guard"));
  });
});

// ---------------------------------------------------------------------------
// Step 3: card payments
// ---------------------------------------------------------------------------

describe("card payments (step 3)", () => {
  const pay = (id: string, date: string, over: Partial<SorterTxn> = {}) =>
    txn(id, { txn_date: date, amount: 1234.56, name: "CARD SERVICES ONLINE PMT", ...over });
  const cardIn = (id: string, date: string, over: Partial<SorterTxn> = {}) =>
    txn(id, { account_row_id: "card", txn_date: date, amount: -1234.56, name: "AUTOMATIC PAYMENT - THANK YOU", ...over });

  it("pairs a checking outflow with a card inflow across a month boundary", () => {
    const m = run([pay("p", "2026-09-29"), cardIn("c", "2026-10-02")]);
    expect(brief(get(m, "p"))).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "c" }));
    expect(brief(get(m, "c"))).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "p" }));
  });

  it("pairs 4 days apart but not 6 with a 5-day window", () => {
    expect(get(run([pay("p", "2026-09-10"), cardIn("c", "2026-09-14")]), "p").matched_transaction_id).toBe("c");
    const far = run([pay("p", "2026-09-10"), cardIn("c", "2026-09-16")]);
    // No card-payment code on the checking side: it stays counted.
    expect(get(far, "p").treatment).toBe("cost");
    // The card side still looks like a payment: excluded, flagged.
    expect(brief(get(far, "c"))).toEqual(excluded("card_payment", "card_payment", { review: true }));
  });

  it("picks the same card partner whatever the input order (equal amounts, equal gaps)", () => {
    const txns = [pay("p", "2026-09-10"), cardIn("c-2", "2026-09-12"), cardIn("c-1", "2026-09-08")];
    const rand = rng(11);
    for (let i = 0; i < 20; i++) {
      const m = run(shuffle(txns, rand));
      expect(get(m, "p").matched_transaction_id).toBe("c-1");
      expect(brief(get(m, "c-2"))).toEqual(excluded("card_payment", "card_payment", { review: true }));
    }
  });

  it("never trusts the card side's code for pairing", () => {
    const m = run([pay("p", "2026-09-10"), cardIn("c", "2026-09-11", { name: "ACME", ...pfc("FOOD_AND_DRINK_RESTAURANT") })]);
    expect(get(m, "p").matched_transaction_id).toBe("c");
    expect(get(m, "c").exclude_reason).toBe("card_payment");
  });

  it("treats a card-side INCOME_SALARY as a payment, never income or a refund", () => {
    const salary = { name: "ACME", ...pfc("INCOME_SALARY") };
    const paired = run([pay("p", "2026-09-10"), cardIn("c", "2026-09-12", salary)]);
    expect(get(paired, "c").matched_transaction_id).toBe("p");
    const alone = run([cardIn("c", "2026-09-12", salary)]);
    expect(brief(get(alone, "c"))).toEqual(excluded("card_payment", "card_payment", { review: true }));
  });

  it("excludes an unmatched checking card payment with a warning", () => {
    const m = run([pay("p", "2026-09-10", pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"))]);
    expect(brief(get(m, "p"))).toEqual(excluded("card_payment", "card_payment", { review: true }));
  });

  it("recognises unmatched card-side payments by name or code", () => {
    for (const over of [
      { name: "PAYMENT RECEIVED" },
      { name: "AUTOPAY 260910" },
      { name: "ONLINE PYMT" },
      { name: "PMT" },
      { name: "THANK YOU" },
      { name: "ACME", ...pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") },
      { name: "ACME", ...pfc("TRANSFER_IN_ACCOUNT_TRANSFER") },
      { name: "ACME", pfc_primary: "INCOME", pfc_detailed: null },
    ]) {
      expect(get(run([cardIn("c", "2026-09-10", over)]), "c").exclude_reason, JSON.stringify(over)).toBe("card_payment");
    }
  });

  it("runs after own transfers", () => {
    const m = run([
      txn("o", { amount: 500, name: "ONLINE TRANSFER TO SAV" }),
      txn("s", { account_row_id: "sav", amount: -500, name: "ONLINE TRANSFER FROM CHK" }),
      txn("c", { account_row_id: "card", amount: -500, name: "ACME SUPPLY RETURN" }),
    ]);
    expect(get(m, "o").matched_transaction_id).toBe("s");
    expect(get(m, "c").treatment).toBe("refund");
  });

  it("pairs the real card payment, never a Zelle payment, whatever the dates and ids", () => {
    const autopay = (date: string) =>
      txn("b-autopay", { txn_date: date, amount: 1000, name: "CHASE CREDIT CRD AUTOPAY", ...pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") });
    const zelle = (date: string) =>
      txn("a-zelle", { txn_date: date, amount: 1000, name: "Zelle payment to JOHN SAMPLE", ...pfc("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS") });
    const card = cardIn("card-in", "2026-09-10", { amount: -1000, name: "PAYMENT THANK YOU" });
    const layouts = [
      ["2026-09-08", "2026-09-10"], // the Zelle is closer
      ["2026-09-10", "2026-09-08"], // the autopay is closer
      ["2026-09-10", "2026-09-10"], // equal gaps: the Zelle's id sorts first
    ];
    const rand = rng(3);
    for (const [autopayDate, zelleDate] of layouts) {
      for (let i = 0; i < 6; i++) {
        const m = run(shuffle([autopay(autopayDate), zelle(zelleDate), card], rand));
        const label = `autopay ${autopayDate}, zelle ${zelleDate}`;
        expect(brief(get(m, "b-autopay")), label).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "card-in" }));
        expect(brief(get(m, "card-in")), label).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "b-autopay" }));
        expect(brief(get(m, "a-zelle")), label).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
      }
    }
    // With no real payment in the data, the Zelle stays a cost and the card side is flagged.
    const alone = run([zelle("2026-09-10"), card]);
    expect(brief(get(alone, "a-zelle"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(brief(get(alone, "card-in"))).toEqual(excluded("card_payment", "card_payment", { review: true }));
  });

  it("ranks the bank side: a payment name, then a plain outflow, then a payment processor", () => {
    const card = cardIn("c", "2026-09-10", { amount: -300, name: "PAYMENT THANK YOU" });
    const plain = txn("plain", { txn_date: "2026-09-10", amount: 300, name: "ACME SUPPLY" });
    const named = txn("named", { txn_date: "2026-09-13", amount: 300, name: "CARD SERVICES ONLINE PMT" });
    const processor = txn("jobber", { txn_date: "2026-09-10", amount: 300, name: "JOBBER", merchant_name: "Jobber" });
    expect(get(run([plain, named, card]), "c").matched_transaction_id).toBe("named");
    expect(get(run([processor, plain, card]), "c").matched_transaction_id).toBe("plain");
    // A processor still pairs when nothing better is there (a card paid under a processor's name).
    expect(get(run([processor, card]), "c").matched_transaction_id).toBe("jobber");
  });

  it("orders the bank-side tiers: the code, card words, a bare payment word, plain, a processor", () => {
    const card = cardIn("c", "2026-09-10", { amount: -300, name: "PAYMENT THANK YOU" });
    // Each weaker tier is closer to the card payment than every stronger one.
    const tiers = [
      txn("t0-code", { txn_date: "2026-09-06", amount: 300, name: "ACME", ...pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") }),
      txn("t1-words", { txn_date: "2026-09-07", amount: 300, name: "CITI AUTOPAY" }),
      txn("t2-payment", { txn_date: "2026-09-08", amount: 300, name: "ONLINE PMT 1234" }),
      txn("t3-plain", { txn_date: "2026-09-09", amount: 300, name: "ACME SUPPLY" }),
      txn("t4-processor", { txn_date: "2026-09-10", amount: 300, name: "JOBBER", merchant_name: "Jobber" }),
    ];
    for (let i = 0; i < tiers.length; i++) {
      const m = run([...tiers.slice(i), card]);
      expect(get(m, "c").matched_transaction_id, tiers[i].transaction_id).toBe(tiers[i].transaction_id);
    }
    // Every piece of card-payment wording ranks above a bare payment word.
    const vsPayment = (name: string) =>
      get(run([txn("words", { txn_date: "2026-09-06", amount: 300, name }), txn("payment", { txn_date: "2026-09-10", amount: 300, name: "ONLINE PAYMENT" }), card]), "c")
        .matched_transaction_id;
    for (const name of ["CREDIT CARD PAYMENT", "CITI CREDITCARD 0423", "CHASE CRD EPAY", "BARCLAYS CARD PMT", "US BANK CARD PAYMENT", "CARD SERVICES ONLINE", "AUTOPAY 260910", "THANK YOU"]) {
      expect(vsPayment(name), name).toBe("words");
    }
    // sorter-4 (G2): a bare "card" is not card-payment wording, and neither is any word outside the
    // list ("CARDMEMBER SERV WEB PYMT" is a bare payment word now, tier 2, so the closer row wins).
    for (const name of ["PURCHASE AUTHORIZED ON 09/08 ACME CARD 1234", "DEBIT CARD 1234 ACME", "CARDMEMBER SERV WEB PYMT", "AUTOPAYMENT 0423"]) {
      expect(vsPayment(name), name).toBe("payment");
    }
  });

  it("never ranks a debit-card purchase above a card payment named only PMT (round-3 note, G2)", () => {
    const hardware = pfc("HOME_IMPROVEMENT_HARDWARE");
    const layouts: Array<[string, string]> = [
      ["2026-09-09", "2026-09-06"], // the purchase is closer (the round-3 probe)
      ["2026-09-06", "2026-09-09"], // the payment is closer
    ];
    for (const [buyDate, payDate] of layouts) {
      const m = run([
        txn("hd", { txn_date: buyDate, amount: 1000, name: "PURCHASE AUTHORIZED ON 09/08 THE HOME DEPOT #0423 CARD 1234", ...hardware }),
        txn("capone", { txn_date: payDate, amount: 1000, name: "CAPITAL ONE MOBILE PMT" }),
        txn("card-in", { account_row_id: "card", txn_date: "2026-09-10", amount: -1000, name: "CAPITAL ONE MOBILE PYMT" }),
      ]);
      expect(brief(get(m, "capone")), buyDate).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "card-in" }));
      expect(brief(get(m, "card-in")), buyDate).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "capone" }));
      expect(brief(get(m, "hd")), buyDate).toEqual(counted("cost", "fuel_equipment", "pfc"));

      // The same with "DEBIT CARD PURCHASE" against a Discover e-payment.
      const d = run([
        txn("debit", { txn_date: buyDate, amount: 1000, name: "DEBIT CARD PURCHASE 09/08 ACME TREE SUPPLY", ...hardware }),
        txn("discover", { txn_date: payDate, amount: 1000, name: "DISCOVER E-PAYMENT 7788" }),
        txn("card-in", { account_row_id: "card", txn_date: "2026-09-10", amount: -1000, name: "INTERNET PAYMENT - THANK YOU" }),
      ]);
      expect(brief(get(d, "discover")), buyDate).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "card-in" }));
      expect(brief(get(d, "debit")), buyDate).toEqual(counted("cost", "fuel_equipment", "pfc"));
    }
  });

  it("never ranks a bank row with a spending code above tier 2, so a bill named autopay loses to a code-less card payment (G2)", () => {
    const card = cardIn("card-in", "2026-09-10", { amount: -1000, name: "PAYMENT THANK YOU" });
    const geico = (date: string) => txn("a-geico", { txn_date: date, amount: 1000, name: "GEICO AUTOPAY 260910", ...pfc("GENERAL_SERVICES_INSURANCE") });
    const chase = (date: string) => txn("b-chase", { txn_date: date, amount: 1000, name: "CHASE CREDIT CRD AUTOPAY" });
    const rand = rng(31);
    for (const [geicoDate, chaseDate] of [
      ["2026-09-10", "2026-09-06"], // the bill is closer
      ["2026-09-06", "2026-09-10"], // the card payment is closer
      ["2026-09-10", "2026-09-10"], // equal gaps: the bill's id sorts first
    ]) {
      for (let i = 0; i < 4; i++) {
        const m = run(shuffle([geico(geicoDate), chase(chaseDate), card], rand));
        const label = `geico ${geicoDate}, chase ${chaseDate}`;
        expect(brief(get(m, "b-chase")), label).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "card-in" }));
        expect(brief(get(m, "a-geico")), label).toEqual(counted("cost", "operating", "pfc"));
      }
    }
    // Capped at tier 2, not dropped: with a bare payment word as the only rival, the closer row wins,
    // and a loan payment code is never capped.
    const bill = (date: string) => txn("bill", { txn_date: date, amount: 1000, name: "ONLINE PMT 0423" });
    expect(get(run([geico("2026-09-09"), bill("2026-09-06"), card]), "card-in").matched_transaction_id).toBe("a-geico");
    expect(get(run([geico("2026-09-06"), bill("2026-09-09"), card]), "card-in").matched_transaction_id).toBe("bill");
    const loan = txn("loan", { txn_date: "2026-09-06", amount: 1000, name: "AMEX AUTOPAY", ...pfc("LOAN_PAYMENTS_OTHER_PAYMENT") });
    expect(get(run([loan, bill("2026-09-09"), card]), "card-in").matched_transaction_id).toBe("loan");
  });

  it("pairs the real card payment, never a bill payment or an insurance payment, in both date layouts (round-2 repro)", () => {
    const card = cardIn("card-in", "2026-09-10", { amount: -1000, name: "PAYMENT THANK YOU" });
    const autopay = (date: string) =>
      txn("autopay", { txn_date: date, amount: 1000, name: "CHASE CARD AUTOPAY", ...pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") });
    const billpay = (date: string) =>
      txn("billpay", { txn_date: date, amount: 1000, name: "Online Payment 18273645 To ACME TREE SUPPLY 09/10", ...pfc("GENERAL_SERVICES_OTHER_GENERAL_SERVICES") });
    const crd = (date: string) => txn("autopay", { txn_date: date, amount: 1000, name: "CHASE CREDIT CRD AUTOPAY" });
    const insurance = (date: string) =>
      txn("billpay", { txn_date: date, amount: 1000, name: "STATE FARM INSURANCE PAYMENT", ...pfc("GENERAL_SERVICES_INSURANCE") });
    const rand = rng(21);
    for (const [pay, bill] of [
      [autopay, billpay],
      [crd, insurance],
    ] as const) {
      for (const [payDate, billDate] of [
        ["2026-09-06", "2026-09-10"], // the bill payment is closer
        ["2026-09-10", "2026-09-06"], // the card payment is closer
      ]) {
        for (let i = 0; i < 4; i++) {
          const m = run(shuffle([pay(payDate), bill(billDate), card], rand));
          const label = `${pay(payDate).name} ${payDate}, ${bill(billDate).name} ${billDate}`;
          expect(brief(get(m, "autopay")), label).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "card-in" }));
          expect(brief(get(m, "card-in")), label).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "autopay" }));
          expect(brief(get(m, "billpay")), label).toEqual(counted("cost", "operating", "pfc"));
        }
      }
    }
  });

  it("prefers a card inflow that looks like a payment over a refund of the same size", () => {
    const m = run([
      pay("p", "2026-09-10", { amount: 80 }),
      cardIn("a-return", "2026-09-10", { amount: -80, name: "ACME SUPPLY RETURN", merchant_name: "Acme Supply" }),
      cardIn("b-pay", "2026-09-12", { amount: -80, name: "PAYMENT THANK YOU" }),
    ]);
    expect(get(m, "p").matched_transaction_id).toBe("b-pay");
    expect(brief(get(m, "a-return"))).toEqual(counted("refund", "other", "fallback"));
  });

  it("does not take a card refund for a payment because the merchant's name says payment", () => {
    const m = run([
      cardIn("r1", "2026-09-10", { amount: -80, name: "ACME PAYMENT SYSTEMS REFUND" }),
      cardIn("r2", "2026-09-11", { amount: -80, name: "SQUARE PAYMENTS REFUND" }),
    ]);
    expect(brief(get(m, "r1"))).toEqual(counted("refund", "other", "fallback"));
    expect(brief(get(m, "r2"))).toEqual(counted("refund", "other", "fallback"));
  });

  it("pairs a returned card payment: a card outflow with the card-payment code and the bank's return", () => {
    const returned = txn("card-ret", {
      account_row_id: "card",
      txn_date: "2026-09-13",
      amount: 1000,
      name: "PAYMENT RETURNED",
      ...pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
    });
    const m = run([returned, txn("chk-ret", { txn_date: "2026-09-13", amount: -1000, name: "RETURNED ITEM CHASE CARD" })]);
    expect(brief(get(m, "card-ret"))).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "chk-ret" }));
    expect(brief(get(m, "chk-ret"))).toEqual(excluded("card_payment", "card_payment", { matched_transaction_id: "card-ret" }));
    // Money in that does not read like a return is never its partner: the card outflow stays counted.
    for (const over of [
      { name: "MOBILE DEPOSIT", ...pfc("TRANSFER_IN_DEPOSIT") },
      { name: "JOBBER PAYMENTS RETURN" },
    ]) {
      const other = run([returned, txn("in", { txn_date: "2026-09-13", amount: -1000, ...over })]);
      expect(brief(get(other, "card-ret")), over.name).toEqual(counted("cost", "other", "pfc"));
      expect(get(other, "in").exclude_reason, over.name).toBe("inflow");
    }
  });
});

// ---------------------------------------------------------------------------
// Step 4: money in
// ---------------------------------------------------------------------------

describe("money in (step 4)", () => {
  const buy = (id: string, date: string, amount: number, over: Partial<SorterTxn> = {}) =>
    txn(id, { txn_date: date, amount, name: "ACME SUPPLY #0423", merchant_name: "Acme Supply", ...pfc("HOME_IMPROVEMENT_HARDWARE"), ...over });
  const back = (id: string, date: string, amount: number, over: Partial<SorterTxn> = {}) =>
    txn(id, { txn_date: date, amount, name: "ACME SUPPLY RETURN", merchant_name: "ACME SUPPLY", ...pfc("HOME_IMPROVEMENT_HARDWARE"), ...over });

  it("makes every other card inflow a refund, with the merchant's category", () => {
    const m = run([
      txn("sw", { account_row_id: "card", amount: -40, name: "ADOBE *CREATIVE CLD" }),
      txn("hw", { account_row_id: "card", amount: -15, name: "ACME", ...pfc("GENERAL_MERCHANDISE_ELECTRONICS") }),
      txn("x", { account_row_id: "card", amount: -9, name: "ACME" }),
    ]);
    expect(brief(get(m, "sw"))).toEqual(counted("refund", "operating", "merchant_rule"));
    expect(brief(get(m, "hw"))).toEqual(counted("refund", "operating", "pfc"));
    expect(brief(get(m, "x"))).toEqual(counted("refund", "other", "fallback"));
  });

  it("makes a bank inflow a refund when it follows a counted purchase at the same merchant", () => {
    const m = run([buy("b", "2026-09-01", 120), back("r", "2026-09-20", -120)]);
    expect(brief(get(m, "r"))).toEqual(counted("refund", "fuel_equipment", "pfc"));
    // Matched by merchant_entity_id when the names differ.
    const byEntity = run([
      buy("b", "2026-09-01", 120, { merchant_entity_id: "ent-1" }),
      back("r", "2026-09-02", -50, { merchant_entity_id: "ent-1", merchant_name: "Different Name" }),
    ]);
    expect(get(byEntity, "r").treatment).toBe("refund");
    // Same day counts.
    expect(get(run([buy("b", "2026-09-01", 120), back("r", "2026-09-01", -120)]), "r").treatment).toBe("refund");
  });

  it("keeps a bank inflow excluded when it is larger, too late, earlier, or elsewhere", () => {
    const cases: SorterTxn[][] = [
      [buy("b", "2026-09-01", 120), back("r", "2026-09-02", -120.01)],
      [buy("b", "2026-06-01", 120), back("r", "2026-08-31", -120)], // 91 days
      [buy("b", "2026-09-10", 120), back("r", "2026-09-09", -120)], // before the purchase
      [buy("b", "2026-09-01", 120), back("r", "2026-09-02", -120, { merchant_name: "Other Shop" })],
    ];
    for (const txns of cases) expect(get(run(txns), "r").exclude_reason).toBe("inflow");
    // 90 days is still inside.
    expect(REFUND_LOOKBACK_DAYS).toBe(90);
    expect(get(run([buy("b", "2026-06-02", 120), back("r", "2026-08-31", -120)]), "r").treatment).toBe("refund");
  });

  it("never refunds more than the purchase across several refunds", () => {
    const over = run([buy("b", "2026-09-01", 100), back("r1", "2026-09-02", -60), back("r2", "2026-09-03", -60)]);
    expect(get(over, "r1").treatment).toBe("refund");
    expect(get(over, "r2").exclude_reason).toBe("inflow");
    const within = run([buy("b", "2026-09-01", 100), back("r1", "2026-09-02", -60), back("r2", "2026-09-03", -40)]);
    expect(get(within, "r2").treatment).toBe("refund");
  });

  it("only refunds a purchase that was counted", () => {
    const m = run([buy("b", "2026-09-01", 120), back("r", "2026-09-02", -120)], { rules: [rule("r1", { match_value: "b" })] });
    expect(get(m, "r").exclude_reason).toBe("inflow");
  });

  it("keeps a Jobber payout excluded, even after a Jobber charge of the same size", () => {
    const m = run([
      txn("sub", { txn_date: "2026-09-01", amount: 1800, name: "JOBBER SUBSCRIPTION", merchant_name: "Jobber" }),
      txn("payout", { txn_date: "2026-09-05", amount: -1800, name: "JOBBER PAYMENTS PAYOUT", merchant_name: "Jobber" }),
    ]);
    expect(get(m, "sub").category_key).toBe("operating");
    expect(brief(get(m, "payout"))).toEqual(excluded("inflow", "guard"));
  });

  it("never refunds money from payment processors or apps", () => {
    const earlier = (merchant: string) => txn("b", { txn_date: "2026-09-01", amount: 300, merchant_name: merchant });
    for (const [merchant, over] of [
      ["Stripe", { name: "STRIPE TRANSFER" }],
      ["Square", { name: "SQUARE INC" }],
      ["PayPal", { name: "PAYPAL TRANSFER" }],
      ["Venmo", { name: "VENMO CASHOUT" }],
      ["Acme", { name: "ACME", counterparty_type: "payment_app" }],
      ["Acme", { name: "ACME", ...pfc("TRANSFER_IN_TRANSFER_IN_FROM_APPS") }],
    ] as const) {
      const m = run([earlier(merchant), txn("in", { txn_date: "2026-09-02", amount: -300, merchant_name: merchant, ...over })]);
      expect(get(m, "in").exclude_reason, merchant).toBe("inflow");
    }
  });

  it("on a card, money in from a processor or payment app is still a refund (they never pay out to a card)", () => {
    const m = run([
      txn("paypal", { account_row_id: "card", amount: -300, name: "PAYPAL TRANSFER", merchant_name: "PayPal" }),
      txn("venmo", { account_row_id: "card", amount: -120, name: "VENMO CASHOUT" }),
      txn("app", { account_row_id: "card", amount: -75, name: "ACME", counterparty_type: "payment_app" }),
    ]);
    expect(brief(get(m, "paypal"))).toEqual(counted("refund", "other", "fallback"));
    expect(brief(get(m, "venmo"))).toEqual(counted("refund", "other", "fallback"));
    expect(brief(get(m, "app"))).toEqual(counted("refund", "other", "fallback"));
  });

  it("never refunds one purchase twice: a card refund uses it up before a bank inflow can", () => {
    const purchase = txn("buy", { account_row_id: "card", txn_date: "2026-09-01", amount: 100, merchant_name: "Acme Supply" });
    const cardRefund = (date: string) => txn("card-ref", { account_row_id: "card", txn_date: date, amount: -100, merchant_name: "Acme Supply" });
    const rebate = (date: string) => txn("rebate", { txn_date: date, amount: -100, name: "ACME SUPPLY REBATE", merchant_name: "Acme Supply" });
    // The bank inflow comes after the card refund, or before it: either way only the card refund counts.
    for (const [refundDate, rebateDate] of [["2026-09-03", "2026-09-05"], ["2026-09-04", "2026-09-02"]]) {
      const m = run([purchase, cardRefund(refundDate), rebate(rebateDate)]);
      expect(get(m, "card-ref").treatment).toBe("refund");
      expect(brief(get(m, "rebate")), rebateDate).toEqual(excluded("inflow", "guard"));
    }
    // Without the card refund, the bank inflow refunds the purchase.
    expect(get(run([purchase, rebate("2026-09-05")]), "rebate").treatment).toBe("refund");
  });

  it("lets a card credit use up only a purchase on the same card (round-2 repro)", () => {
    // A checking purchase, its bank refund two days later, and an unrelated card credit weeks later.
    const m = run([
      txn("buy", { txn_date: "2026-09-01", amount: 100, name: "ACME SUPPLY", merchant_name: "Acme Supply" }),
      txn("bref", { txn_date: "2026-09-03", amount: -100, name: "ACME SUPPLY REFUND", merchant_name: "Acme Supply" }),
      txn("cref", { account_row_id: "card", txn_date: "2026-09-25", amount: -100, name: "ACME SUPPLY", merchant_name: "Acme Supply" }),
    ]);
    expect(brief(get(m, "buy"))).toEqual(counted("cost", "other", "fallback"));
    expect(brief(get(m, "bref"))).toEqual(counted("refund", "other", "fallback"));
    expect(brief(get(m, "cref"))).toEqual(counted("refund", "other", "fallback"));
    // Nor a purchase on another card: the bank rebate still refunds the purchase on the second card.
    const other = run([
      txn("buy2", { account_row_id: "card2", txn_date: "2026-09-01", amount: 100, merchant_name: "Acme Supply" }),
      txn("cref", { account_row_id: "card", txn_date: "2026-09-03", amount: -100, merchant_name: "Acme Supply" }),
      txn("rebate", { txn_date: "2026-09-05", amount: -100, name: "ACME SUPPLY REBATE", merchant_name: "Acme Supply" }),
    ]);
    expect(get(other, "cref").treatment).toBe("refund");
    expect(brief(get(other, "rebate"))).toEqual(counted("refund", "other", "fallback"));
  });

  it("never counts other money in as revenue or a refund", () => {
    const m = run([
      txn("dep", { amount: -2500, name: "MOBILE DEPOSIT", ...pfc("TRANSFER_IN_DEPOSIT") }),
      txn("int", { amount: -1.12, name: "INTEREST PAYMENT", ...pfc("INCOME_INTEREST_EARNED") }),
    ]);
    expect(brief(get(m, "dep"))).toEqual(excluded("inflow", "guard"));
    expect(brief(get(m, "int"))).toEqual(excluded("inflow", "guard"));
  });
});

// ---------------------------------------------------------------------------
// Steps 5 to 7: merchants, Plaid categories, fallback
// ---------------------------------------------------------------------------

describe("loan payments (step 5; Joe Evans, 2026-10-06: not a cost)", () => {
  const LOAN_CODES = PFC_DETAILED_CODES.filter((c) => c.startsWith("LOAN_PAYMENTS_") && c !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");

  it("leaves every loan-payment code out of costs, on the bank and on the card, and with only the primary code", () => {
    expect(LOAN_CODES.length).toBeGreaterThanOrEqual(8);
    const txns = LOAN_CODES.flatMap((code) => [
      txn(`bank-${code}`, { amount: 450, name: "ACME FINANCE", ...pfc(code) }),
      txn(`card-${code}`, { account_row_id: "card", amount: 450, name: "ACME FINANCE", ...pfc(code) }),
    ]);
    txns.push(txn("primary-only", { amount: 450, name: "ACME FINANCE", pfc_primary: "LOAN_PAYMENTS", pfc_detailed: null }));
    const m = run(txns);
    for (const t of txns) expect(brief(get(m, t.transaction_id)), t.transaction_id).toEqual(excluded("loan_payment", "pfc"));
  });

  it("the loan code wins over the category map (a truck loan is not fuel and equipment), and a software name can be a lender's", () => {
    const m = run([
      txn("truck", { amount: 650, name: "ALLY AUTO PAYMENT", ...pfc("LOAN_PAYMENTS_CAR_PAYMENT") }),
      txn("qb-loan", { amount: 420, name: "INTUIT QUICKBOOKS CAPITAL LOAN PMT", ...pfc("LOAN_PAYMENTS_OTHER_PAYMENT") }),
    ]);
    expect(brief(get(m, "truck"))).toEqual(excluded("loan_payment", "pfc"));
    expect(brief(get(m, "qb-loan"))).toEqual(excluded("loan_payment", "pfc"));
  });

  it("a known merchant that never lends keeps its category, whatever Plaid's code says", () => {
    const code = pfc("LOAN_PAYMENTS_OTHER_PAYMENT");
    const m = run([
      txn("sunbelt", { amount: 900, name: "SUNBELT RENTALS #0412", ...code }),
      txn("wex", { amount: 812.4, name: "WEX INC FLEET PMT", ...code }),
      txn("gusto", { amount: 5200, name: "GUSTO NET 123456", ...code }),
    ]);
    expect(brief(get(m, "sunbelt"))).toEqual(counted("cost", "job_fees", "merchant_rule"));
    expect(brief(get(m, "wex"))).toEqual(counted("cost", "fuel_equipment", "merchant_rule"));
    expect(brief(get(m, "gusto"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
  });

  it("a lease is a running cost: Plaid's car-payment code covers leases, and they stay counted", () => {
    const code = pfc("LOAN_PAYMENTS_CAR_PAYMENT");
    const m = run([
      txn("lease", { amount: 1450, name: "FORD CREDIT LEASE PMT", ...code }),
      txn("leasing", { amount: 1450, name: "ACH DEBIT", merchant_name: "Penske Truck Leasing", ...code }),
      txn("lessor", { amount: 1450, name: "ACH DEBIT", counterparty_name: "ACME EQUIPMENT LEASES", ...code }),
      txn("release", { amount: 300, name: "RELEASE FEE FINANCE CO", ...code }),
    ]);
    for (const id of ["lease", "leasing", "lessor"]) expect(brief(get(m, id)), id).toEqual(counted("cost", "fuel_equipment", "pfc"));
    // A whole word only: "release" is not a lease.
    expect(brief(get(m, "release"))).toEqual(excluded("loan_payment", "pfc"));
  });

  it("a loan payment never takes a card payment's or a refund's place (step 3)", () => {
    const loan = (date: string) => txn("loan", { txn_date: date, amount: 650, name: "ALLY AUTO PAYMENT", ...pfc("LOAN_PAYMENTS_CAR_PAYMENT") });
    const amex = (date: string) => txn("amex", { txn_date: date, amount: 650, name: "AMEX EPAYMENT ACH PMT" });
    const cardPay = txn("card-pay", { account_row_id: "card", txn_date: "2026-09-11", amount: -650, name: "PAYMENT THANK YOU" });
    // The loan is closer to the card payment, but the bill payment of the same tier pairs.
    for (const [l, a] of [["2026-09-10", "2026-09-08"], ["2026-09-08", "2026-09-10"]] as const) {
      const m = run([loan(l), amex(a), cardPay]);
      expect(get(m, "card-pay").matched_transaction_id, `${l} ${a}`).toBe("amex");
      expect(brief(get(m, "loan")), `${l} ${a}`).toEqual(excluded("loan_payment", "pfc"));
    }
    // A card refund of the same amount stays a refund of its purchase; the loan stays a loan payment.
    const m = run([
      loan("2026-09-10"),
      txn("buy", { account_row_id: "card", txn_date: "2026-09-05", amount: 650, name: "THE HOME DEPOT", ...pfc("HOME_IMPROVEMENT_HARDWARE") }),
      txn("refund", { account_row_id: "card", txn_date: "2026-09-12", amount: -650, name: "THE HOME DEPOT", ...pfc("HOME_IMPROVEMENT_HARDWARE") }),
    ]);
    expect(get(m, "refund").treatment).toBe("refund");
    expect(brief(get(m, "loan"))).toEqual(excluded("loan_payment", "pfc"));
  });

  it("never treats a payment-app row as a loan payment: payouts stay counted", () => {
    const m = run([
      txn("zelle", { amount: 300, name: "Zelle payment to JOHN SAMPLE", ...pfc("LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT") }),
      txn("app-type", { amount: 300, name: "ACME", counterparty_type: "payment_app", ...pfc("LOAN_PAYMENTS_OTHER_PAYMENT") }),
    ]);
    expect(brief(get(m, "zelle"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(get(m, "app-type").treatment).toBe("cost");
  });

  it("keeps card payments on their own handling: pairs first, and the card-payment code is never a loan payment", () => {
    const loan = txn("loan", { txn_date: "2026-09-06", amount: 1000, name: "AMEX AUTOPAY", ...pfc("LOAN_PAYMENTS_OTHER_PAYMENT") });
    const card = txn("card-in", { account_row_id: "card", txn_date: "2026-09-08", amount: -1000, name: "PAYMENT THANK YOU" });
    const paired = run([loan, card]);
    expect(get(paired, "loan").exclude_reason).toBe("card_payment");
    expect(get(paired, "loan").matched_transaction_id).toBe("card-in");
    expect(brief(get(run([loan]), "loan"))).toEqual(excluded("loan_payment", "pfc"));
    const code = txn("cc", { amount: 1000, name: "CHASE CARD AUTOPAY", ...pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") });
    expect(brief(get(run([code]), "cc"))).toEqual(excluded("card_payment", "card_payment", { review: true }));
  });

  it("rules and guards come first; money in and $0 are never loan payments", () => {
    const code = pfc("LOAN_PAYMENTS_OTHER_PAYMENT");
    const m = run(
      [
        txn("tapped", { amount: 200, ...code }),
        txn("relabelled", { amount: 200, ...code }),
        txn("pending", { amount: 200, pending: true, ...code }),
        txn("before", { account_row_id: "card", txn_date: "2026-08-01", amount: 200, ...code }),
        txn("zero", { amount: 0, ...code }),
        txn("out", { txn_date: "2026-09-10", amount: 450, name: "ACME FINANCE", merchant_name: "Acme Finance", ...code }),
        txn("back", { txn_date: "2026-09-12", amount: -450, name: "ACME FINANCE", merchant_name: "Acme Finance", ...code }),
      ],
      {
        accounts: [CHK, { ...CARD, include_from: "2026-09-01" }],
        rules: [
          rule("r-own", { match_value: "tapped" }),
          rule("r-cat", { rule_type: "set_category", match_value: "relabelled", category_key: "fuel_equipment" }),
        ],
      },
    );
    expect(brief(get(m, "tapped"))).toEqual(excluded("personal", "user_rule", { rule_id: "r-own" }));
    expect(brief(get(m, "relabelled"))).toEqual(counted("cost", "fuel_equipment", "user_rule", { rule_id: "r-cat" }));
    expect(get(m, "pending").exclude_reason).toBe("pending");
    expect(get(m, "before").exclude_reason).toBe("before_count_from");
    expect(get(m, "zero").treatment).toBe("cost");
    expect(brief(get(m, "out"))).toEqual(excluded("loan_payment", "pfc"));
    // The loan payment was never a cost, so money back from the lender is not a refund of it.
    expect(brief(get(m, "back"))).toEqual(excluded("inflow", "guard"));
  });
});

describe("merchants, Plaid categories and fallback (steps 5 to 7)", () => {
  it("sends payment-app outflows to payroll and contractors", () => {
    const m = run([
      txn("app-code", { amount: 300, name: "ACME", ...pfc("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS") }),
      txn("app-type", { amount: 300, name: "ACME", counterparty_type: "payment_app" }),
      txn("zelle", { amount: 300, name: "Zelle payment to JOHN SHELL Conf# 8XJ2K9QZ", ...pfc("TRANSFER_OUT_ACCOUNT_TRANSFER") }),
      txn("venmo", { amount: 300, name: "VENMO *JANE EXAMPLE" }),
      txn("cashapp", { amount: 300, name: "CASH APP*JOHN SAMPLE" }),
    ]);
    for (const id of ["app-code", "app-type", "zelle", "venmo", "cashapp"]) {
      expect(brief(get(m, id)), id).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    }
  });

  it("uses known merchants before the Plaid category", () => {
    const m = run([
      txn("gusto", { amount: 5200, name: "GUSTO DES:NET 123456", ...pfc("TRANSFER_OUT_ACCOUNT_TRANSFER") }),
      txn("sunbelt", { amount: 640, name: "SUNBELT RENTALS #0412", ...pfc("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE") }),
      txn("adobe", { account_row_id: "card", amount: 59.99, name: "ADOBE *CREATIVE CLD", ...pfc("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE") }),
      txn("shell", { amount: 88.1, name: "SHELL OIL 57442341234", ...pfc("FOOD_AND_DRINK_FAST_FOOD") }),
    ]);
    expect(brief(get(m, "gusto"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(get(m, "sunbelt").category_key).toBe("job_fees");
    expect(get(m, "adobe").category_key).toBe("operating");
    expect(get(m, "shell").category_key).toBe("fuel_equipment");
  });

  it("uses known merchants before the payment-app code and counterparty type, but after an app payee name", () => {
    const m = run([
      txn("pp-adobe", {
        account_row_id: "card",
        amount: 59.99,
        name: "PAYPAL *ADOBE",
        merchant_name: "Adobe",
        counterparty_type: "payment_app",
        ...pfc("GENERAL_SERVICES_OTHER_GENERAL_SERVICES"),
      }),
      txn("app-gusto", { amount: 800, name: "GUSTO PAY 123456", ...pfc("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS") }),
      // The payee after an app name is a person: "JOHN SHELL" is not a fuel station.
      txn("zelle-shell", { amount: 300, name: "Zelle payment to JOHN SHELL", ...pfc("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS") }),
    ]);
    expect(brief(get(m, "pp-adobe"))).toEqual(counted("cost", "operating", "merchant_rule"));
    expect(brief(get(m, "app-gusto"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    expect(brief(get(m, "zelle-shell"))).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
  });

  it("sends a payment_app counterparty to payroll only when Plaid did not read it as a purchase", () => {
    const checkout = (id: string, over: Partial<SorterTxn>) =>
      txn(id, { amount: 45, name: "PAYPAL *UNKNOWNSHOP", counterparty_type: "payment_app", ...over });
    const m = run([
      checkout("card-buy", { account_row_id: "card", ...pfc("GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE") }),
      checkout("bank-buy", pfc("GENERAL_MERCHANDISE_ONLINE_MARKETPLACES")),
      checkout("no-code", {}),
      checkout("transfer-out", pfc("TRANSFER_OUT_ACCOUNT_TRANSFER")),
      checkout("primary-only", { pfc_primary: "TRANSFER_OUT", pfc_detailed: null }),
    ]);
    expect(brief(get(m, "card-buy"))).toEqual(counted("cost", "other", "pfc"));
    expect(brief(get(m, "bank-buy"))).toEqual(counted("cost", "operating", "pfc"));
    for (const id of ["no-code", "transfer-out", "primary-only"]) {
      expect(brief(get(m, id)), id).toEqual(counted("cost", "payroll_contractors", "merchant_rule"));
    }
  });

  it("uses the Plaid category map next, detailed code first", () => {
    const m = run([
      txn("dump", { amount: 75, name: "ACME", ...pfc("RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT") }),
      txn("primary", { amount: 75, name: "ACME", pfc_primary: "TRANSPORTATION", pfc_detailed: null }),
      txn("card-side", { account_row_id: "card", amount: 75, name: "ACME", ...pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") }),
    ]);
    expect(brief(get(m, "dump"))).toEqual(counted("cost", "job_fees", "pfc"));
    expect(brief(get(m, "primary"))).toEqual(counted("cost", "fuel_equipment", "pfc"));
    // Money out of a card is spending, whatever its code says.
    expect(brief(get(m, "card-side"))).toEqual(counted("cost", "other", "pfc"));
  });

  it("always counts an unmatched transfer out, flagged for review", () => {
    for (const code of ["TRANSFER_OUT_ACCOUNT_TRANSFER", "TRANSFER_OUT_WIRE", "TRANSFER_OUT_SAVINGS", "TRANSFER_OUT_WITHDRAWAL"]) {
      const m = run([txn("t", { amount: 900, name: "ONLINE TRANSFER TO EXTERNAL", ...pfc(code) })]);
      expect(brief(get(m, "t")), code).toEqual(counted("cost", "other", "pfc", { review: true }));
    }
  });

  it("flags a transfer out known only by its name, on a bank account whose Plaid code is missing or a transfer", () => {
    const m = run([
      txn("no-code", { amount: 900, name: "ONLINE TRANSFER TO CHK 9999" }),
      txn("in-code", { amount: 900, name: "ONLINE XFER TO EXTERNAL", ...pfc("TRANSFER_IN_ACCOUNT_TRANSFER") }),
      txn("other-code", { amount: 900, name: "ONLINE XFER TO EXTERNAL", ...pfc("GENERAL_SERVICES_OTHER_GENERAL_SERVICES") }),
      txn("card", { account_row_id: "card", amount: 900, name: "ONLINE TRANSFER" }),
      txn("zero", { amount: 0, name: "ONLINE TRANSFER TO CHK 9999" }),
    ]);
    expect(brief(get(m, "no-code"))).toEqual(counted("cost", "other", "fallback", { review: true }));
    expect(brief(get(m, "in-code"))).toEqual(counted("cost", "other", "pfc", { review: true }));
    // Plaid read it as spending: no review (sorter-3; sorter-2 flagged it).
    expect(brief(get(m, "other-code"))).toEqual(counted("cost", "operating", "pfc"));
    // Not a bank account: no review.
    expect(brief(get(m, "card"))).toEqual(counted("cost", "other", "fallback"));
    // Nothing moved, so nothing to review.
    expect(brief(get(m, "zero"))).toEqual(counted("cost", "other", "fallback"));
  });

  it("never flags a dump fee at a transfer station, TransferWise, a card balance transfer, money in or $0", () => {
    const m = run([
      txn("dump", {
        amount: 85,
        name: "CLEVELAND COUNTY TRANSFER STATION",
        merchant_name: "Cleveland County Transfer Station",
        ...pfc("RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT"),
      }),
      txn("wise", { amount: 300, name: "TRANSFERWISE INC" }),
      txn("balance", { account_row_id: "card", amount: 500, name: "BALANCE TRANSFER" }),
      txn("card-in", { account_row_id: "card", amount: -40, name: "ACME", ...pfc("TRANSFER_OUT_ACCOUNT_TRANSFER") }),
      txn("zero", { amount: 0, name: "ONLINE TRANSFER", ...pfc("TRANSFER_OUT_ACCOUNT_TRANSFER") }),
    ]);
    expect(brief(get(m, "dump"))).toEqual(counted("cost", "job_fees", "pfc"));
    expect(brief(get(m, "wise"))).toEqual(counted("cost", "other", "fallback"));
    expect(brief(get(m, "balance"))).toEqual(counted("cost", "other", "fallback"));
    expect(brief(get(m, "card-in"))).toEqual(counted("refund", "other", "pfc"));
    expect(brief(get(m, "zero"))).toEqual(counted("cost", "other", "pfc"));
  });

  it("falls back to other", () => {
    expect(brief(get(run([txn("t", { amount: 12 })]), "t"))).toEqual(counted("cost", "other", "fallback"));
  });

  it("falls back to other for categories the company does not have", () => {
    const m = run(
      [
        txn("dump", { amount: 75, name: "ACME", ...pfc("RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT") }),
        txn("sunbelt", { amount: 640, name: "SUNBELT RENTALS" }),
        txn("fuel", { amount: 40, name: "SHELL OIL" }),
      ],
      { keys: ["payroll_contractors", "fuel_equipment", "operating", "other"] },
    );
    expect(get(m, "dump").category_key).toBe("other");
    expect(get(m, "sunbelt").category_key).toBe("other");
    expect(get(m, "fuel").category_key).toBe("fuel_equipment");
  });
});

// ---------------------------------------------------------------------------
// Property test: the invariant, over thousands of generated transactions
// ---------------------------------------------------------------------------

const GEN_ACCOUNTS: SorterAccount[] = [
  account("chk-1"),
  account("chk-2", { include_from: "2026-07-15" }),
  account("sav-1", { subtype: "savings" }),
  account("card-1", { type: "credit", subtype: "credit card", include_from: "2026-08-01" }),
  account("card-2", { type: "credit", subtype: "credit card" }),
  account("home", { is_business: false }),
  account("loan-1", { type: "loan", subtype: "line of credit" }),
  account("pp-1", { subtype: "paypal" }),
];
const GEN_ACCOUNT_IDS = [...GEN_ACCOUNTS.map((a) => a.id), "ghost"];
const DEPOSITORY_IDS = ["chk-1", "chk-2", "sav-1", "home", "pp-1"];
const NAMES = [
  "ONLINE TRANSFER TO SAV",
  "ONLINE TRANSFER FROM CHK",
  "XFER",
  "ONLINE TFR TO CHK",
  "TRANSFER TO BANK",
  "PAYPAL TRANSFER",
  "CLEVELAND COUNTY TRANSFER STATION",
  "TRANSFERWISE INC",
  "BALANCE TRANSFER",
  "MOBILE DEPOSIT",
  "Online Payment 18273645 To ACME TREE SUPPLY",
  "Zelle payment to JOHN SAMPLE Conf# 8XJ2K9QZ",
  "Zelle payment to JANE EXAMPLE",
  "VENMO CASHOUT",
  "PAYMENT THANK YOU",
  "AUTOPAY",
  "CARD SERVICES ONLINE PMT",
  "ACME SUPPLY",
  "EXAMPLE HARDWARE #0423",
  "SHELL OIL 574423",
  "GUSTO PAY 123456",
  "JOBBER PAYMENTS PAYOUT",
  "ADOBE *CREATIVE",
  "ATM WITHDRAWAL",
  "CHECK 1042",
  "DEPOSIT",
  "SUNBELT RENTALS",
  "NORMAN RECYCLING AND TRANSFER CENTER",
  "WIRE TRANSFER FEE",
  "PURCHASE AUTHORIZED ON 09/08 THE HOME DEPOT CARD 1234",
  "GEICO AUTOPAY 260910",
  "FORD CREDIT LEASE PMT",
  null,
];
const MERCHANTS = [null, null, null, "Acme Supply", "Example Hardware", "Shell", "Gusto", "Jobber", "Zelle", "Adobe", "PayPal"];
const ENTITIES = [null, null, null, "ent-acme", "ent-hardware", "ent-shell", "ent-jobber"];
const COUNTERPARTY_TYPES = [null, null, null, "merchant", "payment_app", "financial_institution"];
const COMMON_AMOUNTS = [12.34, 50, 99.99, 100, 250, 500, 812.4, 1000, 1234.56, 2500];

interface Generated {
  accounts: SorterAccount[];
  txns: SorterTxn[];
  rules: SorterRule[];
}

function generate(seed: number, count: number): Generated {
  const rand = rng(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const day0 = Date.UTC(2026, 5, 1);
  const dateAt = (offset: number) => new Date(day0 + offset * 86_400_000).toISOString().slice(0, 10);
  const amount = () => (rand() < 0.6 ? pick(COMMON_AMOUNTS) : Math.round(rand() * 500_000) / 100);
  const codes = () => {
    const r = rand();
    if (r < 0.3) return { pfc_primary: null, pfc_detailed: null };
    const detailed = pick(PFC_DETAILED_CODES);
    const codesOf = pfc(detailed);
    return r < 0.4 ? { pfc_primary: codesOf.pfc_primary, pfc_detailed: null } : codesOf;
  };
  const base = (id: string, accountId: string, offset: number, value: number): SorterTxn =>
    txn(id, {
      account_row_id: accountId,
      txn_date: dateAt(offset),
      amount: value,
      pending: rand() < 0.08,
      pending_transaction_id: rand() < 0.1 ? `p-${Math.floor(rand() * count)}` : null,
      name: pick(NAMES),
      merchant_name: pick(MERCHANTS),
      merchant_entity_id: pick(ENTITIES),
      counterparty_type: pick(COUNTERPARTY_TYPES),
      ...codes(),
    });

  const txns: SorterTxn[] = [];
  while (txns.length < count) {
    const n = txns.length;
    const offset = Math.floor(rand() * 150);
    if (rand() < 0.25 && n + 1 < count) {
      // A likely pair: money out of a bank account, the same amount in elsewhere a few days apart.
      const value = amount();
      txns.push(base(`t-${n}`, pick(DEPOSITORY_IDS), offset, value));
      txns.push(base(`t-${n + 1}`, pick(GEN_ACCOUNT_IDS), offset + Math.floor(rand() * 9) - 4, -value));
    } else {
      const r = rand();
      const sign = r < 0.65 ? 1 : r < 0.95 ? -1 : 0;
      txns.push(base(`t-${n}`, pick(GEN_ACCOUNT_IDS), offset, sign * amount()));
    }
  }

  const rules: SorterRule[] = [];
  for (let i = 0; i < 40; i++) {
    const t = pick(txns);
    const kind = pick(["transaction_id", "merchant_entity_id", "description_key", "merchant_name"] as const);
    const value =
      kind === "transaction_id"
        ? rand() < 0.2 && t.pending_transaction_id ? t.pending_transaction_id : t.transaction_id
        : kind === "merchant_entity_id"
          ? t.merchant_entity_id ?? "ent-none"
          : kind === "description_key"
            ? rand() < 0.3 ? pick(["zelle", "transfer", "atm withdrawal", "payment"]) : descriptionKey(t)
            : t.merchant_name ?? "Zelle";
    const personal = rand() < 0.5;
    rules.push(
      rule(`r-${i}`, {
        rule_type: personal ? "exclude_personal" : "set_category",
        match_kind: kind,
        match_value: value,
        account_row_id: rand() < 0.2 ? t.account_row_id : null,
        category_key: personal ? null : pick(["payroll_contractors", "fuel_equipment", "job_fees", "operating", "other", "marketing"]),
      }),
    );
  }
  return { accounts: GEN_ACCOUNTS, txns, rules };
}

const cents = (n: number) => Math.round(n * 100);
const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const appCode = (t: SorterTxn) => isPaymentAppTransfer(t.pfc_primary, t.pfc_detailed);
const transferCode = (t: SorterTxn) => isTransferPfc(t.pfc_primary, t.pfc_detailed);
const CASH_CODES = new Set(["TRANSFER_IN_DEPOSIT", "TRANSFER_OUT_WITHDRAWAL"]);
// "transfer" / "xfer" and the like as a whole word, never "transfer station", "transferwise" or
// "balance transfer" (written as one regex, independently of the sorter's word scan).
const TRANSFER_WORD = /(?<!\b(?:balance|bal) )\b(?:transfers?|transferred|xfers?|xferred|xfr|trnsfr|tfr|trf)\b(?! (?:stations?|stn|sta)\b)/;
const namesTransfer = (s: string | null) => TRANSFER_WORD.test((s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " "));
/** A Plaid code that is neither missing nor TRANSFER_*. */
const spendingCode = (t: SorterTxn) => pfcCategory(t.pfc_primary, t.pfc_detailed).source !== "none" && !transferCode(t);
/** A row Plaid or the merchant list reads as spending. */
const spendingRow = (t: SorterTxn) => spendingCode(t) || knownMerchant(merchantTexts(t)) !== null;
/**
 * A transfer signal (A10 step 2): a transfer code other than the payment-app and cash or check
 * ones, or a transfer word on a row that is not a spending row (sorter-4, G1).
 */
const transferSignal = (t: SorterTxn) =>
  (transferCode(t) && !appCode(t) && !CASH_CODES.has((t.pfc_detailed ?? "").trim().toUpperCase())) ||
  (!spendingCode(t) &&
    (knownMerchant(merchantTexts(t)) === null || processor(t)) &&
    [t.name, t.merchant_name, t.counterparty_name].some(namesTransfer));
/** Zelle, Venmo, Cash App or Apple Cash by name, or the payment-app code. */
const appRow = (t: SorterTxn) => appCode(t) || isPaymentAppPayee(merchantTexts(t));
const appType = (t: SorterTxn) => (t.counterparty_type ?? "").trim().toLowerCase() === "payment_app";
const paymentApp = (t: SorterTxn) => appRow(t) || appType(t);
const processor = (t: SorterTxn) => isPaymentProcessor(merchantTexts(t));
/** Any LOAN_PAYMENTS_* code (the card-payment code among them), or the LOAN_PAYMENTS primary alone. */
const loanCode = (t: SorterTxn) =>
  (t.pfc_primary ?? "").trim().toUpperCase() === "LOAN_PAYMENTS" ||
  (t.pfc_detailed ?? "").trim().toUpperCase().startsWith("LOAN_PAYMENTS_");
const leaseWord = (t: SorterTxn) =>
  /\b(?:lease|leases|leasing)\b/.test([t.name, t.merchant_name, t.counterparty_name].map((s) => (s ?? "").toLowerCase()).join(" "));
/** What step 5 leaves out as a loan payment when nothing pairs it (A10, sorter-6). */
const loanPaymentRow = (t: SorterTxn) => {
  const known = knownMerchant(merchantTexts(t));
  return loanCode(t) && !isCardPaymentPfc(t.pfc_primary, t.pfc_detailed) && !paymentApp(t) && !leaseWord(t) &&
    (known === null || known.kind === "software");
};

/**
 * Checks every classification against the invariant and the pairing rules, working from the raw
 * inputs rather than from the sorter's own reasoning. Returns the problems found (empty when all
 * hold) and how many excluded business outflows were checked.
 */
function checkInvariant(g: Generated, out: Classification[]): { problems: string[]; excludedOutflows: number } {
  const accounts = new Map(g.accounts.map((a) => [a.id, a]));
  const txns = new Map(g.txns.map((t) => [t.transaction_id, t]));
  const results = new Map(out.map((c) => [c.transaction_id, c]));
  const rules = new Map(g.rules.map((r) => [r.id, r]));
  const problems: string[] = [];
  let excludedOutflows = 0;

  if (out.length !== g.txns.length) problems.push(`expected ${g.txns.length} results, got ${out.length}`);
  for (const c of out) {
    const t = txns.get(c.transaction_id);
    if (!t) {
      problems.push(`unknown transaction ${c.transaction_id}`);
      continue;
    }
    const a = accounts.get(t.account_row_id);
    const business = !!a?.is_business;
    const beforeCount = !!a?.include_from && t.txn_date < a.include_from;
    const check = (ok: boolean, what: string) => {
      if (!ok) problems.push(`${what}: ${JSON.stringify({ t, c })}`);
    };

    check(c.treatment !== "unsorted", "unsorted");
    check(c.sorter_version === SORTER_VERSION, "version");
    if (c.treatment === "cost") check(t.amount >= 0, "cost on money in");
    if (c.treatment === "refund") check(t.amount < 0, "refund on money out");
    if (!business) check(c.exclude_reason === "non_business_account", "non-business row not excluded");

    // THE INVARIANT: money out of a business account is excluded only for these reasons.
    if (business && t.amount > 0 && c.treatment === "excluded") {
      excludedOutflows++;
      const reason = c.exclude_reason;
      check(
        reason === "personal" ||
          reason === "own_transfer" ||
          reason === "card_payment" ||
          reason === "loan_payment" ||
          reason === "pending" ||
          reason === "before_count_from",
        "outflow excluded for a reason the invariant does not allow",
      );
      if (reason === "personal") check(rules.get(c.rule_id ?? "")?.rule_type === "exclude_personal", "personal without its rule");
      if (reason === "pending") check(t.pending, "pending reason on a posted row");
      if (reason === "before_count_from") check(beforeCount, "count-from reason on a counted date");
      if (reason === "own_transfer") check(c.matched_transaction_id !== null, "own transfer without a partner");
      if (reason === "loan_payment") {
        check(
          loanPaymentRow(t) && c.classified_by === "pfc" && c.matched_transaction_id === null && !c.review,
          "loan payment that step 5 does not allow (no loan code, card code, payment app, lease or a known non-lender)",
        );
      }
      if (reason === "card_payment" && c.matched_transaction_id === null) {
        check(
          a?.type === "depository" && isCardPaymentPfc(t.pfc_primary, t.pfc_detailed) && c.review,
          "unmatched card payment without the card-payment code and a review flag",
        );
      }
    }

    // A personal rule on a payment-app or transfer row (including a cash or check deposit or
    // withdrawal) only ever matches by transaction_id or by the description key, never by the
    // app's or bank's merchant name or entity id.
    if (c.exclude_reason === "personal" && (paymentApp(t) || transferSignal(t) || transferCode(t))) {
      const kind = rules.get(c.rule_id ?? "")?.match_kind;
      check(kind === "transaction_id" || kind === "description_key", "personal rule by merchant or entity on a payout row");
    }

    // An unmatched transfer out is always counted. Unless a merchant explains it, it is flagged when
    // the map flags its code, or when it is on a bank account and Plaid did not read it as spending.
    if (
      business &&
      cents(t.amount) > 0 &&
      !t.pending &&
      !beforeCount &&
      transferSignal(t) &&
      !isCardPaymentPfc(t.pfc_primary, t.pfc_detailed) &&
      c.matched_transaction_id === null &&
      c.exclude_reason !== "personal"
    ) {
      check(c.treatment === "cost", "unmatched transfer out not counted");
      if (c.classified_by === "pfc" || c.classified_by === "fallback") {
        const flagged = pfcCategory(t.pfc_primary, t.pfc_detailed).review || (a?.type === "depository" && !spendingCode(t));
        check(c.review === flagged, "counted transfer out with the wrong review flag");
      }
    }

    // Every loan payment out of a business account is left out (Joe Evans, 2026-10-06), unless a rule
    // decided it, a guard came first, it paired as a card payment, or it moved through a payment app.
    if (
      business &&
      cents(t.amount) > 0 &&
      !t.pending &&
      !beforeCount &&
      loanPaymentRow(t) &&
      c.classified_by !== "user_rule" &&
      c.matched_transaction_id === null
    ) {
      check(c.exclude_reason === "loan_payment", "loan payment counted");
    }

    // Review on a counted row only ever marks money out: never a refund or a $0 row.
    if (c.review && c.treatment !== "excluded") check(c.treatment === "cost" && cents(t.amount) > 0, "review on money in or on $0");

    // Pairs are real: the partner exists, the amounts cancel to the cent, the dates are close,
    // and a partner that counts points back.
    if (c.matched_transaction_id !== null) {
      const p = txns.get(c.matched_transaction_id);
      if (!p) {
        problems.push(`unknown partner ${c.matched_transaction_id}`);
        continue;
      }
      const pa = accounts.get(p.account_row_id);
      const window = c.exclude_reason === "own_transfer" ? SETTINGS.transfer_window_days : SETTINGS.card_payment_window_days;
      check(!!pa?.is_business && !p.pending, "partner not a posted business row");
      check(p.account_row_id !== t.account_row_id, "partner on the same account");
      check(cents(p.amount) === -cents(t.amount), "amounts do not cancel");
      check(Math.abs(dayOf(p.txn_date) - dayOf(t.txn_date)) <= window, "partner outside the window");
      if (c.exclude_reason === "own_transfer") {
        // A row on a PayPal balance counts as processor-named (sorter-4, G4).
        const processorSide = (x: SorterTxn) => processor(x) || accounts.get(x.account_row_id)?.subtype === "paypal";
        check(a?.type === "depository" && pa?.type === "depository", "own transfer off a bank account");
        check(transferSignal(t) || transferSignal(p), "own transfer without a transfer signal");
        check(!appRow(t) && !appRow(p), "own transfer with a payment app");
        check([t, p].every((x) => !appType(x) || processorSide(x)), "own transfer with a payment_app type that names no processor");
        if ([t, p].some((x) => processorSide(x) || appType(x))) {
          check(transferSignal(t) && transferSignal(p), "own transfer with a processor side and a signal on one side only");
        }
        // A side without a transfer signal is never a spending row (a cost or a known merchant).
        for (const x of [t, p]) if (!transferSignal(x)) check(!spendingRow(x), "own transfer side without a signal is a spending row");
      } else {
        check(c.exclude_reason === "card_payment", "matched id on an unpaired reason");
        check([a?.type, pa?.type].sort().join() === "credit,depository", "card payment not bank-to-card");
        const [bank, card] = a?.type === "depository" ? [t, p] : [p, t];
        if (bank.amount > 0) {
          check(!paymentApp(bank), "card paid by a payment app");
        } else {
          // A returned card payment: the card side carries the code, the bank side is no payout.
          check(isCardPaymentPfc(card.pfc_primary, card.pfc_detailed), "returned card payment without the code");
          check(!paymentApp(bank) && !processor(bank), "returned card payment from a payout");
        }
      }
      const pc = results.get(p.transaction_id);
      if (pc?.exclude_reason !== "before_count_from") {
        check(pc?.matched_transaction_id === t.transaction_id && pc?.exclude_reason === c.exclude_reason, "partner does not point back");
      }
    }
  }
  return { problems: problems.slice(0, 5), excludedOutflows };
}

describe("invariant (property test)", () => {
  it("holds over thousands of generated transactions, in any input order", () => {
    let excludedOutflows = 0;
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = generate(seed, 2000);
      const out = classifyAll(g.accounts, g.txns, g.rules, SETTINGS);
      const checked = checkInvariant(g, out);
      expect(checked.problems, `seed ${seed}`).toEqual([]);
      excludedOutflows += checked.excludedOutflows;
      total += out.length;

      // The same inputs in another order give the same result for every transaction.
      const rand = rng(seed * 101);
      const shuffled = classifyAll(shuffle(g.accounts, rand), shuffle(g.txns, rand), shuffle(g.rules, rand), SETTINGS);
      const byId = new Map(shuffled.map((c) => [c.transaction_id, c]));
      const differ = out.filter((c) => JSON.stringify(byId.get(c.transaction_id)) !== JSON.stringify(c));
      expect(differ.map((c) => c.transaction_id), `seed ${seed}`).toEqual([]);
    }
    expect(total).toBe(12_000);
    // The generator really exercises every exclusion path.
    expect(excludedOutflows).toBeGreaterThan(500);
  });

  it("produces every kind of result from the generated data", () => {
    const g = generate(42, 3000);
    const out = classifyAll(g.accounts, g.txns, g.rules, SETTINGS);
    const seen = new Set(out.map((c) => `${c.treatment}/${c.exclude_reason ?? c.classified_by}`));
    for (const k of [
      "cost/pfc",
      "cost/merchant_rule",
      "cost/fallback",
      "cost/user_rule",
      "refund/pfc",
      "excluded/personal",
      "excluded/own_transfer",
      "excluded/card_payment",
      "excluded/loan_payment",
      "excluded/inflow",
      "excluded/pending",
      "excluded/before_count_from",
      "excluded/non_business_account",
    ]) {
      expect(seen, k).toContain(k);
    }
  });
});

// ---------------------------------------------------------------------------
// Pairing against a plain reference: every candidate pair sorted, then taken greedily
// ---------------------------------------------------------------------------

/**
 * The ranked greedy written the slow, obvious way: list every acceptable pair, sort by
 * (strength, date gap, lower id, higher id), take pairs whose sides are both free.
 * Returns partner ids by transaction id.
 */
function referencePairs(
  txns: SorterTxn[],
  windowDays: number,
  strength: (out: SorterTxn, inn: SorterTxn) => number | null,
): Map<string, string> {
  const ids = txns.map((t) => t.transaction_id).sort();
  const rankOf = new Map(ids.map((id, i) => [id, i]));
  const candidates: Array<{ out: SorterTxn; inn: SorterTxn; key: number[] }> = [];
  for (const out of txns) {
    if (out.amount <= 0) continue;
    for (const inn of txns) {
      if (inn.amount >= 0 || cents(out.amount) !== -cents(inn.amount)) continue;
      const gap = Math.abs(dayOf(out.txn_date) - dayOf(inn.txn_date));
      const s = gap <= windowDays ? strength(out, inn) : null;
      if (s === null) continue;
      const ranks = [rankOf.get(out.transaction_id) ?? 0, rankOf.get(inn.transaction_id) ?? 0].sort((a, b) => a - b);
      candidates.push({ out, inn, key: [s, gap, ...ranks] });
    }
  }
  const byKey = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  candidates.sort((x, y) => byKey(x.key, y.key));
  const partner = new Map<string, string>();
  for (const { out, inn } of candidates) {
    if (partner.has(out.transaction_id) || partner.has(inn.transaction_id)) continue;
    partner.set(out.transaction_id, inn.transaction_id);
    partner.set(inn.transaction_id, out.transaction_id);
  }
  return partner;
}

describe("pairing matches the plain ranked greedy", () => {
  const dateAt = (offset: number) => new Date(Date.UTC(2026, 6, 1) + offset * 86_400_000).toISOString().slice(0, 10);
  const compare = (txns: SorterTxn[], expected: Map<string, string>) => {
    const out = classifyAll(ACCOUNTS, txns, [], SETTINGS);
    const got = out.filter((c) => c.matched_transaction_id !== null).map((c) => `${c.transaction_id}>${c.matched_transaction_id}`).sort();
    const want = [...expected].map(([a, b]) => `${a}>${b}`).sort();
    expect(got).toEqual(want);
    return want.length;
  };

  it("own transfers", () => {
    // Row kinds: a named transfer; plain; a supplier cost (spending code); a mobile deposit (no
    // signal, not spending); a PayPal transfer (a processor with a signal); a wire fee (a transfer
    // word on a spending row: no signal, G1). Every row on the PayPal balance "pp" is a processor
    // side (G4).
    const kinds: ReadonlyArray<{ over: Partial<SorterTxn>; signal: boolean; spending: boolean; processor: boolean }> = [
      { over: { name: "ONLINE TRANSFER" }, signal: true, spending: false, processor: false },
      { over: { name: "ONLINE TRANSFER" }, signal: true, spending: false, processor: false },
      { over: { name: "ACME" }, signal: false, spending: false, processor: false },
      { over: { name: "ACME SUPPLY", ...pfc("HOME_IMPROVEMENT_HARDWARE") }, signal: false, spending: true, processor: false },
      { over: { name: "MOBILE DEPOSIT", ...pfc("TRANSFER_IN_DEPOSIT") }, signal: false, spending: false, processor: false },
      { over: { name: "PAYPAL TRANSFER" }, signal: true, spending: false, processor: true },
      { over: { name: "WIRE TRANSFER FEE", ...pfc("BANK_FEES_OTHER_BANK_FEES") }, signal: false, spending: true, processor: false },
    ];
    const kindOf = new Map<string, (typeof kinds)[number]>();
    let pairs = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rand = rng(seed);
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
      const txns: SorterTxn[] = [];
      for (let i = 0; i < 300; i++) {
        const sign = rand() < 0.5 ? 1 : -1;
        const kind = pick(kinds);
        const id = `r-${String(i).padStart(3, "0")}`;
        kindOf.set(id, kind);
        txns.push(
          txn(id, {
            account_row_id: pick(["chk", "chk2", "sav", "pp"]),
            txn_date: dateAt(Math.floor(rand() * 60)),
            amount: sign * pick([100, 250, 500, 812.4, 1000]),
            ...kind.over,
          }),
        );
      }
      // Strength: 0 both sides with a signal; 1 one side, when neither side is a processor (by name
      // or on the PayPal balance) and the other side is not spending; never otherwise.
      const expected = referencePairs(txns, SETTINGS.transfer_window_days, (o, i) => {
        const a = kindOf.get(o.transaction_id);
        const b = kindOf.get(i.transaction_id);
        if (!a || !b || o.account_row_id === i.account_row_id) return null;
        if (a.signal && b.signal) return 0;
        if (!a.signal && !b.signal) return null;
        if (a.processor || b.processor || o.account_row_id === "pp" || i.account_row_id === "pp") return null;
        return (a.signal ? b : a).spending ? null : 1;
      });
      pairs += compare(txns, expected);
    }
    expect(pairs).toBeGreaterThan(400);
  });

  it("card payments", () => {
    // Bank sides by tier: the card-payment code 0, card-payment wording 1, bill pay 2 (and a bill
    // named autopay, capped by its spending code, G2), plain 3 (and a debit-card purchase, G2), a
    // processor 4, a Zelle payment never. A loan payment (step 5) pairs only with a card side that
    // looks like a payment, and after the other bank rows of its tier (sorter-6).
    const bankSides: ReadonlyArray<{ over: Partial<SorterTxn>; tier: number | null; loan?: boolean }> = [
      { over: { name: "AMEX AUTOPAY", ...pfc("LOAN_PAYMENTS_OTHER_PAYMENT") }, tier: 1, loan: true },
      { over: { name: "ALLY AUTO PAYMENT", ...pfc("LOAN_PAYMENTS_CAR_PAYMENT") }, tier: 2, loan: true },
      { over: { name: "CHASE CARD AUTOPAY", ...pfc("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") }, tier: 0 },
      { over: { name: "CARD SERVICES ONLINE PMT" }, tier: 1 },
      { over: { name: "Online Payment 18273645 To ACME TREE SUPPLY", ...pfc("GENERAL_SERVICES_OTHER_GENERAL_SERVICES") }, tier: 2 },
      { over: { name: "GEICO AUTOPAY 260910", ...pfc("GENERAL_SERVICES_INSURANCE") }, tier: 2 },
      { over: { name: "ACME SUPPLY" }, tier: 3 },
      { over: { name: "PURCHASE AUTHORIZED ON 09/08 ACME CARD 1234", ...pfc("HOME_IMPROVEMENT_HARDWARE") }, tier: 3 },
      { over: { name: "JOBBER" }, tier: 4 },
      { over: { name: "Zelle payment to JOHN SAMPLE" }, tier: null },
    ];
    const cardNames = ["PAYMENT THANK YOU", "ACME"];
    const sideOf = new Map<string, (typeof bankSides)[number]>();
    let pairs = 0;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const rand = rng(seed);
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
      const txns: SorterTxn[] = [];
      for (let i = 0; i < 300; i++) {
        const out = rand() < 0.5;
        const id = `c-${String(i).padStart(3, "0")}`;
        const bank = pick(bankSides);
        if (out) sideOf.set(id, bank);
        txns.push(
          txn(id, {
            account_row_id: out ? pick(["chk", "chk2"]) : "card",
            txn_date: dateAt(Math.floor(rand() * 60)),
            amount: (out ? 1 : -1) * pick([100, 250, 500, 812.4, 1000]),
            ...(out ? bank.over : { name: pick(cardNames) }),
          }),
        );
      }
      // Strength: the bank side's tier, then a loan payment after the others, then 0 when the card
      // side looks like a payment, else 1; a loan payment never pairs with a card side that doesn't.
      const expected = referencePairs(txns, SETTINGS.card_payment_window_days, (o, i) => {
        const side = sideOf.get(o.transaction_id);
        if (!side || side.tier === null) return null;
        const look = i.name === "PAYMENT THANK YOU";
        if (side.loan && !look) return null;
        return side.tier * 4 + (side.loan ? 2 : 0) + (look ? 0 : 1);
      });
      pairs += compare(txns, expected);
    }
    expect(pairs).toBeGreaterThan(300);
  });
});

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

describe("scale", () => {
  it("sorts 5,000 rows well under a second", () => {
    const g = generate(99, 5000);
    classifyAll(g.accounts, g.txns.slice(0, 200), g.rules, SETTINGS); // warm up
    const started = performance.now();
    const out = classifyAll(g.accounts, g.txns, g.rules, SETTINGS);
    const elapsed = performance.now() - started;
    expect(out).toHaveLength(5000);
    expect(elapsed).toBeLessThan(1000);
    expect(checkInvariant(g, out).problems).toEqual([]);
  });

  it("stays fast when thousands of rows share one amount", () => {
    const txns: SorterTxn[] = [];
    for (let i = 0; i < 5000; i++) {
      const out = i % 2 === 0;
      txns.push(
        txn(`s-${String(i).padStart(4, "0")}`, {
          account_row_id: out ? "chk" : "sav",
          txn_date: new Date(Date.UTC(2026, 0, 1) + (i % 365) * 86_400_000).toISOString().slice(0, 10),
          amount: out ? 100 : -100,
          name: "ONLINE TRANSFER",
        }),
      );
    }
    const started = performance.now();
    const out = classifyAll(ACCOUNTS, txns, [], SETTINGS);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(out.every((c) => c.exclude_reason === "own_transfer")).toBe(true);
  });

  it("stays fast when 8,000 same-amount rows fall inside one window", () => {
    for (const reason of ["own_transfer", "card_payment"] as const) {
      const card = reason === "card_payment";
      const txns: SorterTxn[] = [];
      for (let i = 0; i < 8000; i++) {
        const out = i % 2 === 0;
        txns.push(
          txn(`w-${String(i).padStart(4, "0")}`, {
            account_row_id: out ? "chk" : card ? "card" : "sav",
            txn_date: `2026-09-1${i % 3}`,
            amount: out ? 100 : -100,
            name: card ? (out ? "CARD SERVICES ONLINE PMT" : "PAYMENT THANK YOU") : "ONLINE TRANSFER",
          }),
        );
      }
      const started = performance.now();
      const out = classifyAll(ACCOUNTS, txns, [], SETTINGS);
      expect(performance.now() - started, reason).toBeLessThan(2000);
      // Each row has thousands of candidates, far more than it keeps, and still finds a partner.
      expect(out.every((c) => c.exclude_reason === reason && c.matched_transaction_id !== null), reason).toBe(true);
    }
  });

  it("matches the full ranked greedy when a row has more candidates than it keeps", () => {
    // One transfer out and many same-day and next-day transfers in: it still takes the best one.
    const txns = [txn("o", { txn_date: "2026-09-10", amount: 100, name: "ONLINE TRANSFER" })];
    for (let i = 0; i < CANDIDATES_PER_ROW * 3; i++) {
      txns.push(txn(`i-${String(i).padStart(3, "0")}`, { account_row_id: "sav", txn_date: i % 2 ? "2026-09-10" : "2026-09-11", amount: -100, name: "ONLINE TRANSFER" }));
    }
    const m = run(shuffle(txns, rng(5)));
    expect(get(m, "o").matched_transaction_id).toBe("i-001");

    // Many weaker partners on its own day do not hide a stronger one three days away.
    const mixed = [txn("o", { txn_date: "2026-09-10", amount: 100, name: "ONLINE TRANSFER" })];
    for (let i = 0; i < CANDIDATES_PER_ROW * 2; i++) {
      mixed.push(txn(`a-${String(i).padStart(3, "0")}`, { account_row_id: "sav", txn_date: "2026-09-10", amount: -100, name: "ACME" }));
    }
    mixed.push(txn("z-far", { account_row_id: "sav", txn_date: "2026-09-13", amount: -100, name: "ONLINE TRANSFER" }));
    mixed.push(txn("y-far", { account_row_id: "sav", txn_date: "2026-09-07", amount: -100, name: "ONLINE TRANSFER" }));
    expect(get(run(shuffle(mixed, rng(6))), "o").matched_transaction_id).toBe("y-far");
  });

  it("gives the plain ranked greedy's pairs when more rows share their best partners than a row keeps", () => {
    const txns: SorterTxn[] = [];
    for (let i = 0; i < CANDIDATES_PER_ROW + 1; i++) {
      txns.push(txn(`o-${String(i).padStart(2, "0")}`, { txn_date: "2026-09-10", amount: 100, name: "ONLINE TRANSFER" }));
    }
    for (let i = 0; i < CANDIDATES_PER_ROW + 4; i++) {
      txns.push(txn(`i-${String(i).padStart(2, "0")}`, { account_row_id: "sav", txn_date: i % 3 ? "2026-09-10" : "2026-09-12", amount: -100, name: "ONLINE TRANSFER" }));
    }
    const expected = referencePairs(txns, SETTINGS.transfer_window_days, (o, i) => (o.account_row_id === i.account_row_id ? null : 0));
    const out = classifyAll(ACCOUNTS, shuffle(txns, rng(8)), [], SETTINGS);
    for (const c of out) expect(c.matched_transaction_id ?? null, c.transaction_id).toBe(expected.get(c.transaction_id) ?? null);
    expect(out.filter((c) => c.matched_transaction_id).length).toBe(2 * (CANDIDATES_PER_ROW + 1));
  });
});
