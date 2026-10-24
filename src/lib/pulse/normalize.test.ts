// Financial Pulse: description keys and generic keys (synthetic descriptions only, never real data).
import { describe, expect, it } from "vitest";
import {
  descriptionKey,
  isGenericKey,
  normalizeText,
} from "../../../supabase/functions/_shared/pulse/normalize";

const key = (name: string | null, merchant_name: string | null = null, counterparty_name: string | null = null) =>
  descriptionKey({ name, merchant_name, counterparty_name });

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses spaces", () => {
    expect(normalizeText("  ACME   Tree-Supply, LLC.  ")).toBe("acme tree supply llc");
    expect(normalizeText("Lowe's")).toBe("lowes");
    expect(normalizeText("AT&T Wireless")).toBe("att wireless");
    expect(normalizeText("Caf\u00e9 Ol\u00e9")).toBe("cafe ole");
    expect(normalizeText(null)).toBe("");
  });

  it("strips card numbers and masks", () => {
    expect(normalizeText("ACME SUPPLY CARD 4821")).toBe("acme supply");
    expect(normalizeText("ACME SUPPLY xxxx4821")).toBe("acme supply");
    expect(normalizeText("ACME SUPPLY ****4821")).toBe("acme supply");
    expect(normalizeText("ACME SUPPLY card ending in 4821")).toBe("acme supply");
    expect(normalizeText("ACME SUPPLY XXXX XXXX XXXX 4821")).toBe("acme supply");
  });

  it("strips reference and confirmation numbers", () => {
    expect(normalizeText("Zelle payment to JOHN SAMPLE Conf# 8XJ2K9QZ")).toBe("zelle payment to john sample");
    expect(normalizeText("Zelle payment to JOHN SAMPLE Conf# BACFQWERTY")).toBe("zelle payment to john sample");
    expect(normalizeText("Zelle payment to JOHN SAMPLE JPM99B4XYZ12")).toBe("zelle payment to john sample");
    expect(normalizeText("ACME REF 55512 TRACE#: 0412")).toBe("acme");
    expect(normalizeText("VENMO DES:PAYMENT ID:1234567890 INDN:JANE EXAMPLE CO ID:9876543210 WEB")).toBe(
      "venmo payment jane example",
    );
    expect(normalizeText("Online Transfer to CHK ...4321 transaction#: 12345678901")).toBe("online transfer to chk");
  });

  it("strips dates and times", () => {
    expect(normalizeText("PURCHASE AUTHORIZED ON 09/28 ACME SUPPLY")).toBe("acme supply");
    expect(normalizeText("ACME SUPPLY 09/28/26")).toBe("acme supply");
    expect(normalizeText("ACME SUPPLY 2026-09-28")).toBe("acme supply");
    expect(normalizeText("ACME SUPPLY 09-28-2026 14:05")).toBe("acme supply");
    expect(normalizeText("ATM WITHDRAWAL SEP 28")).toBe("atm withdrawal");
    expect(normalizeText("ATM WITHDRAWAL September 28, 2026")).toBe("atm withdrawal");
    // A month-like word that is not a month stays.
    expect(normalizeText("MARATHON 12")).toBe("marathon 12");
  });

  it("strips store numbers and long digit runs but keeps short numbers in names", () => {
    expect(normalizeText("ACME FUEL #0423")).toBe("acme fuel");
    expect(normalizeText("ACME FUEL STORE 12")).toBe("acme fuel");
    expect(normalizeText("ACME FUEL 57442341234")).toBe("acme fuel");
    expect(normalizeText("ACME FUEL 123")).toBe("acme fuel");
    expect(normalizeText("PHILLIPS 66 #4411")).toBe("phillips 66");
    expect(normalizeText("7-ELEVEN")).toBe("7 eleven");
  });

  it("strips bank boilerplate", () => {
    expect(normalizeText("POS DEBIT ACME SUPPLY")).toBe("acme supply");
    expect(normalizeText("RECURRING PAYMENT AUTHORIZED ON 09/01 ACME SOFTWARE")).toBe("acme software");
    expect(normalizeText("ORIG CO NAME:ACME PAYROLL CO ENTRY DESCR:NET PAY SEC:CCD")).toBe("acme payroll net pay");
  });

  it("is idempotent", () => {
    const samples = [
      "ref card 12 acme",
      "Zelle payment to JOHN SAMPLE Conf# 8XJ2K9QZ",
      "PURCHASE AUTHORIZED ON 09/28 ACME #12 CARD 4821",
      "id: ref: 12 x",
      "trans card 5",
      // Each cleanup pass takes out one keyword and number here, so it needs more than four passes.
      "ref ref ref ref ref 12 12 12 12 12",
      "id id id id id id 7 7 7 7 7 7 acme",
      "trans trans trans trans trans trans trans 1 2 3 4 5 6 7",
    ];
    for (const s of samples) {
      const once = normalizeText(s);
      expect(normalizeText(once), s).toBe(once);
    }
    expect(normalizeText("ref ref ref ref ref 12 12 12 12 12")).toBe("");
    expect(normalizeText("id id id id id id 7 7 7 7 7 7 acme")).toBe("acme");
  });
});

describe("descriptionKey", () => {
  it("keeps the payee of payment-app and transfer rows", () => {
    expect(key("Zelle payment to JOHN SAMPLE Conf# 8XJ2K9QZ")).toBe("zelle payment to john sample");
    expect(key("Zelle payment to JOHN SAMPLE Conf# 7QW1E3RT")).toBe("zelle payment to john sample");
    expect(key("VENMO *JANE EXAMPLE 1234567890")).toBe("venmo jane example");
    expect(key("Cash App*JOHN SAMPLE*4821")).toBe("cash app john sample");
    expect(key("ONLINE TRANSFER TO EXAMPLE TREE LLC REF #IB0XYZ1234")).toBe("online transfer to example tree llc");
  });

  it("gives two payments to the same merchant the same key", () => {
    expect(key("PURCHASE AUTHORIZED ON 09/28 ACME SUPPLY #0423 CARD 4821")).toBe(
      key("PURCHASE AUTHORIZED ON 10/02 ACME SUPPLY #0977 CARD 4821"),
    );
  });

  it("falls back to the merchant name, then the counterparty name", () => {
    expect(key(null, "Acme Supply")).toBe("acme supply");
    expect(key("  ", null, "Example Counterparty")).toBe("example counterparty");
    expect(key("#12345", "Acme Supply")).toBe("acme supply");
    expect(key(null)).toBe("");
  });
});

describe("isGenericKey", () => {
  it("flags keys that name no payee", () => {
    for (const k of [
      "zelle",
      "venmo",
      "cash app",
      "paypal",
      "transfer",
      "xfer",
      "online transfer to chk",
      "online transfer from savings",
      "atm",
      "atm withdrawal",
      "check",
      "deposit",
      "mobile deposit",
      "payment",
      "withdrawal",
      "zelle payment to",
      "venmo payment",
      "chase online transfer",
      "check 12",
      "zelle to j s",
      "square cash",
      "apple cash",
      "apple cash sent money",
      "",
    ]) {
      expect(isGenericKey(k), k).toBe(true);
    }
  });

  it("keeps keys with a payee or merchant", () => {
    for (const k of [
      "zelle payment to john sample",
      "venmo jane example",
      "cash app john sample",
      "online transfer to example tree llc",
      "acme supply",
      "home depot",
      "gusto pay",
      "76",
      "square",
      "apple",
      "square cash john sample",
      "squarespace",
    ]) {
      expect(isGenericKey(k), k).toBe(false);
    }
  });

  it("treats every generic description key as generic", () => {
    for (const name of ["ZELLE PAYMENT CONF# 8XJ2K9QZ", "ATM WITHDRAWAL #0423 09/28", "CHECK 1042", "DEPOSIT", "Online Transfer to CHK ...4321"]) {
      expect(isGenericKey(key(name)), name).toBe(true);
    }
  });
});
