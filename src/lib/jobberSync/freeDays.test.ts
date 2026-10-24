// TreeCheck Jobber sync: free days for climbers (plan sections 4, 8 and 10). Pure functions, no network.
// Chicago is UTC-5 (CDT) from 2026-03-08 08:00Z to 2026-11-01 07:00Z, and UTC-6 (CST) outside it.
import { describe, expect, it } from "vitest";
import {
  addDays,
  busyDayCounts,
  climberDatesPending,
  dayStatuses,
  daysBetween,
  inQuietHours,
  localDateOf,
  pickOfferedDates,
  todayIn,
  validatePickedDates,
  WANTS_SITE_VISIT,
  weekdayOf,
  type BusyCountOptions,
  type BusyVisit,
  type DayStatusInput,
} from "../../../supabase/functions/_shared/freeDays";

const CHI = "America/Chicago";
const at = (iso: string) => new Date(iso);
const isWeekend = (date: string) => weekdayOf(date) === 0 || weekdayOf(date) === 6;

describe("todayIn and localDateOf", () => {
  it("puts a 7:30 pm Chicago time on its local day, not the UTC day", () => {
    expect(localDateOf("2026-10-21T00:30:00Z", CHI)).toBe("2026-10-20");
    expect(localDateOf("2026-10-20T19:30:00-05:00", CHI)).toBe("2026-10-20");
    expect(localDateOf("2026-10-21T00:30:00Z", "UTC")).toBe("2026-10-21");
    expect(todayIn(CHI, at("2026-10-21T04:59:59Z"))).toBe("2026-10-20");
    expect(todayIn(CHI, at("2026-10-21T05:00:00Z"))).toBe("2026-10-21");
  });

  it("finds local midnight around the spring-forward day (2026-03-08 has 23 hours)", () => {
    expect(todayIn(CHI, at("2026-03-08T05:59:59Z"))).toBe("2026-03-07"); // 11:59:59 pm CST
    expect(todayIn(CHI, at("2026-03-08T06:00:00Z"))).toBe("2026-03-08"); // midnight CST
    expect(todayIn(CHI, at("2026-03-09T04:59:59Z"))).toBe("2026-03-08"); // 11:59:59 pm CDT
    expect(todayIn(CHI, at("2026-03-09T05:00:00Z"))).toBe("2026-03-09"); // midnight CDT
  });

  it("finds local midnight around the fall-back day (2026-11-01 has 25 hours)", () => {
    expect(todayIn(CHI, at("2026-11-01T04:59:59Z"))).toBe("2026-10-31");
    expect(todayIn(CHI, at("2026-11-01T05:00:00Z"))).toBe("2026-11-01"); // midnight CDT
    expect(todayIn(CHI, at("2026-11-02T05:59:59Z"))).toBe("2026-11-01"); // 11:59:59 pm CST
    expect(todayIn(CHI, at("2026-11-02T06:00:00Z"))).toBe("2026-11-02"); // midnight CST
  });

  it("refuses times it cannot place in a zone", () => {
    expect(() => localDateOf("not a time", CHI)).toThrow();
    expect(() => localDateOf("2026-10-20T10:00:00", CHI)).toThrow(); // no zone: would depend on the server
    expect(() => localDateOf("2026-10-20", CHI)).toThrow(); // a bare date is not an instant
    expect(() => localDateOf("2026-13-20T10:00:00Z", CHI)).toThrow();
    expect(() => todayIn(CHI, new Date(Number.NaN))).toThrow();
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month and year ends, leap days and both daylight-saving changes", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(addDays("2026-10-20", 0)).toBe("2026-10-20");
  });

  it("numbers weekdays 0 = Sunday to 6 = Saturday", () => {
    expect(weekdayOf("2026-10-08")).toBe(4); // Thursday
    expect(weekdayOf("2026-10-09")).toBe(5); // Friday
    expect(weekdayOf("2026-10-10")).toBe(6);
    expect(weekdayOf("2026-10-11")).toBe(0);
    expect(weekdayOf("2026-10-12")).toBe(1);
    expect(weekdayOf("2026-03-08")).toBe(0);
    expect(weekdayOf("2026-11-01")).toBe(0);
  });

  it("counts whole days from a to b", () => {
    expect(daysBetween("2026-10-08", "2026-10-10")).toBe(2);
    expect(daysBetween("2026-10-10", "2026-10-08")).toBe(-2);
    expect(daysBetween("2026-10-08", "2026-10-08")).toBe(0);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-10-08", "2027-10-08")).toBe(365);
  });

  it("refuses dates that are not real YYYY-MM-DD days", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => weekdayOf("10/20/2026")).toThrow();
    expect(() => daysBetween("2026-10-08", "2026-10-8")).toThrow();
    expect(() => addDays("2026-10-20", 1.5)).toThrow();
  });
});

describe("busyDayCounts", () => {
  const counts = (visits: BusyVisit[], options?: BusyCountOptions) => busyDayCounts(visits, CHI, options);

  it("counts a 7:30 pm visit on its local day, not the next UTC day", () => {
    expect(counts([{ startAt: "2026-10-21T00:30:00Z", endAt: "2026-10-21T02:30:00Z" }])).toEqual({ "2026-10-20": 1 });
    expect(counts([{ startAt: "2026-10-20T19:30:00-05:00", endAt: "2026-10-20T21:30:00-05:00" }]))
      .toEqual({ "2026-10-20": 1 });
  });

  it("counts every local day of a multi-day visit, and both days of one that runs past midnight", () => {
    expect(counts([{ startAt: "2026-10-19T13:00:00Z", endAt: "2026-10-21T22:00:00Z" }])) // Mon 8 am to Wed 5 pm
      .toEqual({ "2026-10-19": 1, "2026-10-20": 1, "2026-10-21": 1 });
    expect(counts([{ startAt: "2026-10-21T00:30:00Z", endAt: "2026-10-21T06:00:00Z" }])) // 7:30 pm to 1 am
      .toEqual({ "2026-10-20": 1, "2026-10-21": 1 });
  });

  it("leaves the next day free when a visit ends exactly at local midnight", () => {
    expect(counts([{ startAt: "2026-10-21T01:00:00Z", endAt: "2026-10-21T05:00:00Z" }])).toEqual({ "2026-10-20": 1 });
    expect(counts([{ startAt: "2026-10-21T01:00:00Z", endAt: "2026-10-21T05:00:01Z" }]))
      .toEqual({ "2026-10-20": 1, "2026-10-21": 1 });
  });

  it("reads all-day visits from their local start day through the day before the end instant", () => {
    const allDay = { startAt: "2026-10-20T05:00:00Z", allDay: true }; // midnight CDT, Tuesday
    expect(counts([{ ...allDay, endAt: "2026-10-21T05:00:00Z" }])).toEqual({ "2026-10-20": 1 });
    expect(counts([{ ...allDay, endAt: "2026-10-21T04:59:59Z" }])).toEqual({ "2026-10-20": 1 });
    expect(counts([{ ...allDay, endAt: null }])).toEqual({ "2026-10-20": 1 });
    expect(counts([{ ...allDay, endAt: "2026-10-22T05:00:00Z" }])).toEqual({ "2026-10-20": 1, "2026-10-21": 1 });
  });

  it("keeps visits on their local days on the spring-forward day", () => {
    // All day on Sunday 2026-03-08: midnight CST to midnight CDT, 23 hours.
    expect(counts([{ startAt: "2026-03-08T06:00:00Z", endAt: "2026-03-09T05:00:00Z", allDay: true }]))
      .toEqual({ "2026-03-08": 1 });
    // 11 pm CST on Saturday to 3:30 am CDT on Sunday, across the skipped hour.
    expect(counts([{ startAt: "2026-03-08T05:00:00Z", endAt: "2026-03-08T08:30:00Z" }]))
      .toEqual({ "2026-03-07": 1, "2026-03-08": 1 });
  });

  it("keeps visits on their local days on the fall-back day", () => {
    // All day on Sunday 2026-11-01: midnight CDT to midnight CST, 25 hours.
    expect(counts([{ startAt: "2026-11-01T05:00:00Z", endAt: "2026-11-02T06:00:00Z", allDay: true }]))
      .toEqual({ "2026-11-01": 1 });
    // 10 pm to midnight CST. Read with the summer offset, the end would fall at 1 am Monday.
    expect(counts([{ startAt: "2026-11-02T04:00:00Z", endAt: "2026-11-02T06:00:00Z" }])).toEqual({ "2026-11-01": 1 });
    // 11:30 pm CST, which the summer offset would read as 12:30 am Monday.
    expect(counts([{ startAt: "2026-11-02T05:30:00Z", endAt: "2026-11-02T05:45:00Z" }])).toEqual({ "2026-11-01": 1 });
    // 1:30 am CDT to 1:30 am CST, inside the repeated hour.
    expect(counts([{ startAt: "2026-11-01T06:30:00Z", endAt: "2026-11-01T07:30:00Z" }])).toEqual({ "2026-11-01": 1 });
  });

  it("counts a visit that started before the window, clipped to the window when asked", () => {
    const long: BusyVisit = { startAt: "2026-10-15T13:00:00Z", endAt: "2026-10-21T22:00:00Z" };
    expect(counts([long])).toEqual({
      "2026-10-15": 1, "2026-10-16": 1, "2026-10-17": 1, "2026-10-18": 1, "2026-10-19": 1, "2026-10-20": 1, "2026-10-21": 1,
    });
    expect(counts([long], { from: "2026-10-19", to: "2026-10-20" })).toEqual({ "2026-10-19": 1, "2026-10-20": 1 });
    expect(counts([long], { from: "2026-10-22" })).toEqual({});
    expect(() => counts([long], { from: "Oct 19" })).toThrow();
  });

  it("skips completed and unscheduled visits, and counts a visit with no end on its start day", () => {
    expect(counts([
      { startAt: "2026-10-20T14:00:00Z", endAt: "2026-10-20T16:00:00Z", isComplete: true },
      { startAt: null, endAt: null },
      { startAt: null, endAt: "2026-10-20T16:00:00Z" },
      { startAt: "2026-10-21T14:00:00Z", endAt: null },
    ])).toEqual({ "2026-10-21": 1 });
  });

  it("adds up visits on the same day and leaves out the excluded jobs", () => {
    const visit = (jobId: string | null): BusyVisit => ({ startAt: "2026-10-20T14:00:00Z", endAt: "2026-10-20T16:00:00Z", jobId });
    const visits = [visit("J1"), visit("J2"), visit(null), visit("J1")];
    expect(counts(visits)).toEqual({ "2026-10-20": 4 });
    expect(counts(visits, { excludeJobIds: ["J1"] })).toEqual({ "2026-10-20": 2 });
    expect(counts(visits, { excludeJobIds: new Set(["J1", "J2"]) })).toEqual({ "2026-10-20": 1 });
  });

  it("fails loudly on a time it cannot read, so a format surprise never shifts days quietly", () => {
    expect(() => counts([{ startAt: "2026-10-20 14:00", endAt: null }])).toThrow();
    expect(() => counts([{ startAt: "2026-10-20T14:00:00Z", endAt: "soon" }])).toThrow();
  });
});

describe("dayStatuses", () => {
  // Timber's shape: closed on Thursday and Friday. Today is Thursday 2026-10-08.
  const base: DayStatusInput = {
    from: "2026-10-07",
    days: 14,
    today: "2026-10-08",
    closedWeekdays: [4, 5],
    busyCounts: { "2026-10-09": 3, "2026-10-12": 1 },
    committedDates: ["2026-10-13", "2026-10-15"],
    busyThreshold: 1,
    coverageEnd: "2026-10-18",
  };
  const statusMap = (input: DayStatusInput) => Object.fromEntries(dayStatuses(input).map((d) => [d.date, d.status]));

  it("marks each day: past, then closed, then busy, then unknown, then free", () => {
    expect(dayStatuses(base)).toEqual([
      { date: "2026-10-07", status: "past" },
      { date: "2026-10-08", status: "closed" }, // today, a Thursday
      { date: "2026-10-09", status: "closed" }, // 3 Jobber visits, but closed wins
      { date: "2026-10-10", status: "free" }, // Saturday: only the offer skips weekends
      { date: "2026-10-11", status: "free" },
      { date: "2026-10-12", status: "busy" }, // 1 Jobber visit
      { date: "2026-10-13", status: "busy" }, // promised to another TreeCheck job
      { date: "2026-10-14", status: "free" },
      { date: "2026-10-15", status: "closed" }, // promised, but closed wins
      { date: "2026-10-16", status: "closed" },
      { date: "2026-10-17", status: "free" },
      { date: "2026-10-18", status: "free" }, // the last covered day
      { date: "2026-10-19", status: "unknown" },
      { date: "2026-10-20", status: "unknown" },
    ]);
  });

  it("keeps a day locked for the job's hired ground crew free, even closed or busy, so the climber can keep it", () => {
    // Plan section 8: closed weekdays always win, except days already locked because a ground crew is hired.
    // 2026-10-09 is a closed Friday with 3 Jobber visits, 2026-10-13 is promised, 2026-10-07 is past.
    const s = statusMap({ ...base, lockedDates: ["2026-10-09", "2026-10-13", "2026-10-07"] });
    expect(s["2026-10-09"]).toBe("free");
    expect(s["2026-10-13"]).toBe("free");
    expect(s["2026-10-07"]).toBe("past");
    expect(s["2026-10-16"]).toBe("closed"); // every other closed day stays closed
    expect(statusMap(base)["2026-10-09"]).toBe("closed"); // and nothing is locked by default
    const statuses = dayStatuses({ ...base, lockedDates: new Set(["2026-10-09"]) });
    expect(validatePickedDates(["2026-10-09", "2026-10-16"], { today: base.today, statuses })).toEqual({
      kept: ["2026-10-09"],
      rejected: [{ date: "2026-10-16", reason: "closed" }],
    });
  });

  it("keeps past days past, closed ones included", () => {
    const s = statusMap({ ...base, from: "2026-10-01", days: 8 });
    expect(s["2026-10-01"]).toBe("past"); // a closed Thursday
    expect(s["2026-10-02"]).toBe("past"); // a closed Friday
    expect(s["2026-10-07"]).toBe("past");
    expect(s["2026-10-08"]).toBe("closed"); // today is not past
  });

  it("needs busyThreshold visits for a busy day, and treats anything below 1 as 1", () => {
    const busyCounts = { "2026-10-12": 1, "2026-10-13": 2, "2026-10-14": 3 };
    const two = statusMap({ ...base, busyCounts, committedDates: [], busyThreshold: 2 });
    expect([two["2026-10-12"], two["2026-10-13"], two["2026-10-14"]]).toEqual(["free", "busy", "busy"]);
    const zero = statusMap({ ...base, busyCounts, committedDates: [], busyThreshold: 0 });
    expect([zero["2026-10-10"], zero["2026-10-12"], zero["2026-10-19"]]).toEqual(["free", "busy", "unknown"]);
  });

  it("marks days after the covered range unknown, but busy when promised or already full", () => {
    const s = statusMap({ ...base, coverageEnd: "2026-10-11", busyCounts: { "2026-10-14": 1 }, committedDates: ["2026-10-19"] });
    expect(s["2026-10-11"]).toBe("free");
    expect(s["2026-10-12"]).toBe("unknown");
    expect(s["2026-10-14"]).toBe("busy"); // even partial data already shows a visit
    expect(s["2026-10-19"]).toBe("busy"); // TreeCheck's own promise
    expect(s["2026-10-15"]).toBe("closed");
  });

  it("marks every open day unknown when there is no Jobber data", () => {
    const s = statusMap({ ...base, busyCounts: null, coverageEnd: null, committedDates: ["2026-10-13"] });
    expect(s["2026-10-07"]).toBe("past");
    expect(s["2026-10-12"]).toBe("unknown");
    expect(s["2026-10-13"]).toBe("busy");
    expect(s["2026-10-14"]).toBe("unknown");
    expect(s["2026-10-16"]).toBe("closed");
  });

  it("walks calendar days across both daylight-saving changes", () => {
    const dates = (from: string) => dayStatuses({ ...base, from, days: 5, today: "2026-01-01" }).map((d) => d.date);
    expect(dates("2026-03-06")).toEqual(["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(dates("2026-10-30")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  it("returns nothing for an empty window and refuses malformed dates", () => {
    expect(dayStatuses({ ...base, days: 0 })).toEqual([]);
    expect(() => dayStatuses({ ...base, today: "2026-10-8" })).toThrow();
    expect(() => dayStatuses({ ...base, coverageEnd: "Oct 18" })).toThrow();
    expect(() => dayStatuses({ ...base, from: "2026-10-32" })).toThrow();
  });
});

describe("pickOfferedDates", () => {
  // The window starts tomorrow, as bid-request-create builds it: Friday 2026-10-09 to Thursday 2026-10-29.
  const window = (over: Partial<DayStatusInput> = {}) => dayStatuses({
    from: "2026-10-09",
    days: 21,
    today: "2026-10-08",
    closedWeekdays: [4, 5],
    busyCounts: {},
    committedDates: [],
    busyThreshold: 1,
    coverageEnd: "2026-12-07",
    ...over,
  });
  // Mondays to Wednesdays: the only open weekdays in the window for a company closed Thursday and Friday.
  const openWeekdays = [
    "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-26", "2026-10-27", "2026-10-28",
  ];
  const allBusy = Object.fromEntries(openWeekdays.map((d) => [d, 1]));

  it("offers the first four free weekdays, skipping weekends and closed, busy and promised days", () => {
    const statuses = window({ busyCounts: { "2026-10-13": 1 }, committedDates: ["2026-10-19"] });
    expect(pickOfferedDates(statuses)).toEqual(["2026-10-12", "2026-10-14", "2026-10-20", "2026-10-21"]);
    expect(pickOfferedDates(statuses, 2)).toEqual(["2026-10-12", "2026-10-14"]);
  });

  it("offers fewer than four when fewer weekdays are free, rather than adding busy days", () => {
    expect(pickOfferedDates(window({ busyCounts: { ...allBusy, "2026-10-28": 0 } }))).toEqual(["2026-10-28"]);
  });

  it("with no Jobber data, offers weekdays minus closed and promised days", () => {
    const statuses = window({ busyCounts: null, coverageEnd: null, committedDates: ["2026-10-12"] });
    expect(pickOfferedDates(statuses)).toEqual(["2026-10-13", "2026-10-14", "2026-10-19", "2026-10-20"]);
  });

  it("is never empty: with every weekday busy it falls back to the first open weekdays, as today", () => {
    expect(pickOfferedDates(window({ busyCounts: allBusy }))).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-19"]);
  });

  it("is never empty for a company closed on every weekday, or on every day", () => {
    expect(pickOfferedDates(window({ closedWeekdays: [1, 2, 3, 4, 5] })))
      .toEqual(["2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18"]);
    expect(pickOfferedDates(window({ closedWeekdays: [0, 1, 2, 3, 4, 5, 6] })))
      .toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
  });

  it("never offers a past day, so only a window that is all past gives nothing", () => {
    expect(pickOfferedDates(window({ from: "2026-10-01", days: 7 }))).toEqual([]);
    // Monday 10-05 to Monday 10-12: three past days, closed Thursday and Friday, then the weekend.
    expect(pickOfferedDates(window({ from: "2026-10-05", days: 8 }))).toEqual(["2026-10-12"]);
  });

  it("holds the never-empty rule for every set of closed weekdays, and offers no weekend while a weekday is open", () => {
    for (let mask = 0; mask < 128; mask++) {
      const closedWeekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d));
      for (const over of [{}, { busyCounts: allBusy }, { busyCounts: null, coverageEnd: null }]) {
        const statuses = window({ closedWeekdays, ...over });
        const offered = pickOfferedDates(statuses);
        expect(offered.length).toBeGreaterThan(0);
        const statusOf = Object.fromEntries(statuses.map((s) => [s.date, s.status]));
        expect(offered.every((d) => statusOf[d] !== "past")).toBe(true);
        const weekdayOpen = statuses.some((s) => s.status !== "closed" && s.status !== "past" && !isWeekend(s.date));
        if (weekdayOpen) expect(offered.filter(isWeekend)).toEqual([]);
      }
    }
  });
});

describe("validatePickedDates", () => {
  it("keeps the site-visit marker and today, and turns away past days and anything that is not a date", () => {
    const result = validatePickedDates(
      ["2026-10-07", WANTS_SITE_VISIT, "2026-10-08", "2026-10-12", "2026-10-12", "2026-13-01", "Oct 20"],
      { today: "2026-10-08" },
    );
    expect(result.kept).toEqual([WANTS_SITE_VISIT, "2026-10-08", "2026-10-12"]);
    expect(result.rejected).toEqual([
      { date: "2026-10-07", reason: "past" },
      { date: "2026-13-01", reason: "invalid" },
      { date: "Oct 20", reason: "invalid" },
    ]);
  });

  it("refuses closed and busy days found in the statuses, and keeps free, unknown and unchecked days", () => {
    const statuses = dayStatuses({
      from: "2026-10-08",
      days: 14,
      today: "2026-10-08",
      closedWeekdays: [4, 5],
      busyCounts: { "2026-10-13": 1 },
      committedDates: ["2026-10-14"],
      busyThreshold: 1,
      coverageEnd: "2026-10-19",
    });
    const result = validatePickedDates(
      ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-20", "2026-11-30", "2026-10-05", WANTS_SITE_VISIT],
      { today: "2026-10-08", statuses },
    );
    expect(result.kept).toEqual(["2026-10-12", "2026-10-20", "2026-11-30", WANTS_SITE_VISIT]);
    expect(result.rejected).toEqual([
      { date: "2026-10-09", reason: "closed" },
      { date: "2026-10-13", reason: "busy" },
      { date: "2026-10-14", reason: "busy" }, // promised to another TreeCheck job
      { date: "2026-10-05", reason: "past" },
    ]);
  });

  it("checks only past days when no statuses are given", () => {
    expect(validatePickedDates(["2026-10-09"], { today: "2026-10-08" })).toEqual({ kept: ["2026-10-09"], rejected: [] });
    expect(validatePickedDates([], { today: "2026-10-08" })).toEqual({ kept: [], rejected: [] });
  });
});

describe("inQuietHours", () => {
  it("is quiet from 9 pm to 6:59 am Chicago time in summer", () => {
    expect(inQuietHours(CHI, at("2026-10-21T01:59:59Z"))).toBe(false); // 8:59:59 pm CDT
    expect(inQuietHours(CHI, at("2026-10-21T02:00:00Z"))).toBe(true); // 9:00 pm
    expect(inQuietHours(CHI, at("2026-10-21T05:00:00Z"))).toBe(true); // midnight
    expect(inQuietHours(CHI, at("2026-10-21T11:59:59Z"))).toBe(true); // 6:59:59 am
    expect(inQuietHours(CHI, at("2026-10-21T12:00:00Z"))).toBe(false); // 7:00 am
    expect(inQuietHours(CHI, at("2026-10-21T17:00:00Z"))).toBe(false); // noon
  });

  it("follows standard time in winter", () => {
    expect(inQuietHours(CHI, at("2026-12-02T02:59:59Z"))).toBe(false); // 8:59:59 pm CST
    expect(inQuietHours(CHI, at("2026-12-02T03:00:00Z"))).toBe(true); // 9:00 pm
    expect(inQuietHours(CHI, at("2026-12-02T12:59:59Z"))).toBe(true); // 6:59:59 am
    expect(inQuietHours(CHI, at("2026-12-02T13:00:00Z"))).toBe(false); // 7:00 am
  });

  it("ends at 7 am local on both daylight-saving change days", () => {
    expect(inQuietHours(CHI, at("2026-03-08T11:59:59Z"))).toBe(true); // 6:59:59 am CDT
    expect(inQuietHours(CHI, at("2026-03-08T12:00:00Z"))).toBe(false); // 7:00 am CDT, 6 am by winter time
    expect(inQuietHours(CHI, at("2026-11-01T06:30:00Z"))).toBe(true); // 1:30 am CDT
    expect(inQuietHours(CHI, at("2026-11-01T07:30:00Z"))).toBe(true); // 1:30 am CST, the repeated hour
    expect(inQuietHours(CHI, at("2026-11-01T12:00:00Z"))).toBe(true); // 6:00 am CST, 7 am by summer time
    expect(inQuietHours(CHI, at("2026-11-01T13:00:00Z"))).toBe(false); // 7:00 am CST
  });

  it("uses the zone it is given", () => {
    expect(inQuietHours(CHI, at("2026-10-20T16:30:00Z"))).toBe(false); // 11:30 am in Chicago
    expect(inQuietHours("Asia/Tokyo", at("2026-10-20T16:30:00Z"))).toBe(true); // 1:30 am in Tokyo
    expect(() => inQuietHours(CHI, new Date(Number.NaN))).toThrow();
  });
});

describe("climberDatesPending (an approval's hire waits for the climber's days, plan 0.17)", () => {
  it("waits only while the climber has never confirmed days", () => {
    expect(climberDatesPending({ climber_dates_status: "requested", confirmed_dates: [] })).toBe(true);
    expect(climberDatesPending({ climber_dates_status: "requested", confirmed_dates: null })).toBe(true);
    // ground-crew-daily asked for more days on a job whose days are already confirmed.
    expect(climberDatesPending({ climber_dates_status: "requested", confirmed_dates: ["2026-10-20"] })).toBe(false);
    expect(climberDatesPending({ climber_dates_status: "confirmed", confirmed_dates: ["2026-10-20"] })).toBe(false);
    expect(climberDatesPending({ climber_dates_status: null, confirmed_dates: [] })).toBe(false);
    expect(climberDatesPending({})).toBe(false);
  });
});
