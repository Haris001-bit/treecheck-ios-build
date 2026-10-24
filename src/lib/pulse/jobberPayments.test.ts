// Financial Pulse (W3-10a): Jobber payment records become money in, by the day received, with the
// amount without sales tax from the invoice or quote. Only payments and deposits add; refunds and failed
// bank payments take away; Jobber's other ledger entries are skipped.
import { describe, expect, it } from "vitest";
import {
  dedupeById,
  inWindow,
  mapPayment,
  monthWindows,
  paymentKind,
  PAYMENT_LIST_CAP,
  preTaxShare,
  queryBounds,
  shouldSplitEarly,
  splitWindow,
  windowRead,
  type JobberPaymentNode,
} from "../../../supabase/functions/_shared/pulse/jobberPayments";

const ctx = { ownerId: "owner-a", accountId: "acct-1", syncedAt: "2026-10-06T12:00:00.000Z" };
const node = (over: Partial<JobberPaymentNode> = {}): JobberPaymentNode => ({
  id: "pay-1",
  adjustmentType: "PAYMENT",
  entryDate: "2026-10-05T12:50:55Z",
  amount: 1080,
  rawAmount: -1080,
  invoice: {
    id: "inv-1",
    invoiceNumber: "17",
    amounts: { subtotal: 1000, taxAmount: 80, total: 1080 },
    jobs: { nodes: [{ id: "job-9", jobNumber: 9 }] },
  },
  quote: null,
  ...over,
});

describe("paymentKind", () => {
  it("keeps money in and skips the rest of Jobber's ledger", () => {
    expect(paymentKind("PAYMENT")).toBe("payment");
    expect(paymentKind("DEPOSIT")).toBe("deposit");
    expect(paymentKind("REFUND")).toBe("refund");
    expect(paymentKind("FAILED_ACH_PAYMENT")).toBe("failed_payment");
    for (const t of ["INVOICE", "CORRECTION", "INITIAL_BALANCE", "BAD_DEBT", "VOIDED", "", null, undefined]) {
      expect(paymentKind(t as string)).toBeNull();
    }
  });
});

describe("preTaxShare", () => {
  it("is the part of the total that isn't tax", () => {
    expect(preTaxShare({ subtotal: 1000, taxAmount: 80, total: 1080 })).toBeCloseTo(1000 / 1080, 10);
  });
  it("is 1 when there is no tax or the amounts are missing", () => {
    expect(preTaxShare({ subtotal: 1200, taxAmount: 0, total: 1200 })).toBe(1);
    expect(preTaxShare(null)).toBe(1);
    expect(preTaxShare({ total: 0, taxAmount: 0 })).toBe(1);
    expect(preTaxShare({ total: 100 })).toBe(1);
  });
  it("never goes below 0", () => {
    expect(preTaxShare({ total: 50, taxAmount: 60 })).toBe(0);
  });
});

describe("mapPayment", () => {
  it("a payment on an invoice: positive, with tax taken out and the job linked", () => {
    expect(mapPayment(node(), ctx)).toEqual({
      owner_id: "owner-a",
      jobber_account_id: "acct-1",
      jobber_payment_id: "pay-1",
      kind: "payment",
      received_at: "2026-10-05T12:50:55Z",
      amount: 1080,
      amount_pre_tax: 1000,
      jobber_invoice_id: "inv-1",
      invoice_number: "17",
      jobber_quote_id: null,
      jobber_job_id: "job-9",
      job_number: 9,
      deleted_at: null,
      synced_at: ctx.syncedAt,
    });
  });

  it("a refund or a failed bank payment takes money away", () => {
    expect(mapPayment(node({ adjustmentType: "REFUND", amount: 108, rawAmount: 108 }), ctx)).toMatchObject({ kind: "refund", amount: -108, amount_pre_tax: -100 });
    expect(mapPayment(node({ adjustmentType: "FAILED_ACH_PAYMENT", amount: 1080 }), ctx)).toMatchObject({ kind: "failed_payment", amount: -1080, amount_pre_tax: -1000 });
  });

  it("the sign comes from the kind, not from Jobber's amount sign", () => {
    expect(mapPayment(node({ amount: -1080 }), ctx)).toMatchObject({ amount: 1080 });
  });

  it("a deposit on a quote uses the quote's tax share", () => {
    const d = mapPayment(node({
      adjustmentType: "DEPOSIT", amount: 540, invoice: null,
      quote: { id: "q-3", amounts: { subtotal: 2000, taxAmount: 160, total: 2160 } },
    }), ctx);
    expect(d).toMatchObject({ kind: "deposit", amount: 540, amount_pre_tax: 500, jobber_quote_id: "q-3", jobber_invoice_id: null, jobber_job_id: null });
  });

  it("rounds to cents", () => {
    const p = mapPayment(node({ amount: 100, invoice: { id: "i", amounts: { total: 107.25, taxAmount: 7.25 } } }), ctx)!;
    expect(p.amount_pre_tax).toBe(93.24);
  });

  it("skips ledger entries that are not money in, and unreadable ones", () => {
    expect(mapPayment(node({ adjustmentType: "INVOICE" }), ctx)).toBeNull();
    expect(mapPayment(node({ adjustmentType: "BAD_DEBT" }), ctx)).toBeNull();
    expect(mapPayment(node({ amount: null }), ctx)).toBeNull();
    expect(mapPayment(node({ entryDate: "not a date" }), ctx)).toBeNull();
    expect(mapPayment(node({ id: "" }), ctx)).toBeNull();
  });

  it("an invoice number that is missing stays null; a number becomes text", () => {
    expect(mapPayment(node({ invoice: { id: "i", invoiceNumber: null } }), ctx)!.invoice_number).toBeNull();
    expect(mapPayment(node({ invoice: { id: "i", invoiceNumber: 42 } }), ctx)!.invoice_number).toBe("42");
  });
});

describe("windows", () => {
  it("calendar months in UTC, newest first, across a year end", () => {
    const w = monthWindows(new Date("2026-01-15T10:00:00Z"), 3);
    expect(w).toEqual([
      { from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" },
      { from: "2025-12-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
      { from: "2025-11-01T00:00:00.000Z", to: "2025-12-01T00:00:00.000Z" },
    ]);
  });

  it("splits a window in two until it is an hour long", () => {
    const [a, b] = splitWindow({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z" })!;
    expect(a).toEqual({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" });
    expect(b).toEqual({ from: "2026-09-02T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z" });
    expect(splitWindow({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-01T01:00:00.000Z" })).toBeNull();
  });

  it("asks Jobber one second wider on each side", () => {
    expect(queryBounds({ from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" }))
      .toEqual({ from: "2026-08-31T23:59:59.000Z", to: "2026-10-01T00:00:01.000Z" });
  });

  it("a saved row is in the window from its start, up to but not including its end", () => {
    const w = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
    expect(inWindow("2026-09-01T00:00:00Z", w)).toBe(true);
    expect(inWindow("2026-09-30T23:59:59Z", w)).toBe(true);
    expect(inWindow("2026-10-01T00:00:00Z", w)).toBe(false);
  });
});

describe("reading a window safely", () => {
  it("a read is complete only when every page gave the same count and the records match it", () => {
    expect(windowRead([3], 3)).toEqual({ complete: true, short: false, total: 3 });
    expect(windowRead([60, 60], 60)).toEqual({ complete: true, short: false, total: 60 });
    expect(windowRead([0], 0)).toEqual({ complete: true, short: false, total: 0 });
  });
  it("a page without a count never counts as complete (so nothing is marked deleted)", () => {
    expect(windowRead([null], 0).complete).toBe(false);
    expect(windowRead([50, null], 60).complete).toBe(false);
    expect(windowRead([], 0).complete).toBe(false);
  });
  it("a count that moved while paging, or a record skipped, is not complete", () => {
    expect(windowRead([60, 61], 61).complete).toBe(false);
    expect(windowRead([60, 60], 59)).toEqual({ complete: false, short: true, total: 60 });
  });
  it("more distinct records than the count isn't 'short' (nothing to split), but isn't complete either", () => {
    expect(windowRead([3], 4)).toEqual({ complete: false, short: false, total: 3 });
  });
  it("repeated records are kept once", () => {
    expect(dedupeById([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "" }]).map((n) => n.id)).toEqual(["a", "b"]);
  });
  it("splits early when Jobber says the window holds more than it lists at once", () => {
    const month = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
    const hour = { from: "2026-09-01T00:00:00.000Z", to: "2026-09-01T01:00:00.000Z" };
    expect(shouldSplitEarly(PAYMENT_LIST_CAP + 1, month)).toBe(true);
    expect(shouldSplitEarly(PAYMENT_LIST_CAP, month)).toBe(false);
    expect(shouldSplitEarly(null, month)).toBe(false);
    expect(shouldSplitEarly(500, hour)).toBe(false);
  });
});
