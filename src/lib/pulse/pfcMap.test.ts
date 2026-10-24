// Financial Pulse: Plaid category map (Plaid's public code list and synthetic codes only, never
// real transactions).
import { describe, expect, it } from "vitest";
import {
  CARD_PAYMENT_PFC,
  isCardPaymentPfc,
  isInflowPfc,
  isPaymentAppTransfer,
  isTransferPfc,
  PFC_DETAILED_CODES,
  PFC_MAP_VERSION,
  PFC_PRIMARY_CODES,
  PFC_TAXONOMY_VERSION,
  pfcCategory,
  pfcKind,
} from "../../../supabase/functions/_shared/pulse/pfcMap";
import { DEFAULT_CATEGORY_KEYS, type DefaultCategoryKey } from "../../../supabase/functions/_shared/pulse/types";

/** The primary a detailed code belongs to (every v2 code starts with exactly one primary). */
const primaryOf = (code: string): string => {
  const matches = PFC_PRIMARY_CODES.filter((p) => code.startsWith(`${p}_`));
  expect(matches).toHaveLength(1);
  return matches[0];
};

const codesOf = (primary: string) => PFC_DETAILED_CODES.filter((c) => primaryOf(c) === primary);
const codesIn = (category: DefaultCategoryKey) =>
  PFC_DETAILED_CODES.filter((c) => pfcCategory(primaryOf(c), c).category === category);
const sorted = (codes: readonly string[]) => [...codes].sort();

describe("taxonomy table", () => {
  it("is Plaid's v2 list", () => {
    expect(PFC_TAXONOMY_VERSION).toBe("v2");
    expect(PFC_MAP_VERSION).toMatch(/^pfc-map-\d+$/);
    expect(PFC_DETAILED_CODES).toHaveLength(127);
    expect(PFC_PRIMARY_CODES).toHaveLength(18);
    expect(new Set(PFC_DETAILED_CODES).size).toBe(PFC_DETAILED_CODES.length);
    expect(new Set(PFC_PRIMARY_CODES).size).toBe(PFC_PRIMARY_CODES.length);
  });

  it("has well-formed codes, each under exactly one primary, and no empty primary", () => {
    for (const code of PFC_DETAILED_CODES) {
      expect(code).toMatch(/^[A-Z]+(_[A-Z]+)+$/);
      primaryOf(code);
    }
    for (const p of PFC_PRIMARY_CODES) expect(codesOf(p).length).toBeGreaterThan(0);
  });

  it("includes the codes new in v2 and leaves out the v1 names v2 replaced", () => {
    for (const code of [
      "INCOME_CONTRACTOR",
      "INCOME_SALARY",
      "INCOME_OTHER",
      "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT",
      "LOAN_PAYMENTS_BNPL",
      "TRANSFER_IN_TRANSFER_IN_FROM_APPS",
      "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS",
      "TRANSFER_OUT_WIRE",
      "TRANSFER_OUT_CRYPTO",
      "BANK_FEES_LATE_FEES",
      "BANK_FEES_CASH_ADVANCE",
      "OTHER_OTHER",
    ]) {
      expect(PFC_DETAILED_CODES).toContain(code);
    }
    for (const code of ["INCOME_WAGES", "INCOME_OTHER_INCOME", "TRANSFER_IN_CASH_ADVANCES_AND_LOANS"]) {
      expect(PFC_DETAILED_CODES).not.toContain(code);
    }
  });

  it("maps every detailed code to a default category key, from the detailed code itself", () => {
    for (const code of PFC_DETAILED_CODES) {
      for (const primary of [primaryOf(code), null]) {
        const r = pfcCategory(primary, code);
        expect(DEFAULT_CATEGORY_KEYS).toContain(r.category);
        expect(r.source).toBe("detailed");
        expect(typeof r.review).toBe("boolean");
      }
    }
  });
});

describe("A10 mapping corrections", () => {
  it("payroll and contractors: only money sent out through payment apps", () => {
    expect(codesIn("payroll_contractors")).toEqual(["TRANSFER_OUT_TRANSFER_OUT_FROM_APPS"]);
    expect(pfcCategory("TRANSFER_OUT", "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS")).toEqual({
      category: "payroll_contractors",
      review: false,
      source: "detailed",
    });
  });

  it("generic transfers out stay counted as other, flagged for review", () => {
    const generic = [
      "TRANSFER_OUT_ACCOUNT_TRANSFER",
      "TRANSFER_OUT_CRYPTO",
      "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
      "TRANSFER_OUT_SAVINGS",
      "TRANSFER_OUT_WIRE",
      "TRANSFER_OUT_WITHDRAWAL",
      "TRANSFER_OUT_OTHER_TRANSFER_OUT",
    ];
    for (const code of generic) {
      expect(pfcCategory("TRANSFER_OUT", code)).toEqual({ category: "other", review: true, source: "detailed" });
    }
    // Nothing else asks for review.
    const reviewed = PFC_DETAILED_CODES.filter((c) => pfcCategory(primaryOf(c), c).review);
    expect(sorted(reviewed)).toEqual(sorted(generic));
  });

  it("fuel and equipment: transportation, automotive services, home improvement and car payments", () => {
    const expected = [
      ...codesOf("TRANSPORTATION"),
      ...codesOf("HOME_IMPROVEMENT"),
      "GENERAL_SERVICES_AUTOMOTIVE",
      "LOAN_PAYMENTS_CAR_PAYMENT",
    ];
    expect(codesOf("TRANSPORTATION")).toContain("TRANSPORTATION_GAS");
    expect(codesOf("HOME_IMPROVEMENT")).toContain("HOME_IMPROVEMENT_HARDWARE");
    expect(sorted(codesIn("fuel_equipment"))).toEqual(sorted(expected));
  });

  it("job fees: dump fees and government departments", () => {
    expect(sorted(codesIn("job_fees"))).toEqual(
      sorted([
        "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT",
        "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
      ]),
    );
  });

  it("operating: services, utilities, bank fees, office, electronics, marketplaces and tax", () => {
    const expected = [
      ...codesOf("GENERAL_SERVICES").filter((c) => c !== "GENERAL_SERVICES_AUTOMOTIVE"),
      ...codesOf("RENT_AND_UTILITIES").filter((c) => c !== "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT"),
      ...codesOf("BANK_FEES"),
      "GENERAL_MERCHANDISE_OFFICE_SUPPLIES",
      "GENERAL_MERCHANDISE_ELECTRONICS",
      "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
      "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    ];
    expect(sorted(codesIn("operating"))).toEqual(sorted(expected));
    // Advertising and cloud storage live in this code (Plaid's description), so SaaS spend lands in operating.
    expect(pfcCategory("GENERAL_SERVICES", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES").category).toBe("operating");
  });

  it("everything else is other", () => {
    const named = new Set([
      ...codesIn("payroll_contractors"),
      ...codesIn("fuel_equipment"),
      ...codesIn("job_fees"),
      ...codesIn("operating"),
    ]);
    const rest = PFC_DETAILED_CODES.filter((c) => !named.has(c));
    expect(rest.length + named.size).toBe(PFC_DETAILED_CODES.length);
    for (const code of rest) expect(pfcCategory(primaryOf(code), code).category).toBe("other");
    for (const code of [
      "FOOD_AND_DRINK_FAST_FOOD",
      "GENERAL_MERCHANDISE_SUPERSTORES",
      "TRAVEL_LODGING",
      "MEDICAL_PRIMARY_CARE",
      "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
      "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      "INCOME_SALARY",
      "TRANSFER_IN_DEPOSIT",
      "OTHER_OTHER",
    ]) {
      expect(rest).toContain(code);
    }
  });

  it("card payments carry no category of their own (the sorter excludes them first)", () => {
    expect(pfcCategory("LOAN_PAYMENTS", CARD_PAYMENT_PFC)).toEqual({
      category: "other",
      review: false,
      source: "detailed",
    });
  });
});

describe("fallback: detailed first, then primary, then other", () => {
  it("an unknown detailed code falls back to its primary", () => {
    expect(pfcCategory("TRANSPORTATION", "TRANSPORTATION_SYNTHETIC_NEW")).toEqual({
      category: "fuel_equipment",
      review: false,
      source: "primary",
    });
    expect(pfcCategory("TRANSFER_OUT", "TRANSFER_OUT_SYNTHETIC_NEW")).toEqual({
      category: "other",
      review: true,
      source: "primary",
    });
    expect(pfcCategory("BANK_FEES", null)).toEqual({ category: "operating", review: false, source: "primary" });
    expect(pfcCategory("GENERAL_SERVICES", "")).toEqual({ category: "operating", review: false, source: "primary" });
  });

  it("each primary alone gives the most common answer among its own detailed codes", () => {
    for (const p of PFC_PRIMARY_CODES) {
      const tally = new Map<string, number>();
      for (const code of codesOf(p)) {
        const r = pfcCategory(p, code);
        const key = `${r.category}|${r.review}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      const [top] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const r = pfcCategory(p, null);
      expect(r.source).toBe("primary");
      expect(`${r.category}|${r.review}`).toBe(top[0]);
    }
  });

  it("with no primary, an unknown detailed code uses the primary it starts with", () => {
    expect(pfcCategory(null, "HOME_IMPROVEMENT_SYNTHETIC_NEW")).toEqual({
      category: "fuel_equipment",
      review: false,
      source: "primary",
    });
    expect(pfcCategory("NOT_A_PRIMARY", "RENT_AND_UTILITIES_SYNTHETIC_NEW").category).toBe("operating");
  });

  it("nothing usable gives other, with no review", () => {
    const none = { category: "other", review: false, source: "none" };
    expect(pfcCategory(null, null)).toEqual(none);
    expect(pfcCategory("", "   ")).toEqual(none);
    expect(pfcCategory("NOT_A_PRIMARY", "NOT_A_CODE")).toEqual(none);
    // Object property names must never look like codes.
    expect(pfcCategory("constructor", "__proto__")).toEqual(none);
    expect(pfcCategory("toString", "hasOwnProperty")).toEqual(none);
  });

  it("a known detailed code wins over a primary that disagrees", () => {
    expect(pfcCategory("FOOD_AND_DRINK", "TRANSPORTATION_GAS")).toEqual({
      category: "fuel_equipment",
      review: false,
      source: "detailed",
    });
    expect(isTransferPfc("FOOD_AND_DRINK", "TRANSFER_OUT_WIRE")).toBe(true);
    expect(isTransferPfc("TRANSFER_OUT", "FOOD_AND_DRINK_COFFEE")).toBe(false);
  });

  it("ignores case and surrounding spaces", () => {
    expect(pfcCategory(" transportation ", "transportation_gas ")).toEqual({
      category: "fuel_equipment",
      review: false,
      source: "detailed",
    });
    expect(isCardPaymentPfc(null, " loan_payments_credit_card_payment")).toBe(true);
  });

  it("v1 names that v2 replaced still land on their primary", () => {
    expect(pfcCategory("INCOME", "INCOME_WAGES")).toEqual({ category: "other", review: false, source: "primary" });
    expect(isInflowPfc("INCOME", "INCOME_OTHER_INCOME")).toBe(true);
    expect(isInflowPfc("TRANSFER_IN", "TRANSFER_IN_CASH_ADVANCES_AND_LOANS")).toBe(true);
    expect(isTransferPfc("TRANSFER_IN", "TRANSFER_IN_CASH_ADVANCES_AND_LOANS")).toBe(true);
  });
});

describe("card payments", () => {
  it("only the credit card payment code is a card payment", () => {
    expect(PFC_DETAILED_CODES.filter((c) => isCardPaymentPfc(primaryOf(c), c))).toEqual([CARD_PAYMENT_PFC]);
    expect(isCardPaymentPfc("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe(true);
    expect(isCardPaymentPfc(null, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe(true);
    expect(isCardPaymentPfc("LOAN_PAYMENTS", "LOAN_PAYMENTS_CAR_PAYMENT")).toBe(false);
  });

  it("needs the detailed code: the primary alone cannot tell", () => {
    expect(isCardPaymentPfc("LOAN_PAYMENTS", null)).toBe(false);
    expect(isCardPaymentPfc("LOAN_PAYMENTS", "LOAN_PAYMENTS_SYNTHETIC_NEW")).toBe(false);
    expect(isCardPaymentPfc(null, null)).toBe(false);
  });

  it("is neither a transfer nor an inflow", () => {
    expect(pfcKind("LOAN_PAYMENTS", CARD_PAYMENT_PFC)).toBe("card_payment");
    expect(isTransferPfc("LOAN_PAYMENTS", CARD_PAYMENT_PFC)).toBe(false);
    expect(isInflowPfc("LOAN_PAYMENTS", CARD_PAYMENT_PFC)).toBe(false);
  });
});

describe("transfers and payment apps", () => {
  it("every TRANSFER_IN_* and TRANSFER_OUT_* code is a transfer, and nothing else", () => {
    for (const code of PFC_DETAILED_CODES) {
      const expected = code.startsWith("TRANSFER_IN_") || code.startsWith("TRANSFER_OUT_");
      expect(isTransferPfc(primaryOf(code), code)).toBe(expected);
    }
    expect(codesOf("TRANSFER_IN")).toHaveLength(7);
    expect(codesOf("TRANSFER_OUT")).toHaveLength(8);
  });

  it("works from the primary when the detailed code is missing or new", () => {
    expect(isTransferPfc("TRANSFER_OUT", null)).toBe(true);
    expect(isTransferPfc("TRANSFER_IN", "TRANSFER_IN_SYNTHETIC_NEW")).toBe(true);
    expect(isTransferPfc(null, "TRANSFER_OUT_SYNTHETIC_NEW")).toBe(true);
    expect(isTransferPfc("LOAN_DISBURSEMENTS", null)).toBe(false);
    expect(isTransferPfc(null, null)).toBe(false);
  });

  it("payment-app transfers: both directions, detailed code only", () => {
    expect(PFC_DETAILED_CODES.filter((c) => isPaymentAppTransfer(primaryOf(c), c))).toEqual([
      "TRANSFER_IN_TRANSFER_IN_FROM_APPS",
      "TRANSFER_OUT_TRANSFER_OUT_FROM_APPS",
    ]);
    expect(isPaymentAppTransfer("TRANSFER_OUT", null)).toBe(false);
    expect(isPaymentAppTransfer("TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER")).toBe(false);
    // Only the outgoing one is payroll.
    expect(pfcCategory("TRANSFER_IN", "TRANSFER_IN_TRANSFER_IN_FROM_APPS").category).toBe("other");
  });
});

describe("money direction", () => {
  it("INCOME_*, TRANSFER_IN_* and LOAN_DISBURSEMENTS_* are inflows, and nothing else", () => {
    const inflowPrimaries = new Set(["INCOME", "TRANSFER_IN", "LOAN_DISBURSEMENTS"]);
    for (const code of PFC_DETAILED_CODES) {
      const p = primaryOf(code);
      expect(isInflowPfc(p, code)).toBe(inflowPrimaries.has(p));
      if (inflowPrimaries.has(p)) expect(pfcKind(p, code)).toBe("inflow");
    }
  });

  it("classifies the rest", () => {
    for (const code of codesOf("TRANSFER_OUT")) expect(pfcKind("TRANSFER_OUT", code)).toBe("transfer_out");
    expect(pfcKind("TRANSPORTATION", "TRANSPORTATION_GAS")).toBe("spend");
    expect(pfcKind("LOAN_PAYMENTS", "LOAN_PAYMENTS_CAR_PAYMENT")).toBe("spend");
    expect(pfcKind("LOAN_PAYMENTS", null)).toBe("spend");
    expect(pfcKind("INCOME", null)).toBe("inflow");
    expect(pfcKind(null, null)).toBe("unknown");
    expect(pfcKind("NOT_A_PRIMARY", "NOT_A_CODE")).toBe("unknown");
  });
});
