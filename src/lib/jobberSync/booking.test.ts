// TreeCheck Jobber sync: bookingPlan covers every row of the booking table in plan section 6, PR 6,
// plus the switches and missing data (synthetic data only).
import { describe, expect, it } from "vitest";
import {
  type BookingDispatch,
  type BookingInput,
  type BookingLink,
  bookingPlan,
  type BookingRequest,
  type BookingSwitches,
} from "../../../supabase/functions/_shared/jobberBooking";
import { CLOSED_WORKFLOW } from "../../../supabase/functions/_shared/jobberStatus";

const TODAY = "2026-10-14";
const DAY = "2026-10-20";
const OTHER_DAY = "2026-10-22";
// 8:00 am Chicago time (CDT, UTC-5) on a day.
const at8 = (day: string) => `${day}T13:00:00Z`;

const SWITCHES_ON: BookingSwitches = { bookJobs: true, killSwitch: false, jobFromQuote: true, timezone: "America/Chicago" };

// Awarded, the climber confirmed two days, no ground crew call-out, no single day set.
const request = (over: Partial<BookingRequest> = {}): BookingRequest => ({
  workflowStatus: "quote_sent",
  awardedBidId: "bid-climber",
  awardedDate: null,
  climberDatesStatus: "confirmed",
  confirmedDates: [DAY, OTHER_DAY],
  ...over,
});

const link = (over: Partial<BookingLink> = {}): BookingLink => ({
  quoteState: "created",
  jobState: "none",
  jobberJobId: null,
  visits: null,
  ...over,
});

const linkedTo = (...days: string[]) =>
  link({ jobState: "linked", jobberJobId: "job-1", visits: days.map((d) => ({ startAt: at8(d), endAt: `${d}T22:00:00Z` })) });

const dayPick = (status: string, awardedDate: string | null = null): BookingDispatch => ({
  role: "ground",
  status,
  offeredDates: [DAY, OTHER_DAY],
  awardedDate,
});

const claimStyle = (status: string): BookingDispatch => ({ role: "ground", status, offeredDates: [], awardedDate: null });

function plan(over: Partial<BookingInput> = {}) {
  return bookingPlan({
    quote: { status: "approved", jobIds: [] },
    link: link(),
    request: request(),
    dispatches: [],
    switches: SWITCHES_ON,
    today: TODAY,
    ...over,
  });
}

const BOOK_DAY_FROM_CALL_OUT = { action: "book", date: DAY, reason: "call_out_filled" };
const BOOK_AWARDED_DAY = { action: "book", date: DAY, reason: "awarded_date" };
const ADOPT = { action: "converted_adopt", reason: "quote_converted" };

describe("bookingPlan: the plan's booking table", () => {
  it("waits while the quote is not approved", () => {
    for (const status of ["draft", "awaiting_response", "changes_requested", "archived", "SOMETHING_NEW", ""]) {
      expect(plan({ quote: { status, jobIds: [] }, dispatches: [dayPick("filled", DAY)] }))
        .toEqual({ action: "wait", reason: "quote_not_approved" });
    }
  });

  it("waits while the climber's dates are still requested", () => {
    expect(plan({ request: request({ climberDatesStatus: "requested", confirmedDates: [] }) }))
      .toEqual({ action: "wait", reason: "climber_dates_requested" });
    expect(plan({ request: request({ climberDatesStatus: "requested", confirmedDates: null, awardedDate: DAY }) }))
      .toEqual({ action: "wait", reason: "climber_dates_requested" });
  });

  it("does not read requested as unconfirmed when days were already confirmed (section 0.17)", () => {
    // ground-crew-daily asked for more days on a job whose days were confirmed.
    const asked = request({ climberDatesStatus: "requested", confirmedDates: [DAY] });
    expect(plan({ request: asked, dispatches: [dayPick("open")] })).toEqual({ action: "wait", reason: "call_out_open" });
    expect(plan({ request: asked, dispatches: [dayPick("filled", DAY)] })).toEqual(BOOK_DAY_FROM_CALL_OUT);
  });

  it("waits while a day-pick call-out is open", () => {
    expect(plan({ dispatches: [dayPick("open")] })).toEqual({ action: "wait", reason: "call_out_open" });
    expect(plan({ request: request({ awardedDate: DAY }), dispatches: [dayPick("open")] }))
      .toEqual({ action: "wait", reason: "call_out_open" });
  });

  it("books a filled day-pick call-out on its awarded_date", () => {
    expect(plan({ dispatches: [dayPick("filled", DAY)] })).toEqual(BOOK_DAY_FROM_CALL_OUT);
    // The ground crew's day wins over the job's own awarded_date.
    expect(plan({ request: request({ awardedDate: OTHER_DAY }), dispatches: [dayPick("filled", DAY)] }))
      .toEqual(BOOK_DAY_FROM_CALL_OUT);
  });

  it("with no day-pick call-out, books on the job's awarded_date", () => {
    // No ground crew needed and one confirmed day (E18, E20).
    const oneDay = request({ awardedDate: DAY, confirmedDates: [DAY] });
    expect(plan({ request: oneDay })).toEqual(BOOK_AWARDED_DAY);
    // A claim-style call-out has no offered days, open or filled (E19).
    expect(plan({ request: oneDay, dispatches: [claimStyle("open")] })).toEqual(BOOK_AWARDED_DAY);
    expect(plan({ request: oneDay, dispatches: [claimStyle("filled")] })).toEqual(BOOK_AWARDED_DAY);
    // Jobs from before climber date requests have no date status.
    expect(plan({ request: request({ awardedDate: DAY, climberDatesStatus: null, confirmedDates: [] }) }))
      .toEqual(BOOK_AWARDED_DAY);
  });

  it("with no day-pick call-out and no date, the office books it", () => {
    // Several confirmed days and no ground crew (E18, second case).
    expect(plan()).toEqual({ action: "office_books", reason: "no_date" });
    expect(plan({ dispatches: [claimStyle("filled")] })).toEqual({ action: "office_books", reason: "no_date" });
  });

  it("a linked job with a visit on the crew's day is scheduled", () => {
    expect(plan({ link: linkedTo(DAY), dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "scheduled", date: DAY, reason: "visit_matches" });
    expect(plan({ link: linkedTo(OTHER_DAY, DAY), request: request({ awardedDate: DAY }) }))
      .toEqual({ action: "scheduled", date: DAY, reason: "visit_matches" });
  });

  it("a linked job with its visit on another day needs a date change", () => {
    expect(plan({ link: linkedTo(OTHER_DAY), dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "needs_date_change", date: DAY, visitDate: OTHER_DAY, reason: "visit_on_other_day" });
  });

  it("a linked job with no scheduled visit needs a date change", () => {
    for (const visits of [[], [{ startAt: null }], [{ startAt: "" }], [{}]]) {
      const linked = link({ jobState: "booked", jobberJobId: "job-1", visits });
      expect(plan({ link: linked, dispatches: [dayPick("filled", DAY)] }))
        .toEqual({ action: "needs_date_change", date: DAY, reason: "no_visit_on_job" });
    }
  });

  it("adopts a job already made from the quote", () => {
    const converted = { status: "converted", jobIds: ["job-9"] };
    expect(plan({ quote: converted, dispatches: [dayPick("filled", DAY)] })).toEqual(ADOPT);
    // Converted before the call-out fills (E13): the dates are compared once the job is linked.
    expect(plan({ quote: converted, dispatches: [dayPick("open")] })).toEqual(ADOPT);
    // Even before the crew is awarded.
    expect(plan({ quote: converted, request: request({ awardedBidId: null }) })).toEqual(ADOPT);
  });
});

describe("bookingPlan: linked jobs", () => {
  it("waits for the crew's day before comparing", () => {
    expect(plan({ link: linkedTo(OTHER_DAY), dispatches: [dayPick("open")] }))
      .toEqual({ action: "wait", reason: "call_out_open" });
    // "Ask for new dates" on a booked job (E16): the call-out is gone and dates are requested again.
    const rerequested = request({ climberDatesStatus: "requested", confirmedDates: [], awardedDate: null });
    expect(plan({ link: linkedTo(OTHER_DAY), request: rerequested }))
      .toEqual({ action: "wait", reason: "climber_dates_requested" });
  });

  it("with no TreeCheck day, takes the linked job's own visit day", () => {
    expect(plan({ link: linkedTo(OTHER_DAY, DAY) })).toEqual({ action: "scheduled", date: DAY, reason: "jobber_visit_date" });
    expect(plan({ link: link({ jobState: "linked", jobberJobId: "job-1", visits: [] }) }))
      .toEqual({ action: "wait", reason: "linked_job_unscheduled" });
  });

  it("compares a linked job even when its quote no longer reads approved", () => {
    expect(plan({ quote: { status: "archived", jobIds: [] }, link: linkedTo(DAY), request: request({ awardedDate: DAY }) }))
      .toEqual({ action: "scheduled", date: DAY, reason: "visit_matches" });
  });

  it("compares the linked job, not other jobs on the quote", () => {
    expect(plan({ quote: { status: "converted", jobIds: ["job-1", "job-2"] }, link: linkedTo(DAY), dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "scheduled", date: DAY, reason: "visit_matches" });
  });

  it("reads visit days in the company time zone", () => {
    // 7:30 pm Chicago time on the crew's day is already the next day in UTC.
    const evening = link({ jobState: "linked", jobberJobId: "job-1", visits: [{ startAt: "2026-10-21T00:30:00Z" }] });
    expect(plan({ link: evening, request: request({ awardedDate: DAY }) }))
      .toEqual({ action: "scheduled", date: DAY, reason: "visit_matches" });
    expect(plan({ link: evening, request: request({ awardedDate: DAY }), switches: { ...SWITCHES_ON, timezone: "UTC" } }))
      .toEqual({ action: "needs_date_change", date: DAY, visitDate: "2026-10-21", reason: "visit_on_other_day" });
    // A missing time zone reads as America/Chicago.
    expect(plan({ link: evening, request: request({ awardedDate: DAY }), switches: { ...SWITCHES_ON, timezone: null } }))
      .toEqual({ action: "scheduled", date: DAY, reason: "visit_matches" });
  });
});

describe("bookingPlan: switches", () => {
  it("skips everything with book_jobs off", () => {
    const off = { ...SWITCHES_ON, bookJobs: false };
    expect(plan({ switches: off, dispatches: [dayPick("filled", DAY)] })).toEqual({ action: "skip", reason: "book_jobs_off" });
    // No date-change text either (M9 needs book_jobs on).
    expect(plan({ switches: off, link: linkedTo(OTHER_DAY), dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "skip", reason: "book_jobs_off" });
    expect(plan({ switches: off, quote: { status: "converted", jobIds: ["job-9"] } })).toEqual({ action: "skip", reason: "book_jobs_off" });
    expect(plan({ switches: null })).toEqual({ action: "skip", reason: "book_jobs_off" });
  });

  it("skips everything with the kill switch set, even with book_jobs on", () => {
    const killed = { ...SWITCHES_ON, killSwitch: true };
    expect(plan({ switches: killed, dispatches: [dayPick("filled", DAY)] })).toEqual({ action: "skip", reason: "kill_switch" });
    expect(plan({ switches: killed, link: linkedTo(OTHER_DAY), dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "skip", reason: "kill_switch" });
    expect(plan({ switches: { ...killed, bookJobs: false } })).toEqual({ action: "skip", reason: "kill_switch" });
  });

  it("sends the office to convert the quote, with the day, when Step 0 test T4 failed", () => {
    const noJobCreate = { ...SWITCHES_ON, jobFromQuote: false };
    expect(plan({ switches: noJobCreate, dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "office_books", date: DAY, reason: "job_from_quote_unavailable" });
    expect(plan({ switches: noJobCreate, request: request({ awardedDate: DAY }) }))
      .toEqual({ action: "office_books", date: DAY, reason: "job_from_quote_unavailable" });
    // Adopting and comparing never create a job, so they still run.
    expect(plan({ switches: noJobCreate, quote: { status: "converted", jobIds: ["job-9"] } })).toEqual(ADOPT);
    expect(plan({ switches: noJobCreate, link: linkedTo(DAY), dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "scheduled", date: DAY, reason: "visit_matches" });
  });
});

describe("bookingPlan: missing data and guards", () => {
  it("skips a job with no TreeCheck quote", () => {
    const ready = { dispatches: [dayPick("filled", DAY)] };
    expect(plan({ ...ready, quote: null })).toEqual({ action: "skip", reason: "no_quote" });
    expect(plan({ ...ready, link: null })).toEqual({ action: "skip", reason: "no_quote" });
    // Jobs in progress before the switch went on stay manual; failed, deleted or unfinished quotes are not booked.
    for (const quoteState of ["manual", "none", "creating", "failed", "skipped", "deleted", "waiting_other_role"]) {
      expect(plan({ ...ready, link: link({ quoteState }) })).toEqual({ action: "skip", reason: "no_quote" });
    }
    expect(plan({ ...ready, link: link({ quoteState: "linked" }) })).toEqual(BOOK_DAY_FROM_CALL_OUT);
  });

  it("skips when the quote was not read from Jobber", () => {
    const ready = { dispatches: [dayPick("filled", DAY)] };
    expect(plan({ ...ready, quote: { status: null, jobIds: [] } })).toEqual({ action: "skip", reason: "quote_not_read" });
    // Without quote.jobs a job could be made twice, so booking never runs blind.
    expect(plan({ ...ready, quote: { status: "approved", jobIds: null } })).toEqual({ action: "skip", reason: "quote_not_read" });
  });

  it("skips when the job or its call-outs were not read", () => {
    expect(plan({ request: null })).toEqual({ action: "skip", reason: "request_not_read" });
    // An unread call-out could be an open day-pick one, so the awarded_date is not booked blind.
    expect(plan({ request: request({ awardedDate: DAY }), dispatches: null })).toEqual({ action: "skip", reason: "dispatches_not_read" });
  });

  it("skips a linked job whose visits were not read", () => {
    const unread = link({ jobState: "linked", jobberJobId: "job-1", visits: null });
    expect(plan({ link: unread, dispatches: [dayPick("filled", DAY)] })).toEqual({ action: "skip", reason: "visits_not_read" });
    // While the crew's day is not known, there is nothing to compare yet.
    expect(plan({ link: unread, dispatches: [dayPick("open")] })).toEqual({ action: "wait", reason: "call_out_open" });
  });

  it("skips rather than text the office when a linked job's visit start can't be read", () => {
    // A start without its zone (a mapping bug before Step 0 test T7) could be on the crew's day.
    for (const startAt of ["2026-10-20T13:00:00", "2026-10-20", "not a time"]) {
      const unreadable = link({ jobState: "linked", jobberJobId: "job-1", visits: [{ startAt }] });
      expect(plan({ link: unreadable, dispatches: [dayPick("filled", DAY)] }), startAt)
        .toEqual({ action: "skip", reason: "visits_not_read" });
      // With no TreeCheck day, the job's own day is not guessed either.
      expect(plan({ link: unreadable }), startAt).toEqual({ action: "skip", reason: "visits_not_read" });
    }
    // A readable visit on the crew's day is enough, whatever the others say.
    const onDay = link({ jobState: "linked", jobberJobId: "job-1", visits: [{ startAt: "garbled" }, { startAt: at8(DAY) }] });
    expect(plan({ link: onDay, dispatches: [dayPick("filled", DAY)] })).toEqual({ action: "scheduled", date: DAY, reason: "visit_matches" });
    // A readable visit on another day next to an unreadable one is still no reason for M9.
    const offDay = link({ jobState: "linked", jobberJobId: "job-1", visits: [{ startAt: "garbled" }, { startAt: at8(OTHER_DAY) }] });
    expect(plan({ link: offDay, dispatches: [dayPick("filled", DAY)] })).toEqual({ action: "skip", reason: "visits_not_read" });
    expect(plan({ link: offDay })).toEqual({ action: "skip", reason: "visits_not_read" });
  });

  it("skips when today's date is unknown", () => {
    for (const today of ["", "Oct 14", "2026-10-14T05:00:00Z"]) {
      expect(plan({ today, dispatches: [dayPick("filled", DAY)] })).toEqual({ action: "skip", reason: "today_unknown" });
    }
  });

  it("skips a job that is closed in TreeCheck", () => {
    for (const workflowStatus of [...CLOSED_WORKFLOW, "something_new"]) {
      expect(plan({ request: request({ workflowStatus, awardedDate: DAY }) })).toEqual({ action: "skip", reason: "job_not_open" });
      expect(plan({ request: request({ workflowStatus }), link: linkedTo(OTHER_DAY) })).toEqual({ action: "skip", reason: "job_not_open" });
    }
    expect(plan({ request: request({ workflowStatus: null, awardedDate: DAY }) })).toEqual(BOOK_AWARDED_DAY);
    expect(plan({ request: request({ workflowStatus: "quote_accepted", awardedDate: DAY }) })).toEqual(BOOK_AWARDED_DAY);
  });

  it("never re-books a job the office deleted in Jobber, but adopts a new conversion", () => {
    const deleted = link({ jobState: "deleted" });
    expect(plan({ link: deleted, dispatches: [dayPick("filled", DAY)] })).toEqual({ action: "skip", reason: "job_deleted" });
    // Leslee converts the quote again after the delete (E15): the link moves to the new job.
    expect(plan({ link: deleted, quote: { status: "converted", jobIds: ["job-2"] } })).toEqual(ADOPT);
  });

  it("never makes a second job from a converted quote with no job on it", () => {
    expect(plan({ quote: { status: "converted", jobIds: [] }, dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "skip", reason: "quote_converted_no_job" });
    expect(plan({ quote: { status: "converted", jobIds: [""] }, dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "skip", reason: "quote_converted_no_job" });
  });

  it("waits when the quote was approved before any crew was awarded (E12)", () => {
    expect(plan({ request: request({ awardedBidId: null, climberDatesStatus: null, confirmedDates: [] }) }))
      .toEqual({ action: "wait", reason: "no_crew_awarded" });
    expect(plan({ request: request({ awardedBidId: null }), link: linkedTo(DAY) })).toEqual({ action: "wait", reason: "no_crew_awarded" });
  });

  it("sends a day that has passed to the office instead of booking it", () => {
    expect(plan({ dispatches: [dayPick("filled", "2026-10-13")] }))
      .toEqual({ action: "office_books", date: "2026-10-13", reason: "date_passed" });
    expect(plan({ dispatches: [dayPick("filled", TODAY)] })).toEqual({ action: "book", date: TODAY, reason: "call_out_filled" });
  });

  it("sends the office a filled day-pick call-out with no day, or call-outs on different days", () => {
    expect(plan({ dispatches: [dayPick("filled", null)] })).toEqual({ action: "office_books", reason: "no_date" });
    expect(plan({ dispatches: [dayPick("filled", "not a day")] })).toEqual({ action: "office_books", reason: "no_date" });
    expect(plan({ dispatches: [dayPick("filled", DAY), dayPick("filled", OTHER_DAY)] })).toEqual({ action: "office_books", reason: "no_date" });
    expect(plan({ dispatches: [dayPick("filled", DAY), dayPick("filled", DAY)] })).toEqual(BOOK_DAY_FROM_CALL_OUT);
    expect(plan({ dispatches: [dayPick("filled", DAY), dayPick("open")] })).toEqual({ action: "wait", reason: "call_out_open" });
  });

  it("counts only ground call-outs with offered days as day-pick ones", () => {
    const other: BookingDispatch = { role: "stump", status: "open", offeredDates: [DAY], awardedDate: null };
    expect(plan({ request: request({ awardedDate: DAY }), dispatches: [other] })).toEqual(BOOK_AWARDED_DAY);
    const noOffered: BookingDispatch = { role: "ground", status: "open", offeredDates: null, awardedDate: null };
    expect(plan({ request: request({ awardedDate: DAY }), dispatches: [noOffered] })).toEqual(BOOK_AWARDED_DAY);
  });

  it("books again after a failed booking, a stale lease or an office text once a day is known", () => {
    for (const jobState of ["failed", "office_books", "booking", "none"]) {
      expect(plan({ link: link({ jobState }), request: request({ awardedDate: DAY }) })).toEqual(BOOK_AWARDED_DAY);
    }
  });

  it("reads statuses in any case", () => {
    expect(plan({ quote: { status: "APPROVED", jobIds: [] }, dispatches: [{ ...dayPick("Filled", DAY), role: "GROUND" }] }))
      .toEqual(BOOK_DAY_FROM_CALL_OUT);
    expect(plan({ request: request({ climberDatesStatus: "Requested", confirmedDates: [] }) }))
      .toEqual({ action: "wait", reason: "climber_dates_requested" });
    expect(plan({ link: link({ quoteState: "CREATED", jobState: "Deleted" }), dispatches: [dayPick("filled", DAY)] }))
      .toEqual({ action: "skip", reason: "job_deleted" });
  });
});
