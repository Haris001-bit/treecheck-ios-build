// Financial Pulse: Jobber revenue rules (synthetic fixtures only, never real data).
import { describe, expect, it } from "vitest";
import {
  cents,
  isCountableInvoice,
  isPerVisitJob,
  type JobberJobNode,
  type JobberVisitNode,
  localDate,
  type MapContext,
  mapJob,
  monthEndLocal,
  needsVisits,
  scheduledByDay,
  visitLineItemTotal,
} from "../../../supabase/functions/_shared/pulse/jobberRevenue";

const ctx = (over: Partial<MapContext> = {}): MapContext => ({
  ownerId: "owner-1",
  accountId: "acct-1",
  syncedAt: "2026-10-02T12:00:00Z",
  invoicesAvailable: true,
  completedVisits: null,
  ...over,
});

const job = (over: Partial<JobberJobNode> = {}): JobberJobNode => ({
  id: "job-1",
  jobNumber: 101,
  title: "Oak removal",
  jobStatus: "archived",
  jobType: "ONE_OFF",
  billingType: "FIXED_PRICE",
  total: 2500,
  invoicedTotal: 2500,
  completedAt: "2026-09-15T20:00:00Z",
  createdAt: "2026-09-01T15:00:00Z",
  updatedAt: "2026-09-16T15:00:00Z",
  invoices: { nodes: [], pageInfo: { hasNextPage: false } },
  visitsInfo: { incompleteTotal: 0 },
  ...over,
});

const visit = (id: string, completedAt: string | null, prices: number[] = []): JobberVisitNode => ({
  id,
  completedAt,
  isComplete: true,
  lineItems: { nodes: prices.map((p) => ({ totalPrice: p })) },
});

describe("which jobs earn per visit", () => {
  it("matches pulse_window_totals: recurring or visit-billed", () => {
    expect(isPerVisitJob({ jobType: "ONE_OFF", billingType: "FIXED_PRICE" })).toBe(false);
    expect(isPerVisitJob({ jobType: "ONE_OFF", billingType: "VISIT_BASED" })).toBe(true);
    expect(isPerVisitJob({ jobType: "RECURRING", billingType: "FIXED_PRICE" })).toBe(true);
    expect(isPerVisitJob({ jobType: "RECURRING", billingType: "VISIT_BASED" })).toBe(true);
  });

  it("only fetches visits when they change the answer", () => {
    expect(needsVisits(job())).toBe(false);
    expect(needsVisits(job({ completedAt: null, jobStatus: "requires_invoicing" }))).toBe(true);
    expect(needsVisits(job({ completedAt: null, jobStatus: "active" }))).toBe(false);
    expect(needsVisits(job({ billingType: "VISIT_BASED" }))).toBe(true);
  });
});

describe("one-off fixed-price jobs", () => {
  it("earn the job total on the job's completion date", () => {
    const m = mapJob(job(), ctx());
    expect(m.job.completed_at).toBe("2026-09-15T20:00:00Z");
    expect(m.job.completed_source).toBe("job");
    expect(m.job.total).toBe(2500);
    expect(m.visits).toBeNull();
    expect(m.job.owner_id).toBe("owner-1");
    expect(m.job.jobber_account_id).toBe("acct-1");
  });

  it("multi-visit fixed-price jobs still earn once, at job completion", () => {
    const m = mapJob(job(), ctx({
      completedVisits: [visit("v1", "2026-09-10T18:00:00Z", [900]), visit("v2", "2026-09-14T18:00:00Z", [1600])],
    }));
    expect(m.visits).toBeNull();
    expect(m.job.completed_at).toBe("2026-09-15T20:00:00Z");
  });

  it("fall back to the last visit when the work is done but Jobber has no completion date", () => {
    const m = mapJob(
      job({ completedAt: null, jobStatus: "requires_invoicing" }),
      ctx({ completedVisits: [visit("v1", "2026-09-10T18:00:00Z"), visit("v2", "2026-09-12T21:30:00Z")] }),
    );
    expect(m.job.completed_at).toBe("2026-09-12T21:30:00Z");
    expect(m.job.completed_source).toBe("last_visit");
  });

  it("are not earned while visits are still outstanding", () => {
    const m = mapJob(
      job({ completedAt: null, jobStatus: "requires_invoicing", visitsInfo: { incompleteTotal: 1 } }),
      ctx({ completedVisits: [visit("v1", "2026-09-10T18:00:00Z")] }),
    );
    expect(m.job.completed_at).toBeNull();
    expect(m.job.completed_source).toBeNull();
  });

  it("stop counting when a job is reopened", () => {
    const m = mapJob(job({ completedAt: null, jobStatus: "active" }), ctx());
    expect(m.job.completed_at).toBeNull();
  });

  it("note when visits could not be read for the fallback", () => {
    const m = mapJob(job({ completedAt: null, jobStatus: "requires_invoicing" }), ctx({ completedVisits: null }));
    expect(m.job.completed_at).toBeNull();
    expect(m.notes.join(" ")).toMatch(/visits not available/);
  });
});

describe("per-visit jobs", () => {
  it("visit-billed visits earn their own line items on their completion date", () => {
    const m = mapJob(
      job({ billingType: "VISIT_BASED", total: 0, completedAt: null, jobStatus: "active" }),
      ctx({ completedVisits: [visit("v1", "2026-09-10T18:00:00Z", [150, 99.995]), visit("v2", "2026-09-17T18:00:00Z", [250])] }),
    );
    expect(m.visits).toEqual([
      expect.objectContaining({ jobber_visit_id: "v1", amount: 250, completed_at: "2026-09-10T18:00:00Z", jobber_job_id: "job-1" }),
      expect.objectContaining({ jobber_visit_id: "v2", amount: 250, completed_at: "2026-09-17T18:00:00Z" }),
    ]);
  });

  it("skip a completed visit that has no completion date, and say so", () => {
    const m = mapJob(
      job({ billingType: "VISIT_BASED" }),
      ctx({ completedVisits: [visit("v1", null, [100]), visit("v2", "2026-09-17T18:00:00Z", [250])] }),
    );
    expect(m.visits?.map((v) => v.jobber_visit_id)).toEqual(["v2"]);
    expect(m.notes.join(" ")).toMatch(/without a completion date/);
  });

  it("recurring fixed-price jobs spread the job total over every visit", () => {
    const m = mapJob(
      job({ jobType: "RECURRING", billingType: "FIXED_PRICE", total: 1200, completedAt: null, jobStatus: "active", visitsInfo: { incompleteTotal: 9 } }),
      ctx({ completedVisits: [visit("v1", "2026-07-01T15:00:00Z"), visit("v2", "2026-08-01T15:00:00Z"), visit("v3", "2026-09-01T15:00:00Z")] }),
    );
    expect(m.job.per_visit_amount).toBe(100);
    expect(m.visits?.map((v) => v.amount)).toEqual([100, 100, 100]);
  });

  it("recurring visit-billed jobs use line items, not a spread", () => {
    const m = mapJob(
      job({ jobType: "RECURRING", billingType: "VISIT_BASED", total: 5000 }),
      ctx({ completedVisits: [visit("v1", "2026-09-01T15:00:00Z", [80])] }),
    );
    expect(m.job.per_visit_amount).toBeNull();
    expect(m.visits?.[0].amount).toBe(80);
  });

  it("leave visit rows untouched when visits could not be read", () => {
    const m = mapJob(job({ billingType: "VISIT_BASED" }), ctx({ completedVisits: null }));
    expect(m.visits).toBeNull();
    expect(m.notes.join(" ")).toMatch(/per-visit revenue not updated/);
  });
});

describe("invoice totals", () => {
  it("leave out draft and voided invoices", () => {
    expect(isCountableInvoice({ invoiceStatus: "draft" })).toBe(false);
    expect(isCountableInvoice({ invoiceStatus: "voided" })).toBe(false);
    expect(isCountableInvoice({ invoiceStatus: "paid" })).toBe(true);
    expect(isCountableInvoice({ invoiceStatus: "bad_debt" })).toBe(true);
    const m = mapJob(job({
      invoices: {
        nodes: [
          { id: "i1", invoiceStatus: "paid", amounts: { subtotal: 1000, total: 1082.5 } },
          { id: "i2", invoiceStatus: "voided", amounts: { subtotal: 1000, total: 1082.5 } },
          { id: "i3", invoiceStatus: "draft", amounts: { subtotal: 50, total: 54.13 } },
          { id: "i4", invoiceStatus: "awaiting_payment", amounts: { subtotal: 500, total: 541.25 } },
        ],
        pageInfo: { hasNextPage: false },
      },
    }), ctx());
    expect(m.job.invoice_count).toBe(2);
    expect(m.job.invoices_nonvoid_total).toBe(1623.75);
    expect(m.job.invoices_nonvoid_subtotal).toBe(1500);
  });

  it("are left empty when Jobber has more invoices than were fetched", () => {
    const m = mapJob(job({
      invoices: { nodes: [{ id: "i1", invoiceStatus: "paid", amounts: { subtotal: 1, total: 1 } }], pageInfo: { hasNextPage: true } },
    }), ctx());
    expect(m.job.invoices_nonvoid_total).toBeNull();
    expect(m.notes.length).toBe(1);
  });

  it("are left empty when the app may not read invoices", () => {
    const m = mapJob(job({ invoices: null }), ctx({ invoicesAvailable: false }));
    expect(m.job.invoices_nonvoid_total).toBeNull();
    expect(m.job.invoice_count).toBe(0);
  });
});

describe("dates in the company's time zone", () => {
  it("a late-evening completion counts on the local day", () => {
    expect(localDate("2026-10-01T03:30:00Z", "America/Chicago")).toBe("2026-09-30");
    expect(localDate("2026-10-01T05:30:00Z", "America/Chicago")).toBe("2026-10-01");
  });

  it("handles the end of daylight saving time", () => {
    expect(localDate("2026-11-01T04:30:00Z", "America/Chicago")).toBe("2026-10-31");
    expect(localDate("2026-11-02T05:30:00Z", "America/Chicago")).toBe("2026-11-01");
  });

  it("finds the last day of the month", () => {
    expect(monthEndLocal("2026-09-30")).toBe("2026-09-30");
    expect(monthEndLocal("2026-02-10")).toBe("2026-02-28");
    expect(monthEndLocal("2028-02-01")).toBe("2028-02-29");
    expect(monthEndLocal("2026-12-05")).toBe("2026-12-31");
  });
});

describe("scheduled work for the forecast", () => {
  it("values each visit by what it will add to revenue, per local day", () => {
    const byDay = scheduledByDay([
      // visit-billed: its line items
      { id: "s1", startAt: "2026-10-20T15:00:00Z", lineItems: { nodes: [{ totalPrice: 300 }, { totalPrice: 45.5 }] },
        job: { id: "j-vb", jobType: "ONE_OFF", billingType: "VISIT_BASED", total: 0 } },
      // one-off fixed price: whole total on the last scheduled visit only
      { id: "s2", startAt: "2026-10-21T15:00:00Z", isLastScheduledVisit: false, job: { id: "j-fp", jobType: "ONE_OFF", billingType: "FIXED_PRICE", total: 4000 } },
      { id: "s3", startAt: "2026-10-22T15:00:00Z", isLastScheduledVisit: true, job: { id: "j-fp", jobType: "ONE_OFF", billingType: "FIXED_PRICE", total: 4000 } },
      // recurring fixed price: the stored per-visit amount
      { id: "s4", startAt: "2026-10-22T16:00:00Z", job: { id: "j-rec", jobType: "RECURRING", billingType: "FIXED_PRICE", total: 1200 } },
      // recurring with no stored amount yet: nothing
      { id: "s5", startAt: "2026-10-23T16:00:00Z", job: { id: "j-new", jobType: "RECURRING", billingType: "FIXED_PRICE", total: 600 } },
      // evening visit on the 23rd local, the 24th in UTC
      { id: "s6", startAt: "2026-10-24T01:00:00Z", lineItems: { nodes: [{ totalPrice: 75 }] },
        job: { id: "j-vb2", jobType: "ONE_OFF", billingType: "VISIT_BASED", total: 0 } },
    ], "America/Chicago", { "j-rec": 100 });
    expect(byDay).toEqual({ "2026-10-20": 345.5, "2026-10-22": 4100, "2026-10-23": 75 });
  });
});

describe("money", () => {
  it("rounds to cents", () => {
    expect(cents(0.1 + 0.2)).toBe(0.3);
    expect(visitLineItemTotal(visit("v", "2026-01-01T00:00:00Z", [0.1, 0.2, 10.004]))).toBe(10.3);
  });
});
