// Financial Pulse (W3-10a): the revenue list's payment lines match the server's rule (pre-tax amount by
// default, deleted rows never reach here, local day of the payment) and read clearly.
import { describe, expect, it } from "vitest";
import { paymentLabel, paymentRow, type PaymentRecord } from "./paymentRows";
import { notCountedWhy, revenueWords, sumCents } from "@/components/pulse/screen/pulseScreenTypes";

const pay = (over: Partial<PaymentRecord> = {}): PaymentRecord => ({
  jobber_payment_id: "p1", kind: "payment", received_at: "2026-10-01T03:30:00Z", amount: 1080, amount_pre_tax: 1000,
  invoice_number: "17", jobber_job_id: "j9", job_number: 9, ...over,
});

describe("paymentRow", () => {
  it("uses the amount without sales tax by default, with tax when the company keeps it", () => {
    expect(paymentRow(pay(), "#9 Oak removal", "pre_tax", "America/Chicago").amount).toBe(1000);
    expect(paymentRow(pay(), "#9 Oak removal", "as_jobber", "America/Chicago").amount).toBe(1080);
  });
  it("dates the payment on the company's local day (03:30 UTC on Oct 1 is Sep 30 in Chicago)", () => {
    expect(paymentRow(pay(), null, "pre_tax", "America/Chicago").date).toBe("2026-09-30");
  });
  it("keeps refunds and failed bank payments negative", () => {
    expect(paymentRow(pay({ kind: "refund", amount: -108, amount_pre_tax: -100 }), null, "pre_tax", "UTC").amount).toBe(-100);
    expect(paymentRow(pay({ kind: "failed_payment", amount: -200, amount_pre_tax: -200 }), null, "pre_tax", "UTC").amount).toBe(-200);
  });
  it("ids never collide with job or visit lines", () => {
    expect(paymentRow(pay(), null, "pre_tax", "UTC").id).toBe("payment-p1");
  });
});

describe("paymentLabel", () => {
  it("names the invoice and the job", () => {
    expect(paymentLabel(pay(), "#9 Oak removal")).toBe("Invoice #17, #9 Oak removal");
    expect(paymentLabel(pay(), null)).toBe("Invoice #17, #9");
    expect(paymentLabel(pay({ invoice_number: null, job_number: null, jobber_job_id: null }), null)).toBe("Payment");
  });
  it("says what a deposit, refund or failed bank payment is", () => {
    expect(paymentLabel(pay({ kind: "deposit", invoice_number: null, job_number: null }), null)).toBe("Deposit on a quote");
    expect(paymentLabel(pay({ kind: "deposit" }), "#9 Oak removal")).toBe("Deposit, invoice #17, #9 Oak removal");
    expect(paymentLabel(pay({ kind: "refund" }), "#9 Oak removal")).toBe("Refund, invoice #17, #9 Oak removal");
    expect(paymentLabel(pay({ kind: "failed_payment" }), null)).toBe("Bank payment that failed, invoice #17, #9");
  });
});

describe("sumCents", () => {
  it("adds in whole cents, so the list total matches the server's rounded total", () => {
    expect(100.08 + 104.07 + 0.35).not.toBe(204.5);
    expect(sumCents([100.08, 104.07, 0.35])).toBe(204.5);
    expect(sumCents([])).toBe(0);
    expect(sumCents([1080, -108, -200])).toBe(772);
  });
});

describe("revenue wording", () => {
  it("payments and completed jobs read differently, and never mix", () => {
    const p = revenueWords("payments");
    const j = revenueWords("completed_jobs");
    expect(p.title).toBe("Payments received");
    expect(j.title).toBe("Completed jobs");
    expect(revenueWords(undefined)).toEqual(j);
    for (const v of Object.values(p)) expect(v).not.toMatch(/complet/i);
    expect(p.dated).toBe("Received");
    expect(j.dated).toBe("Completed");
  });
  it("deposits explain the double count only when sales are payments", () => {
    expect(notCountedWhy("inflow", "payments")).toMatch(/count them twice/);
    expect(notCountedWhy("inflow", "completed_jobs")).toMatch(/completed jobs/);
    expect(notCountedWhy("card_payment", "payments")).toMatch(/card already counts/);
  });
});
