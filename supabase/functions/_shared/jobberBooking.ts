// TreeCheck Jobber sync: when and how an approved TreeCheck job is booked in Jobber (plan section 6,
// PR 6, "bookFor / bookingPlan").
//
// Pure: no Deno globals, no network and no clock (the caller passes today's date), so the edge
// functions and the vitest suite (src/lib/jobberSync/booking.test.ts) run the same file. Maintained
// outside Lovable. Nothing deployed imports it yet: jobberBookingRun.ts (PR 6) reads the inputs, calls
// bookingPlan and carries out the action. Jobber data comes in through the input types below, which a
// later PR fills from Jobber's replies once Step 0 confirms the field names.
//
// The rules, in the order they apply (the first one that fits wins):
// 1. "skip": the kill switch is set; book_jobs is off; the job has no TreeCheck quote (quote_state
//    created or linked); the quote, the job, its call-outs or today's date were not read; the job is no
//    longer open in TreeCheck.
// 2. A job is linked: its visits are compared with the crew's day (rule 6). A visit on that day gives
//    "scheduled" (refresh booked_date); otherwise "needs_date_change" (office text M9, once per date).
//    While the crew's day is not known yet: "wait". With no TreeCheck day at all, the linked job's own
//    visit day is accepted as "scheduled". When no visit is on the day and a visit's start could not
//    be read (visitDateMatch's unreadable), "skip" (visits_not_read): that visit may be on the day, so
//    the office is never texted M9 on a guess.
// 3. quote.jobs is not empty: "converted_adopt". The caller links each job with linkJob (source
//    jobber), reads the linked job's visits and plans again, which compares the dates (rule 2).
// 4. "skip": the linked job was deleted in Jobber (TreeCheck never re-books a job the office deleted),
//    or the quote reads converted with no job on it (a second job is never made from it).
// 5. "wait": the quote is not approved; no crew is awarded yet (a quote can be approved before the
//    award); the climber's dates are still requested (status "requested" with no confirmed days,
//    section 0.17); a day-pick call-out is still open.
// 6. The crew's day: a filled day-pick call-out's awarded_date. With no day-pick call-out (none at all,
//    or a claim-style one with no offered days), the job's awarded_date. No day, or several:
//    "office_books" (office text M8, once).
// 7. "book" on that day. If the day has passed, or Step 0 test T4 failed so TreeCheck may not create
//    jobs from quotes: "office_books" with the day instead.
// The booking lease (job_state "booking") is claimed by the caller once this plan says "book", so a
// "booking" row with no job yet reads like "none" here, and two runs can never both create a job.

import { isOpenWorkflow, mapQuoteStatus, visitDateMatch, type VisitTimes } from "./jobberStatus.ts";

/** What bookFor does next. */
export type BookingAction =
  | "wait"
  | "book"
  | "office_books"
  | "scheduled"
  | "needs_date_change"
  | "converted_adopt"
  | "skip";

/** Why, as a short code for logs and for picking the office text's variant. */
export type BookingReason =
  // skip
  | "kill_switch"
  | "book_jobs_off"
  | "no_quote"
  | "quote_not_read"
  | "request_not_read"
  | "dispatches_not_read"
  | "today_unknown"
  | "job_not_open"
  | "visits_not_read"
  | "job_deleted"
  | "quote_converted_no_job"
  // wait
  | "quote_not_approved"
  | "no_crew_awarded"
  | "climber_dates_requested"
  | "call_out_open"
  | "linked_job_unscheduled"
  // converted_adopt, scheduled, needs_date_change
  | "quote_converted"
  | "visit_matches"
  | "jobber_visit_date"
  | "visit_on_other_day"
  | "no_visit_on_job"
  // book, office_books
  | "call_out_filled"
  | "awarded_date"
  | "no_date"
  | "date_passed"
  | "job_from_quote_unavailable";

/** bookingPlan's answer. */
export interface BookingPlan {
  action: BookingAction;
  /**
   * A local day (YYYY-MM-DD): the day to book ("book"), the crew's day ("office_books" when known,
   * "needs_date_change"), or the day the linked job is on ("scheduled").
   */
  date?: string;
  /** With "needs_date_change": the linked job's first visit day, when it has one (M9's "has its visit on"). */
  visitDate?: string;
  reason: BookingReason;
}

/** The job's TreeCheck quote as read from Jobber just before planning. */
export interface BookingQuote {
  /** Jobber's quote status as read, any case; null when the quote was not read. */
  status: string | null;
  /** Ids of the Jobber jobs already made from this quote (Quote.jobs); null when not read. */
  jobIds: readonly string[] | null;
}

/** The job's bid_request_quotes row, plus the linked job's visits. */
export interface BookingLink {
  /** bid_request_quotes.quote_state: only "created" and "linked" quotes are booked. */
  quoteState: string;
  /** bid_request_quotes.job_state ("none", "booking", "booked", "linked", "failed", "office_books", "deleted"). */
  jobState: string;
  /** bid_request_quotes.jobber_job_id: the Jobber job linked to this TreeCheck job, if any. */
  jobberJobId: string | null;
  /** The linked job's visits as read from Jobber just now; null when not read (needed only with a linked job). */
  visits: readonly VisitTimes[] | null;
}

/** The bid_requests fields booking depends on. */
export interface BookingRequest {
  /** bid_requests.workflow_status (null counts as "open"). */
  workflowStatus: string | null;
  /** bid_requests.awarded_bid_id: the bid awarded first; null before any award. */
  awardedBidId: string | null;
  /** bid_requests.awarded_date: the job's single day, when it has one (YYYY-MM-DD). */
  awardedDate: string | null;
  /** bid_requests.climber_dates_status: "requested" or "confirmed"; null on jobs from before date requests. */
  climberDatesStatus: string | null;
  /** bid_requests.confirmed_dates: the days the climber confirmed. */
  confirmedDates: readonly string[] | null;
}

/** One crew call-out on the job (a job_dispatches row). */
export interface BookingDispatch {
  /** job_dispatches.role: only "ground" call-outs count. */
  role: string;
  /** job_dispatches.status: "open" or "filled". */
  status: string;
  /** job_dispatches.offered_dates: the days workers pick from; empty for a claim-style call-out. */
  offeredDates: readonly string[] | null;
  /** job_dispatches.awarded_date: the day a day-pick call-out filled on. */
  awardedDate: string | null;
}

/** What gates booking, mapped by the caller from jobberSwitches(), killSwitchOn() and Step 0. */
export interface BookingSwitches {
  /** company_jobber_settings.book_jobs. */
  bookJobs: boolean;
  /** True when the TC_JOBBER_KILL secret is set. */
  killSwitch: boolean;
  /** True once Step 0 test T4 passed, so TreeCheck may create a Jobber job from an approved quote. */
  jobFromQuote: boolean;
  /** company_jobber_settings.timezone, for reading visit days (America/Chicago when missing). */
  timezone?: string | null;
}

/** Everything bookingPlan reads. */
export interface BookingInput {
  quote: BookingQuote | null;
  link: BookingLink | null;
  request: BookingRequest | null;
  /** Every call-out on the job; null when they were not read. */
  dispatches: readonly BookingDispatch[] | null;
  switches: BookingSwitches | null;
  /** Today in the company time zone (YYYY-MM-DD), from the caller's clock. */
  today: string;
}

// The crew's day (rules 5 and 6), or why it is not known yet.
type CrewDay =
  | { kind: "day"; date: string; reason: "call_out_filled" | "awarded_date" }
  | { kind: "wait"; reason: "no_crew_awarded" | "climber_dates_requested" | "call_out_open" }
  | { kind: "none" };

const TRACKED_QUOTE_STATES: readonly string[] = ["created", "linked"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const isDay = (value: unknown): value is string => typeof value === "string" && DAY_RE.test(value);
const lower = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const skip = (reason: BookingReason): BookingPlan => ({ action: "skip", reason });

function crewDay(request: BookingRequest, dispatches: readonly BookingDispatch[]): CrewDay {
  if (!request.awardedBidId) return { kind: "wait", reason: "no_crew_awarded" };
  const confirmed = Array.isArray(request.confirmedDates) ? request.confirmedDates.length : 0;
  if (lower(request.climberDatesStatus) === "requested" && confirmed === 0) {
    return { kind: "wait", reason: "climber_dates_requested" };
  }
  const dayPick = dispatches.filter(
    (d) => lower(d?.role) === "ground" && Array.isArray(d.offeredDates) && d.offeredDates.length > 0,
  );
  if (dayPick.some((d) => lower(d.status) === "open")) return { kind: "wait", reason: "call_out_open" };
  const filled = dayPick.filter((d) => lower(d.status) === "filled");
  if (filled.length > 0) {
    // A filled day-pick call-out with no day, or several call-outs on different days, needs the office.
    const days = [...new Set(filled.map((d) => d.awardedDate).filter(isDay))];
    return days.length === 1 ? { kind: "day", date: days[0], reason: "call_out_filled" } : { kind: "none" };
  }
  return isDay(request.awardedDate)
    ? { kind: "day", date: request.awardedDate, reason: "awarded_date" }
    : { kind: "none" };
}

// Rule 2: a linked job's visits against the crew's day.
function linkedJobPlan(visits: readonly VisitTimes[] | null, crew: CrewDay, tz: string | null | undefined): BookingPlan {
  if (crew.kind === "wait") return { action: "wait", reason: crew.reason };
  if (!Array.isArray(visits)) return skip("visits_not_read");
  if (crew.kind === "none") {
    const read = visitDateMatch(visits, null, tz);
    // A visit whose start could not be read may be the job's first day, so no day is taken from the rest.
    if (read.unreadable > 0) return skip("visits_not_read");
    const jobberDay = read.visitDates[0];
    return jobberDay
      ? { action: "scheduled", date: jobberDay, reason: "jobber_visit_date" }
      : { action: "wait", reason: "linked_job_unscheduled" };
  }
  const match = visitDateMatch(visits, crew.date, tz);
  if (match.matches) return { action: "scheduled", date: crew.date, reason: "visit_matches" };
  // A visit whose start could not be read may be on the crew's day: no M9 on a guess (plan section 2.6).
  if (match.unreadable > 0) return skip("visits_not_read");
  const visitDate = match.visitDates[0];
  return visitDate
    ? { action: "needs_date_change", date: crew.date, visitDate, reason: "visit_on_other_day" }
    : { action: "needs_date_change", date: crew.date, reason: "no_visit_on_job" };
}

/** Decides the next booking step for one TreeCheck job (rules at the top of this file). */
export function bookingPlan(input: BookingInput): BookingPlan {
  const { quote, link, request, dispatches, switches, today } = input;
  if (switches?.killSwitch) return skip("kill_switch");
  if (!switches?.bookJobs) return skip("book_jobs_off");
  if (!quote || !link || !TRACKED_QUOTE_STATES.includes(lower(link.quoteState))) return skip("no_quote");
  const jobIds = Array.isArray(quote.jobIds) ? quote.jobIds : null;
  if (typeof quote.status !== "string" || jobIds === null) return skip("quote_not_read");
  if (!request) return skip("request_not_read");
  if (!Array.isArray(dispatches)) return skip("dispatches_not_read");
  if (!isDay(today)) return skip("today_unknown");
  if (!isOpenWorkflow(request.workflowStatus)) return skip("job_not_open");

  const crew = crewDay(request, dispatches);
  if (link.jobberJobId) return linkedJobPlan(link.visits, crew, switches.timezone);
  if (jobIds.some((id) => typeof id === "string" && id !== "")) return { action: "converted_adopt", reason: "quote_converted" };
  if (lower(link.jobState) === "deleted") return skip("job_deleted");
  const status = mapQuoteStatus(quote.status);
  if (status.detail === "converted") return skip("quote_converted_no_job");
  if (status.quoteStatus !== "approved") return { action: "wait", reason: "quote_not_approved" };
  if (crew.kind === "wait") return { action: "wait", reason: crew.reason };
  if (crew.kind === "none") return { action: "office_books", reason: "no_date" };
  if (crew.date < today) return { action: "office_books", date: crew.date, reason: "date_passed" };
  if (!switches.jobFromQuote) return { action: "office_books", date: crew.date, reason: "job_from_quote_unavailable" };
  return { action: "book", date: crew.date, reason: crew.reason };
}
