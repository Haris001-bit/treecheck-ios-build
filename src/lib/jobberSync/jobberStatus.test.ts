// TreeCheck Jobber sync: quote status mapping, job statuses, completion and visit days (synthetic data only).
import { describe, expect, it } from "vitest";
import {
  CLOSED_WORKFLOW,
  completionDecision,
  type CompletionSyncState,
  isOpenWorkflow,
  type JobCompletionFacts,
  mapQuoteStatus,
  OPEN_WORKFLOW,
  visitDateMatch,
  type VisitTimes,
} from "../../../supabase/functions/_shared/jobberStatus";
import { addDays, busyDayCounts } from "../../../supabase/functions/_shared/freeDays";

describe("mapQuoteStatus", () => {
  it("maps every Jobber quote status to pending, approved or archived, keeping the detail", () => {
    expect(mapQuoteStatus("draft")).toEqual({ quoteStatus: "pending", detail: "draft" });
    expect(mapQuoteStatus("awaiting_response")).toEqual({ quoteStatus: "pending", detail: "awaiting_response" });
    expect(mapQuoteStatus("changes_requested")).toEqual({ quoteStatus: "pending", detail: "changes_requested" });
    expect(mapQuoteStatus("approved")).toEqual({ quoteStatus: "approved", detail: "approved" });
    expect(mapQuoteStatus("converted")).toEqual({ quoteStatus: "approved", detail: "converted" });
    expect(mapQuoteStatus("archived")).toEqual({ quoteStatus: "archived", detail: "archived" });
  });

  it("ignores case and separators until Step 0 confirms the enum spelling", () => {
    expect(mapQuoteStatus("AWAITING_RESPONSE")).toEqual({ quoteStatus: "pending", detail: "awaiting_response" });
    expect(mapQuoteStatus("awaitingResponse")).toEqual({ quoteStatus: "pending", detail: "awaiting_response" });
    expect(mapQuoteStatus("Changes requested")).toEqual({ quoteStatus: "pending", detail: "changes_requested" });
    expect(mapQuoteStatus(" Approved ")).toEqual({ quoteStatus: "approved", detail: "approved" });
    expect(mapQuoteStatus("CONVERTED")).toEqual({ quoteStatus: "approved", detail: "converted" });
    expect(mapQuoteStatus("Archived")).toEqual({ quoteStatus: "archived", detail: "archived" });
  });

  it("leaves bid_requests alone for a status it does not know, and keeps the text as the detail", () => {
    expect(mapQuoteStatus("EXPIRED")).toEqual({ quoteStatus: null, detail: "expired" });
    expect(mapQuoteStatus("declined")).toEqual({ quoteStatus: null, detail: "declined" });
    const long = mapQuoteStatus("X".repeat(60));
    expect(long.quoteStatus).toBeNull();
    expect(long.detail).toBe("x".repeat(40));
  });

  it("returns nothing when Jobber sent no status", () => {
    for (const status of [null, undefined, "", "   "]) {
      expect(mapQuoteStatus(status)).toEqual({ quoteStatus: null, detail: null });
    }
    expect(mapQuoteStatus(42 as unknown as string)).toEqual({ quoteStatus: null, detail: null });
  });
});

describe("workflow statuses", () => {
  it("match the Bid Board's open and archived lists", () => {
    expect([...OPEN_WORKFLOW]).toEqual(["open", "assessment_scheduled", "quote_sent", "quote_accepted", "job_scheduled"]);
    expect([...CLOSED_WORKFLOW]).toEqual(["job_complete", "quote_declined", "no_longer_needed", "unresponsive"]);
    expect(OPEN_WORKFLOW.some((s) => (CLOSED_WORKFLOW as readonly string[]).includes(s))).toBe(false);
  });

  it("are frozen", () => {
    expect(Object.isFrozen(OPEN_WORKFLOW)).toBe(true);
    expect(Object.isFrozen(CLOSED_WORKFLOW)).toBe(true);
    expect(() => (OPEN_WORKFLOW as unknown as string[]).push("job_complete")).toThrow();
  });

  it("isOpenWorkflow counts a missing status as open and anything unknown as not open", () => {
    for (const s of OPEN_WORKFLOW) expect(isOpenWorkflow(s)).toBe(true);
    for (const s of CLOSED_WORKFLOW) expect(isOpenWorkflow(s)).toBe(false);
    expect(isOpenWorkflow(null)).toBe(true);
    expect(isOpenWorkflow(undefined)).toBe(true);
    expect(isOpenWorkflow("something_new")).toBe(false);
  });
});

describe("completionDecision", () => {
  const COMPLETED_AT = "2026-10-20T22:15:00Z";
  const job = (over: Partial<JobCompletionFacts> = {}): JobCompletionFacts => ({
    jobStatus: "requires_invoicing",
    completedAt: COMPLETED_AT,
    incompleteVisits: 0,
    completedVisits: 1,
    ...over,
  });
  const tc = (over: Partial<CompletionSyncState> = {}): CompletionSyncState => ({
    workflowStatus: "job_scheduled",
    completionSyncedAt: null,
    jobberCompletedAt: null,
    ...over,
  });

  it("is complete once Jobber closes the job with every visit done", () => {
    expect(completionDecision(job(), tc())).toBe("complete");
    expect(completionDecision(job())).toBe("complete");
    for (const s of OPEN_WORKFLOW) expect(completionDecision(job(), tc({ workflowStatus: s }))).toBe("complete");
    expect(completionDecision(job(), tc({ workflowStatus: null }))).toBe("complete");
  });

  it("counts requires_invoicing or archived as closed without a completedAt, in any case", () => {
    for (const jobStatus of ["requires_invoicing", "REQUIRES_INVOICING", "requiresInvoicing", "archived", "ARCHIVED"]) {
      expect(completionDecision(job({ jobStatus, completedAt: null }), tc())).toBe("complete");
    }
    expect(completionDecision(job({ jobStatus: "active", completedAt: COMPLETED_AT }), tc())).toBe("complete");
  });

  it("is never complete without a completed visit", () => {
    expect(completionDecision(job({ completedVisits: 0 }), tc())).toBe("cancelled");
    expect(completionDecision(job({ completedVisits: 3 }), tc())).toBe("complete");
  });

  it("is never complete while a visit is still open", () => {
    expect(completionDecision(job({ incompleteVisits: 1 }), tc())).toBe("noop");
    expect(completionDecision(job({ incompleteVisits: null }), tc())).toBe("noop");
  });

  it("does nothing while the job is open in Jobber, so reopening never reverts anything", () => {
    for (const jobStatus of ["active", "upcoming", "today", "late", "action_required", "unscheduled", null]) {
      expect(completionDecision(job({ jobStatus, completedAt: null }), tc())).toBe("noop");
      expect(completionDecision(job({ jobStatus, completedAt: null }), tc({ workflowStatus: "job_complete" }))).toBe("noop");
    }
    expect(completionDecision(job({ jobStatus: "active", completedAt: "not a time" }), tc())).toBe("noop");
  });

  it("is cancelled when Jobber closes or archives the job with no completed visit", () => {
    expect(completionDecision(job({ jobStatus: "archived", completedAt: null, completedVisits: 0, incompleteVisits: 2 }), tc()))
      .toBe("cancelled");
    expect(completionDecision(job({ completedVisits: 0, incompleteVisits: 0 }), tc())).toBe("cancelled");
    expect(completionDecision(job({ completedVisits: 0 }))).toBe("cancelled");
  });

  it("sends no cancellation for a job TreeCheck has already closed", () => {
    for (const s of CLOSED_WORKFLOW) {
      expect(completionDecision(job({ jobStatus: "archived", completedVisits: 0 }), tc({ workflowStatus: s }))).toBe("noop");
    }
  });

  it("only records the completion when TreeCheck's status was set by hand", () => {
    for (const s of [...CLOSED_WORKFLOW, "something_new"]) {
      expect(completionDecision(job(), tc({ workflowStatus: s }))).toBe("record_only");
    }
  });

  it("never syncs the same completion twice, even after the office moves the status back", () => {
    const synced = { completionSyncedAt: "2026-10-20T22:16:00Z", jobberCompletedAt: COMPLETED_AT };
    expect(completionDecision(job(), tc(synced))).toBe("record_only");
    // The same instant in another ISO spelling is the same completion.
    expect(completionDecision(job({ completedAt: "2026-10-20T22:15:00.000+00:00" }), tc(synced))).toBe("record_only");
    expect(completionDecision(job({ completedAt: "2026-10-20T17:15:00-05:00" }), tc(synced))).toBe("record_only");
    // Closed by status alone, synced with no completedAt: still the same completion.
    expect(completionDecision(job({ completedAt: null }), tc({ completionSyncedAt: "2026-10-20T22:16:00Z" }))).toBe("record_only");
  });

  it("re-arms only when Jobber's completedAt changes", () => {
    const synced = { completionSyncedAt: "2026-10-20T22:16:00Z", jobberCompletedAt: COMPLETED_AT };
    const closedAgain = job({ completedAt: "2026-10-27T15:00:00Z" });
    expect(completionDecision(closedAgain, tc(synced))).toBe("complete");
    // Still never over a status that is not open.
    expect(completionDecision(closedAgain, tc({ ...synced, workflowStatus: "job_complete" }))).toBe("record_only");
  });

  it("does nothing for a deleted job, unread visit counts or no job at all", () => {
    expect(completionDecision(job({ deleted: true }), tc())).toBe("noop");
    for (const completedVisits of [null, Number.NaN, -1, 1.5]) {
      expect(completionDecision(job({ completedVisits }), tc())).toBe("noop");
    }
    expect(completionDecision(job({ incompleteVisits: -1 }), tc())).toBe("noop");
    expect(completionDecision(null, tc())).toBe("noop");
    expect(completionDecision(undefined)).toBe("noop");
  });
});

describe("visitDateMatch", () => {
  const TZ = "America/Chicago";

  it("matches a visit on the day, read in the company time zone", () => {
    // 8:00 am Chicago time (CDT, UTC-5).
    expect(visitDateMatch([{ startAt: "2026-10-20T13:00:00Z", endAt: "2026-10-20T22:00:00Z" }], "2026-10-20", TZ))
      .toEqual({ matches: true, visitDates: ["2026-10-20"], unreadable: 0 });
    expect(visitDateMatch([{ startAt: "2026-10-20T08:00:00-05:00" }], "2026-10-20", TZ).matches).toBe(true);
  });

  it("keeps an evening visit on its local day (Step 0 test T7's 7:30 pm case)", () => {
    // 7:30 pm Chicago time is 00:30 the next day in UTC.
    expect(visitDateMatch([{ startAt: "2026-10-21T00:30:00Z", endAt: "2026-10-21T02:30:00Z" }], "2026-10-20", TZ))
      .toEqual({ matches: true, visitDates: ["2026-10-20"], unreadable: 0 });
    expect(visitDateMatch([{ startAt: "2026-10-21T00:30:00Z" }], "2026-10-21", TZ).matches).toBe(false);
  });

  it("does not match a visit on another day, and gives that visit's day", () => {
    expect(visitDateMatch([{ startAt: "2026-10-22T13:00:00Z" }], "2026-10-20", TZ))
      .toEqual({ matches: false, visitDates: ["2026-10-22"], unreadable: 0 });
  });

  it("matches every day a multi-day visit covers", () => {
    const twoDays = [{ startAt: "2026-10-20T13:00:00Z", endAt: "2026-10-21T22:00:00Z" }];
    expect(visitDateMatch(twoDays, "2026-10-20", TZ).matches).toBe(true);
    expect(visitDateMatch(twoDays, "2026-10-21", TZ).matches).toBe(true);
    expect(visitDateMatch(twoDays, "2026-10-22", TZ).matches).toBe(false);
    expect(visitDateMatch(twoDays, "2026-10-19", TZ).matches).toBe(false);
    expect(visitDateMatch(twoDays, "2026-10-21", TZ).visitDates).toEqual(["2026-10-20"]);
  });

  it("does not let a visit ending at local midnight cover the next day", () => {
    // Ends at 00:00 Chicago time on Oct 21 (05:00 UTC).
    expect(visitDateMatch([{ startAt: "2026-10-20T13:00:00Z", endAt: "2026-10-21T05:00:00Z" }], "2026-10-21", TZ).matches).toBe(false);
    // Ends at 00:30 Chicago time on Oct 21: that day is covered.
    expect(visitDateMatch([{ startAt: "2026-10-20T13:00:00Z", endAt: "2026-10-21T05:30:00Z" }], "2026-10-21", TZ).matches).toBe(true);
  });

  it("reads an end that is missing, unreadable or not after the start as the start day", () => {
    for (const endAt of [null, undefined, "not a time", "2026-10-20T13:00:00Z", "2026-10-19T13:00:00Z"]) {
      expect(visitDateMatch([{ startAt: "2026-10-20T13:00:00Z", endAt }], "2026-10-20", TZ).matches).toBe(true);
      expect(visitDateMatch([{ startAt: "2026-10-20T13:00:00Z", endAt }], "2026-10-19", TZ).matches).toBe(false);
    }
  });

  it("keeps local days right across daylight-saving changes", () => {
    // Nov 1, 2026: 11:30 pm Chicago time after the fall-back change (CST, UTC-6).
    expect(visitDateMatch([{ startAt: "2026-11-02T05:30:00Z" }], "2026-11-01", TZ).matches).toBe(true);
    // Mar 8, 2026: 11:30 pm Chicago time after the spring-forward change (CDT, UTC-5).
    expect(visitDateMatch([{ startAt: "2026-03-09T04:30:00Z" }], "2026-03-08", TZ).matches).toBe(true);
  });

  it("uses the company's time zone, with America/Chicago when it is missing", () => {
    // 04:30 UTC on Oct 21 is still Oct 20 in Chicago and Los Angeles, but Oct 21 in New York.
    const visits = [{ startAt: "2026-10-21T04:30:00Z" }];
    expect(visitDateMatch(visits, "2026-10-20", "America/Chicago").matches).toBe(true);
    expect(visitDateMatch(visits, "2026-10-20", "America/Los_Angeles").matches).toBe(true);
    expect(visitDateMatch(visits, "2026-10-21", "America/New_York").matches).toBe(true);
    expect(visitDateMatch(visits, "2026-10-20", null).matches).toBe(true);
    expect(visitDateMatch(visits, "2026-10-20", "").matches).toBe(true);
    expect(visitDateMatch(visits, "2026-10-20").matches).toBe(true);
  });

  it("ignores unscheduled visits, counts a start it can't read, and lists the others' days once, in order", () => {
    const visits = [
      { startAt: "2026-10-27T13:00:00Z" },
      { startAt: null },
      {},
      { startAt: "not a time" },
      { startAt: "2026-10-20T13:00:00Z" },
      { startAt: "2026-10-20T18:00:00Z" },
    ];
    expect(visitDateMatch(visits, "2026-10-20", TZ)).toEqual({ matches: true, visitDates: ["2026-10-20", "2026-10-27"], unreadable: 1 });
    expect(visitDateMatch([], "2026-10-20", TZ)).toEqual({ matches: false, visitDates: [], unreadable: 0 });
    expect(visitDateMatch(null, "2026-10-20", TZ)).toEqual({ matches: false, visitDates: [], unreadable: 0 });
    expect(visitDateMatch(undefined, "2026-10-20", TZ)).toEqual({ matches: false, visitDates: [], unreadable: 0 });
  });

  it("counts every visit given a start it can't read, never an unscheduled one, and never throws", () => {
    const visits = [
      { startAt: "2026-10-20T13:00:00" }, // no zone (a mapping bug before Step 0 test T7)
      { startAt: "2026-10-20" }, // a day with no time
      { startAt: "not a time" },
      { startAt: "2026-13-45T25:00:00Z" }, // written with a zone, but no such time
      { startAt: null },
      { startAt: "" },
      {},
      { startAt: "2026-10-22T13:00:00Z" },
    ];
    expect(visitDateMatch(visits, "2026-10-20", TZ)).toEqual({ matches: false, visitDates: ["2026-10-22"], unreadable: 4 });
    // Something that is not a visit at all came from a mapping bug too.
    const broken = [null, "2026-10-20T13:00:00Z", 42] as unknown as VisitTimes[];
    expect(visitDateMatch(broken, "2026-10-20", TZ)).toEqual({ matches: false, visitDates: [], unreadable: 3 });
  });

  it("never matches without a valid date, but still lists the visit days", () => {
    const visits = [{ startAt: "2026-10-20T13:00:00Z" }];
    for (const date of [null, "", "Oct 20", "2026-10-20T00:00:00Z"]) {
      expect(visitDateMatch(visits, date, TZ)).toEqual({ matches: false, visitDates: ["2026-10-20"], unreadable: 0 });
    }
  });
});

describe("visit days agree with freeDays.busyDayCounts", () => {
  // jobberStatus.ts keeps a private copy of freeDays' visit-day reading (see its header). Every visit
  // whose times are readable must land on the same local days in both. Unreadable times are left out on
  // purpose: there freeDays throws so the calendar falls back, and visitDateMatch skips the visit.
  // Phoenix has no daylight saving, so it is the control.
  const ZONES = ["America/Chicago", "America/New_York", "America/Phoenix"];
  // 38 hourly starts from Saturday 18:00 UTC on both 2026 daylight-saving weekends: they cover the
  // change itself and the Sunday and Monday local midnights in every zone above.
  const WINDOWS = ["2026-03-07T18:00:00Z", "2026-10-31T18:00:00Z"];
  const STARTS = 38;
  // Visit lengths in minutes: null is no end, 0 an end that is not after the start, 1500 is 25 hours.
  // Visits with no end start at half past on odd hours, so some start late in a local day.
  const LENGTHS: (number | null)[] = [null, 0, 1, 360, 1440, 1500, 2820];
  const HOUR = 3_600_000;

  // The same instant written with a fixed offset, so "+hh:mm" and "-hh:mm" times are read as well as "Z" ones.
  function withOffset(ms: number, offsetMinutes: number): string {
    const sign = offsetMinutes < 0 ? "-" : "+";
    const abs = Math.abs(offsetMinutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
  }

  it("puts every readable visit on the same local days, across zones and daylight-saving changes", () => {
    const mismatches: string[] = [];
    let compared = 0;
    for (const zone of ZONES) {
      for (const from of WINDOWS) {
        for (let h = 0; h < STARTS; h++) {
          for (const length of LENGTHS) {
            const startMs = Date.parse(from) + h * HOUR + (length === null && h % 2 ? HOUR / 2 : 0);
            const startAt = h % 2 ? new Date(startMs).toISOString() : withOffset(startMs, -300);
            const endMs = length === null ? null : startMs + length * 60_000;
            const endAt = endMs === null ? null : h % 3 ? withOffset(endMs, 330) : new Date(endMs).toISOString();
            const visit = { startAt, endAt };
            const busy = Object.keys(busyDayCounts([visit], zone)).sort();
            // Each day from the one before freeDays' first busy day through the one after its last.
            const matched: string[] = [];
            let starts: string[] = [];
            if (busy.length) {
              const stop = addDays(busy[busy.length - 1], 1);
              for (let day = addDays(busy[0], -1); day <= stop; day = addDays(day, 1)) {
                const result = visitDateMatch([visit], day, zone);
                starts = result.visitDates;
                if (result.matches) matched.push(day);
              }
            }
            if (!busy.length || starts.join() !== busy[0] || matched.join() !== busy.join()) {
              mismatches.push(`${zone} ${startAt} to ${endAt}: freeDays [${busy}], visitDateMatch [${matched}] from [${starts}]`);
            }
            compared++;
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBe(ZONES.length * WINDOWS.length * STARTS * LENGTHS.length);
  }, 30_000);
});
