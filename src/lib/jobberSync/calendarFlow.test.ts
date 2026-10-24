// Jobber milestone: free days (jobberCalendar.ts). The days offered to climbers leave out days booked in
// Jobber and days the company is closed; a climber's picked days are checked the same way. Jobber is
// stubbed; the clock is fixed at Friday 2026-10-09, Central time, with Thursday and Friday closed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarDays, dayLabel, refusalText, toBusyVisit } from "../../../supabase/functions/_shared/jobberCalendar";
import { pickOfferedDates, validatePickedDates } from "../../../supabase/functions/_shared/freeDays";

const NOW = new Date("2026-10-09T15:00:00Z");
const BASE = { tz: "America/Chicago", closedWeekdays: [4, 5], busyThreshold: 1, now: NOW, budgetMs: 5_000 };
const withToken = { ...BASE, token: async () => "tok" };

type Page = { nodes: unknown[]; hasNextPage?: boolean; endCursor?: string | null };

function stubVisits(...pages: Array<Page | { status: number }>) {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const { variables } = JSON.parse(String(init.body));
    calls.push(variables);
    const page = pages[Math.min(calls.length - 1, pages.length - 1)];
    if ("status" in page) return new Response("{}", { status: page.status });
    return new Response(JSON.stringify({
      data: { visits: { nodes: page.nodes, pageInfo: { hasNextPage: page.hasNextPage ?? false, endCursor: page.endCursor ?? null } } },
      extensions: { cost: { requestedQueryCost: 202, actualQueryCost: 12, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 9988, restoreRate: 500 } } },
    }), { status: 200 });
  }));
  return calls;
}

const visit = (startAt: string, endAt: string | null, extra: Record<string, unknown> = {}) => ({ startAt, endAt, allDay: false, isComplete: false, job: { id: "J1" }, ...extra });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Jobber visits", () => {
  it("map to busy-count visits", () => {
    expect(toBusyVisit({ startAt: "2026-10-12T19:00:00Z", endAt: null, allDay: null, isComplete: true, job: { id: "J9" } }))
      .toEqual({ startAt: "2026-10-12T19:00:00Z", endAt: null, allDay: false, isComplete: true, jobId: "J9" });
  });
});

describe("calendarDays", () => {
  it("leaves out booked and closed days from the days offered", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = stubVisits({ nodes: [
      visit("2026-10-12T19:00:00Z", "2026-10-12T21:00:00Z"),
      // All day on Tuesday: local midnight to local midnight, so Wednesday stays free.
      visit("2026-10-13T05:00:00Z", "2026-10-14T05:00:00Z", { allDay: true }),
      // A finished visit never books a day.
      visit("2026-10-19T15:00:00Z", "2026-10-19T17:00:00Z", { isComplete: true }),
    ] });
    const cal = await calendarDays({}, "OWNER", { ...withToken, startOffset: 1, days: 28 });
    expect(cal.source).toBe("jobber");
    expect(cal.today).toBe("2026-10-09");
    const status = Object.fromEntries(cal.statuses.map((s) => [s.date, s.status]));
    expect(status).toMatchObject({
      "2026-10-12": "busy",
      "2026-10-13": "busy",
      "2026-10-14": "free",
      "2026-10-15": "closed",
      "2026-10-16": "closed",
      "2026-10-19": "free",
    });
    expect(pickOfferedDates(cal.statuses, 4)).toEqual(["2026-10-14", "2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(calls[0]).toEqual({ from: "2026-10-02T00:00:00Z", to: "2026-11-08T00:00:00Z", after: null });
  });

  it("reads further pages, up to the cap", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = stubVisits(
      { nodes: [visit("2026-10-12T19:00:00Z", null)], hasNextPage: true, endCursor: "c1" },
      { nodes: [visit("2026-10-20T19:00:00Z", null)], hasNextPage: false },
    );
    const cal = await calendarDays({}, "OWNER", { ...withToken, days: 28 });
    expect(calls.map((c) => c.after)).toEqual([null, "c1"]);
    expect(cal.statuses.find((s) => s.date === "2026-10-20")?.status).toBe("busy");
  });

  it("without Jobber, still leaves out closed days and treats the rest as not checked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubVisits({ status: 500 });
    const down = await calendarDays({}, "OWNER", { ...withToken, startOffset: 1, days: 14 });
    expect(down.source).toBe("unavailable");
    expect(down.statuses.find((s) => s.date === "2026-10-15")?.status).toBe("closed");
    expect(down.statuses.find((s) => s.date === "2026-10-12")?.status).toBe("unknown");
    expect(pickOfferedDates(down.statuses, 4)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-19"]);

    const notConnected = await calendarDays({}, "OWNER", { ...BASE, token: async () => null, startOffset: 1, days: 14 });
    expect(notConnected.source).toBe("not_connected");
    expect(pickOfferedDates(notConnected.statuses, 2)).toEqual(["2026-10-12", "2026-10-13"]);
  });

  it("refuses a picked booked or closed day, and drops past days", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    stubVisits({ nodes: [visit("2026-10-12T19:00:00Z", null)] });
    const cal = await calendarDays({}, "OWNER", { ...withToken, days: 62 });
    const picked = validatePickedDates(["2026-10-08", "2026-10-12", "2026-10-15", "2026-10-14", "wants-site-visit"],
      { today: cal.today, statuses: cal.statuses });
    expect(picked.kept).toEqual(["2026-10-14", "wants-site-visit"]);
    expect(picked.rejected).toEqual([
      { date: "2026-10-08", reason: "past" },
      { date: "2026-10-12", reason: "busy" },
      { date: "2026-10-15", reason: "closed" },
    ]);
  });
});

describe("a job's own Jobber visits", () => {
  it("never block the job's own days", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    stubVisits({ nodes: [
      visit("2026-10-12T19:00:00Z", null, { job: { id: "J1", quote: { id: "Q-THIS-JOB" } } }),
      visit("2026-10-13T19:00:00Z", null, { job: { id: "J2", quote: { id: "Q-OTHER" } } }),
      visit("2026-10-14T19:00:00Z", null, { job: { id: "J3", quote: null } }),
    ] });
    const cal = await calendarDays({}, "OWNER", { ...withToken, days: 14, excludeQuoteId: "Q-THIS-JOB" });
    const status = Object.fromEntries(cal.statuses.map((s) => [s.date, s.status]));
    expect(status["2026-10-12"]).toBe("free");
    expect(status["2026-10-13"]).toBe("busy");
    expect(status["2026-10-14"]).toBe("busy");
  });
});

describe("the climber's message", () => {
  it("names the day plainly", () => {
    expect(dayLabel("2026-10-20")).toBe("Tue Oct 20");
    expect(refusalText("2026-10-20", "busy")).toBe("Tue Oct 20 is already booked in Jobber. Pick another day.");
    expect(refusalText("2026-10-15", "closed")).toBe("Thu Oct 15 is a day the company is closed. Pick another day.");
  });
});
