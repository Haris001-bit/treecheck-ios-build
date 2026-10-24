// Jobs calendar (JS2): Jobber's visit days for jobs made from a TreeCheck quote (jobberVisitDays.ts). Jobber and
// the database are stubbed; the clock is fixed at Thursday 2026-10-15, Central time. Synthetic data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  coveredUntil,
  jobVisitDays,
  MAX_PAGES,
  syncVisitDays,
  visitDaysWindow,
} from "../../../supabase/functions/_shared/jobberVisitDays";

const TZ = "America/Chicago";
const NOW = new Date("2026-10-15T15:00:00Z");
const JOBS = new Map([["Q1", "JOB-1"], ["Q2", "JOB-2"]]);

const visit = (startAt: string | null, endAt: string | null, quote: string | null = "Q1", extra: Record<string, unknown> = {}) =>
  ({ startAt, endAt, allDay: false, isComplete: false, job: { id: `J-${quote}`, quote: quote ? { id: quote } : null }, ...extra });

const days = (visits: unknown[], from = "2026-09-15", to = "2027-01-13") =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jobVisitDays(visits as any, JOBS, TZ, from, to);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("visitDaysWindow", () => {
  it("keeps 30 days back to 90 ahead in step, reading a week before and two days after", () => {
    expect(visitDaysWindow("2026-10-15")).toEqual({
      from: "2026-09-15",
      to: "2027-01-13",
      readFrom: "2026-09-07T00:00:00Z",
      readTo: "2027-01-15T00:00:00Z",
    });
  });
});

describe("jobVisitDays", () => {
  it("reads each visit's local days in the company's time zone", () => {
    const { rows, unreadable } = days([
      // 10:00 pm Monday in Chicago is already Tuesday in UTC.
      visit("2026-10-13T03:00:00Z", "2026-10-13T04:00:00Z"),
      // Two days.
      visit("2026-10-20T14:00:00Z", "2026-10-21T22:00:00Z", "Q2"),
      // Ends at local midnight: the next day stays out.
      visit("2026-10-22T14:00:00Z", "2026-10-23T05:00:00Z"),
      // All day: local midnight to local midnight.
      visit("2026-10-24T05:00:00Z", "2026-10-25T05:00:00Z", "Q1", { allDay: true }),
    ]);
    expect(unreadable).toBe(0);
    expect(rows).toEqual([
      { bid_request_id: "JOB-1", day: "2026-10-12" },
      { bid_request_id: "JOB-1", day: "2026-10-22" },
      { bid_request_id: "JOB-1", day: "2026-10-24" },
      { bid_request_id: "JOB-2", day: "2026-10-20" },
      { bid_request_id: "JOB-2", day: "2026-10-21" },
    ]);
  });

  it("follows the clock change on 2026-11-01", () => {
    // 11:30 pm Sunday Central Standard Time (UTC-6), which would be Monday under daylight time.
    expect(days([visit("2026-11-02T05:30:00Z", "2026-11-02T05:45:00Z")]).rows)
      .toEqual([{ bid_request_id: "JOB-1", day: "2026-11-01" }]);
  });

  it("counts completed visits, because the calendar shows where the work was", () => {
    expect(days([visit("2026-10-08T15:00:00Z", "2026-10-08T17:00:00Z", "Q1", { isComplete: true })]).rows)
      .toEqual([{ bid_request_id: "JOB-1", day: "2026-10-08" }]);
  });

  it("leaves out visits of jobs not made from a TreeCheck quote, and visits with no start", () => {
    const { rows, unreadable } = days([
      visit("2026-10-20T15:00:00Z", null, "OTHER"),
      visit("2026-10-20T15:00:00Z", null, null),
      visit(null, null),
    ]);
    expect(rows).toEqual([]);
    expect(unreadable).toBe(0);
  });

  it("counts a time without a zone as unreadable instead of failing the run", () => {
    const { rows, unreadable } = days([visit("2026-10-20T10:00:00", null), visit("2026-10-21T15:00:00Z", null)]);
    expect(unreadable).toBe(1);
    expect(rows).toEqual([{ bid_request_id: "JOB-1", day: "2026-10-21" }]);
  });

  it("keeps only the window's days, once each", () => {
    const { rows } = days([
      visit("2026-09-10T15:00:00Z", "2026-09-16T15:00:00Z"), // starts before the window
      visit("2026-09-15T15:00:00Z", null), // same day again
      visit("2027-02-01T15:00:00Z", null), // after the window
    ]);
    expect(rows).toEqual([
      { bid_request_id: "JOB-1", day: "2026-09-15" },
      { bid_request_id: "JOB-1", day: "2026-09-16" },
    ]);
  });
});

describe("coveredUntil", () => {
  it("is the window's end when every page was read", () => {
    expect(coveredUntil([visit("2026-11-20T15:00:00Z", null)], false, TZ, "2027-01-13")).toBe("2027-01-13");
  });

  it("is the day before the last visit read when pages are left", () => {
    expect(coveredUntil([visit("2026-10-20T15:00:00Z", null), visit("2026-11-20T15:00:00Z", null)], true, TZ, "2027-01-13"))
      .toBe("2026-11-19");
  });

  it("is null when no visit time can be trusted", () => {
    expect(coveredUntil([], true, TZ, "2027-01-13")).toBeNull();
    expect(coveredUntil([visit("2026-11-20T15:00:00", null)], true, TZ, "2027-01-13")).toBeNull();
  });
});

// A database stand-in: the claim, the linked jobs and the replace.
function fakeAdmin(opts: { due?: boolean; linked?: Array<{ id: string; jobber_quote_id: string }>; replaceError?: string } = {}) {
  const rpc: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpc.push({ name, args });
      if (name === "claim_jobber_visit_days") return { data: opts.due ?? true, error: null };
      if (name === "replace_job_jobber_days") {
        return opts.replaceError
          ? { data: null, error: { message: opts.replaceError } }
          : { data: (args.p_rows as unknown[]).length, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        not: async () => ({ data: opts.linked ?? [{ id: "JOB-1", jobber_quote_id: "Q1" }], error: null }),
      };
      return q;
    },
  };
  return { admin, rpc, replaces: () => rpc.filter((c) => c.name === "replace_job_jobber_days") };
}

type Page = { nodes: unknown[]; hasNextPage?: boolean; endCursor?: string | null };

function stubVisits(...pages: Array<Page | { status: number }>) {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)).variables);
    const page = pages[Math.min(calls.length - 1, pages.length - 1)];
    if ("status" in page) return new Response("{}", { status: page.status });
    return new Response(JSON.stringify({
      data: { visits: { nodes: page.nodes, pageInfo: { hasNextPage: page.hasNextPage ?? false, endCursor: page.endCursor ?? null } } },
      extensions: { cost: { requestedQueryCost: 202, actualQueryCost: 12, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 9988, restoreRate: 500 } } },
    }), { status: 200 });
  }));
  return calls;
}

const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
};

describe("syncVisitDays", () => {
  const opts = { tz: TZ, now: NOW, budgetMs: 5_000 };

  it("does nothing when the company was synced in the last 9 minutes: no token, no Jobber read", async () => {
    quiet();
    const calls = stubVisits({ nodes: [] });
    const token = vi.fn(async () => "tok");
    const { admin, rpc } = fakeAdmin({ due: false });
    const r = await syncVisitDays(admin, "OWNER-1", { ...opts, token });
    expect(r.state).toBe("not_due");
    expect(token).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(rpc.map((c) => c.name)).toEqual(["claim_jobber_visit_days"]);
  });

  it("clears old days and skips Jobber when no job is linked", async () => {
    quiet();
    const calls = stubVisits({ nodes: [] });
    const { admin, replaces } = fakeAdmin({ linked: [] });
    const r = await syncVisitDays(admin, "OWNER-1", { ...opts, token: async () => "tok" });
    expect(r.state).toBe("no_linked_jobs");
    expect(calls).toHaveLength(0);
    expect(replaces()).toEqual([{ name: "replace_job_jobber_days", args: { p_owner: "OWNER-1", p_from: "2026-09-15", p_to: "2027-01-13", p_rows: [] } }]);
  });

  it("writes nothing when Jobber isn't connected", async () => {
    quiet();
    const calls = stubVisits({ nodes: [] });
    const { admin, replaces } = fakeAdmin();
    const r = await syncVisitDays(admin, "OWNER-1", { ...opts, token: async () => null });
    expect(r.state).toBe("not_connected");
    expect(calls).toHaveLength(0);
    expect(replaces()).toHaveLength(0);
  });

  it("reads every page and saves the whole window", async () => {
    quiet();
    const calls = stubVisits(
      { nodes: [visit("2026-10-20T15:00:00Z", null)], hasNextPage: true, endCursor: "c1" },
      { nodes: [visit("2026-10-27T15:00:00Z", null), visit("2026-10-28T15:00:00Z", null, "NOT-OURS")] },
    );
    const { admin, replaces } = fakeAdmin();
    const r = await syncVisitDays(admin, "OWNER-1", { ...opts, token: async () => "tok" });
    expect(r).toMatchObject({ state: "synced", jobs: 1, days: 2, pages: 2, unreadable: 0 });
    expect(calls.map((v) => v.after)).toEqual([null, "c1"]);
    expect(calls[0]).toMatchObject({ from: "2026-09-07T00:00:00Z", to: "2027-01-15T00:00:00Z" });
    expect(replaces()[0].args).toEqual({
      p_owner: "OWNER-1",
      p_from: "2026-09-15",
      p_to: "2027-01-13",
      p_rows: [{ bid_request_id: "JOB-1", day: "2026-10-20" }, { bid_request_id: "JOB-1", day: "2026-10-27" }],
    });
  });

  it("at the page cap, saves only the days fully read", async () => {
    quiet();
    const calls = stubVisits({ nodes: [visit("2026-11-20T15:00:00Z", null)], hasNextPage: true, endCursor: "more" });
    const { admin, replaces } = fakeAdmin();
    const r = await syncVisitDays(admin, "OWNER-1", { ...opts, token: async () => "tok" });
    expect(r.state).toBe("partial");
    expect(calls).toHaveLength(MAX_PAGES);
    expect(replaces()[0].args).toMatchObject({ p_from: "2026-09-15", p_to: "2026-11-19", p_rows: [] });
  });

  it("writes nothing when Jobber refuses the read", async () => {
    quiet();
    stubVisits({ status: 400 });
    const { admin, replaces } = fakeAdmin();
    const r = await syncVisitDays(admin, "OWNER-1", { ...opts, token: async () => "tok" });
    expect(r.state).toBe("failed");
    expect(replaces()).toHaveLength(0);
  });

  it("reports a failed save instead of throwing", async () => {
    quiet();
    stubVisits({ nodes: [visit("2026-10-20T15:00:00Z", null)] });
    const { admin } = fakeAdmin({ replaceError: "permission denied" });
    const r = await syncVisitDays(admin, "OWNER-1", { ...opts, token: async () => "tok" });
    expect(r.state).toBe("failed");
    expect(r.error).toContain("permission denied");
  });
});
