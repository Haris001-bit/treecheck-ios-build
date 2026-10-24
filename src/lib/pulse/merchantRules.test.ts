// Financial Pulse: known merchants and payment processors (synthetic descriptions only, never real data).
import { describe, expect, it } from "vitest";
import {
  isPaymentAppPayee,
  isPaymentProcessor,
  KNOWN_MERCHANT_PATTERNS,
  knownMerchant,
  MERCHANT_RULES_VERSION,
  merchantTexts,
} from "../../../supabase/functions/_shared/pulse/merchantRules";
import { normalizeText } from "../../../supabase/functions/_shared/pulse/normalize";
import { DEFAULT_CATEGORY_KEYS } from "../../../supabase/functions/_shared/pulse/types";

const texts = (name: string | null, merchant_name: string | null = null, counterparty_name: string | null = null) =>
  merchantTexts({ name, merchant_name, counterparty_name });
const categoryOf = (name: string | null, merchant: string | null = null) => knownMerchant(texts(name, merchant))?.category ?? null;

describe("known merchants", () => {
  it("has a version and only default categories", () => {
    expect(MERCHANT_RULES_VERSION).toMatch(/^merchant-rules-\d+$/);
    for (const p of KNOWN_MERCHANT_PATTERNS) {
      expect(DEFAULT_CATEGORY_KEYS).toContain(p.category);
      // Every pattern is already in normalized form, so it can match.
      expect(normalizeText(p.pattern), p.pattern).toBe(p.pattern);
    }
  });

  it("sends payroll providers to payroll_contractors", () => {
    for (const [name, merchant] of [
      ["GUSTO DES:NET 123456 ID:9876543", null],
      [null, "Gusto"],
      ["ADP WAGE PAY 998877", null],
      ["PAYCHEX EIB INVOICE", null],
      ["INTUIT PAYROLL S 4455", "Intuit"],
      ["QUICKBOOKS PAYROLL", null],
      ["SQUARE PAYROLL", null],
      ["ONPAY INC", null],
      ["RIPPLING PEO", null],
      ["PATRIOT SOFTWARE PAYROLL", null],
    ] as const) {
      expect(categoryOf(name, merchant), `${name} / ${merchant}`).toBe("payroll_contractors");
    }
  });

  it("sends equipment rental to job_fees", () => {
    expect(categoryOf("SUNBELT RENTALS #0412")).toBe("job_fees");
    expect(categoryOf("UNITED RENTALS 55512")).toBe("job_fees");
    expect(categoryOf("THE HOME DEPOT #1234 TOOL RENTAL")).toBe("job_fees");
    expect(categoryOf("HERC RENTALS 1122")).toBe("job_fees");
  });

  it("sends software to operating and fuel stations to fuel_equipment", () => {
    expect(categoryOf("ADOBE *CREATIVE CLD")).toBe("operating");
    expect(categoryOf("GOOGLE *GSUITE_EXAMPLE")).toBe("operating");
    expect(categoryOf("INTUIT *QBOOKS ONLINE")).toBe("operating");
    expect(categoryOf("JOBBER SUBSCRIPTION")).toBe("operating");
    expect(categoryOf(null, "Zoom")).toBe("operating");
    expect(categoryOf("SHELL OIL 57442341234")).toBe("fuel_equipment");
    expect(categoryOf("CHEVRON 0209455")).toBe("fuel_equipment");
    expect(categoryOf(null, "76")).toBe("fuel_equipment");
    expect(categoryOf("PHILLIPS 66 #4411")).toBe("fuel_equipment");
  });

  it("matches whole words only, and exact names only as the whole name", () => {
    expect(categoryOf("SHELLFISH SHACK")).toBeNull();
    expect(categoryOf("GUSTO PIZZERIA")).toBeNull();
    expect(categoryOf("ROUTE 76 DINER")).toBeNull();
    expect(categoryOf("ZOOMIES PET CARE")).toBeNull();
    expect(categoryOf("SQUARESPACE")).toBe("operating");
  });

  it("prefers the longest pattern", () => {
    // "intuit payroll" beats "intuit"; "home depot tool rental" beats "tool rental".
    expect(knownMerchant(texts("INTUIT PAYROLL", "Intuit"))?.pattern).toBe("intuit payroll");
    expect(knownMerchant(texts("HOME DEPOT TOOL RENTAL"))?.pattern).toBe("home depot tool rental");
  });

  it("returns null for unknown merchants", () => {
    expect(knownMerchant(texts("ACME SUPPLY"))).toBeNull();
    expect(knownMerchant(texts(null))).toBeNull();
  });
});

describe("payment processors and apps", () => {
  it("recognises the processors and apps that are never refunds", () => {
    for (const name of [
      "JOBBER PAYMENTS PAYOUT",
      "SQUARE INC DES:SQ260928",
      "STRIPE TRANSFER ST-X1Y2Z3",
      "INTUIT DEPOSIT",
      "QUICKBOOKS PAYMENTS",
      "PAYPAL TRANSFER",
      "VENMO CASHOUT",
      "Zelle payment from JANE EXAMPLE",
      "CASH APP*JOHN SAMPLE",
      "APPLE CASH SENT MONEY",
    ]) {
      expect(isPaymentProcessor(texts(name)), name).toBe(true);
    }
    expect(isPaymentProcessor(texts("ACME SUPPLY REFUND"))).toBe(false);
    expect(isPaymentProcessor(texts("SQUARESPACE"))).toBe(false);
  });

  it("recognises payment-app payees only for Zelle, Venmo, Cash App and Apple Cash", () => {
    expect(isPaymentAppPayee(texts("Zelle payment to JOHN SAMPLE"))).toBe(true);
    expect(isPaymentAppPayee(texts("VENMO *JANE EXAMPLE"))).toBe(true);
    expect(isPaymentAppPayee(texts("CASH APP*JOHN SAMPLE"))).toBe(true);
    expect(isPaymentAppPayee(texts(null, null, "Cash App"))).toBe(true);
    expect(isPaymentAppPayee(texts("SQUARE CASH JOHN SAMPLE"))).toBe(true);
    expect(isPaymentAppPayee(texts("APPLE CASH SENT MONEY", "Apple Cash"))).toBe(true);
    expect(isPaymentAppPayee(texts("APPLE STORE #R123"))).toBe(false);
    expect(isPaymentAppPayee(texts("PAYPAL *ACME"))).toBe(false);
    expect(isPaymentAppPayee(texts("STRIPE"))).toBe(false);
  });
});
