// TreeCheck Jobber sync: what Jobber's quote and job statuses mean for a TreeCheck job.
//
// Pure: no Deno globals, no network and no clock, so the edge functions and the vitest suite
// (src/lib/jobberSync/jobberStatus.test.ts) run the same file. Maintained outside Lovable. Nothing
// deployed imports it yet: the webhook's older part (PR 3), booking (PR 6) and the reconcile will.
//
// Jobber data comes in through the small input types below, never as raw GraphQL results. A later PR
// maps each Jobber reply into them once Step 0's introspection confirms the field names. Every status
// comparison ignores case and separators ("requires_invoicing", "REQUIRES_INVOICING" and
// "requiresInvoicing" are the same) until Step 0 confirms how Jobber spells its enum values.
//
// bid_requests.quote_status (mapQuoteStatus):
// * pending: in Jobber, not approved yet (draft, awaiting_response, changes_requested).
// * approved: the customer approved it (approved), or a job was made from it (converted).
// * archived: archived in Jobber.
// The detailed Jobber status goes to bid_request_quotes.jobber_quote_status.
// "archived" is a new value for bid_requests.quote_status, and it is safe: no screen reads that column
// (the Bid Board only reads the quote_status in bid-award's reply, and only to spot "not_created"), no
// function branches on its value, and the column has no check constraint. The old webhook's "declined"
// is not reused: archiving does not mean the customer said no, and the old code closed the job with it.
// A status this file does not know maps to null: the caller leaves the column as it is and stores only
// the detailed value, so an unexpected status can never overwrite "approved".
//
// Completion (completionDecision), plan section 6, PR 3:
// * complete: Jobber closed the job (completedAt set, or status requires_invoicing or archived), no
//   visit is still open, at least one visit was completed, TreeCheck's status is in OPEN_WORKFLOW, and
//   this completion was not synced before. It re-arms only when Jobber's completedAt changes. The
//   caller then sets Job complete, conditionally and once.
// * cancelled: Jobber closed or archived the job with no completed visit while TreeCheck's status is
//   still open. The caller sends office text M15, once, and changes nothing else.
// * record_only: Jobber shows the job complete, but TreeCheck's status was set by hand to something
//   outside OPEN_WORKFLOW, or this same completion was already synced. The caller only stores Jobber's
//   completedAt (bid_request_quotes.jobber_completed_at): a status set by hand is never overwritten.
// * noop: anything else. Open in Jobber (reopening a job never reverts anything), deleted (its own
//   branch handles that), closed with visits still open, or the visit counts were not read.
//
// Visit days (visitDateMatch) are calendar days in the company time zone, read exactly as
// freeDays.busyDayCounts reads them: a visit covers every local day from its start through the instant
// just before its end, so one ending exactly at local midnight leaves the next day out. All-day visits
// are read the same way until Step 0 test T7 shows how Jobber stores their times. Unlike freeDays,
// which throws on a time without its zone ("Z" or "+hh:mm") so the calendar falls back,
// visitDateMatch never throws, because one malformed visit must not stop the webhook: a visit whose
// start was given but cannot be read covers no day and is counted in `unreadable`, and an end that
// cannot be read counts as the start day. A visit with no start (null, missing or "") is unscheduled,
// not unreadable. When no visit matches and some start could not be read, bookingPlan skips
// (visits_not_read) instead of texting the office M9, so a mapping bug that loses every start fails
// safe (plan section 2.6) rather than reading as a job with no visit. PR 3 and PR 6 map Jobber's
// visits into VisitTimes with that in mind.
// This file imports nothing on purpose. The webhook's older part imports it from PR 3 on, and the
// webhook's import graph stays frozen after PR 3 (plan section 4, review P-M2), so the reading is a
// private copy of freeDays.localDateOf rather than an import. jobberStatus.test.ts checks that both
// files read every visit with readable times the same way.

/** bid_requests.quote_status values written from Jobber. */
export type BidQuoteStatus = "pending" | "approved" | "archived";

/** Jobber's quote statuses (QuoteStatusTypeEnum), in TreeCheck's spelling. */
export type JobberQuoteStatus = "draft" | "awaiting_response" | "changes_requested" | "approved" | "converted" | "archived";

/** What one Jobber quote status means for TreeCheck. */
export interface QuoteStatusMapping {
  /** For bid_requests.quote_status. Null for a status this file does not know: leave the column as it is. */
  quoteStatus: BidQuoteStatus | null;
  /**
   * For bid_request_quotes.jobber_quote_status: a JobberQuoteStatus, or an unknown status lower-cased
   * (at most 40 characters). Null when Jobber sent no status.
   */
  detail: string | null;
}

const QUOTE_STATUS_MAP: Readonly<Record<JobberQuoteStatus, BidQuoteStatus>> = Object.freeze({
  draft: "pending",
  awaiting_response: "pending",
  changes_requested: "pending",
  approved: "approved",
  converted: "approved",
  archived: "archived",
});

// Lower case with everything but letters removed, so any case or separator compares equal.
const statusKey = (value: unknown) => (typeof value === "string" ? value.toLowerCase().replace(/[^a-z]/g, "") : "");

const QUOTE_STATUS_BY_KEY = new Map(
  (Object.keys(QUOTE_STATUS_MAP) as JobberQuoteStatus[]).map((status) => [statusKey(status), status] as const),
);

/** Maps a Jobber quote status (any case) to bid_requests.quote_status plus the detailed value. */
export function mapQuoteStatus(jobberStatus: string | null | undefined): QuoteStatusMapping {
  const raw = typeof jobberStatus === "string" ? jobberStatus.trim() : "";
  if (raw === "") return { quoteStatus: null, detail: null };
  const known = QUOTE_STATUS_BY_KEY.get(statusKey(raw));
  return known
    ? { quoteStatus: QUOTE_STATUS_MAP[known], detail: known }
    : { quoteStatus: null, detail: raw.toLowerCase().slice(0, 40) };
}

/** bid_requests.workflow_status values that still count as open, in the Bid Board's order. */
export const OPEN_WORKFLOW = Object.freeze(
  ["open", "assessment_scheduled", "quote_sent", "quote_accepted", "job_scheduled"] as const,
);

/** bid_requests.workflow_status values that close a job (the Bid Board's archived list). */
export const CLOSED_WORKFLOW = Object.freeze(["job_complete", "quote_declined", "no_longer_needed", "unresponsive"] as const);

/** True when a job status is in OPEN_WORKFLOW; null or missing counts as "open", as on the Bid Board. */
export function isOpenWorkflow(status: string | null | undefined): boolean {
  return (OPEN_WORKFLOW as readonly string[]).includes(status ?? "open");
}

/** What a linked Jobber job's state means for its TreeCheck job (see the top of this file). */
export type CompletionDecision = "complete" | "cancelled" | "record_only" | "noop";

/** A Jobber job's completion facts, filled by a later PR from the job read (TC_JobState). */
export interface JobCompletionFacts {
  /** Jobber's job status as read, any case (for example "requires_invoicing" or "archived"). */
  jobStatus: string | null;
  /** When Jobber closed the job (ISO 8601), or null while it is open. */
  completedAt: string | null;
  /** Visits still open (visitsInfo.incompleteTotal); null when not read. */
  incompleteVisits: number | null;
  /** Visits marked complete, counted from the job's visits; null when not read. */
  completedVisits: number | null;
  /** True when the job no longer exists in Jobber. */
  deleted?: boolean;
}

/** TreeCheck's side of a completion, as read from bid_requests and bid_request_quotes. */
export interface CompletionSyncState {
  /** bid_requests.workflow_status (null counts as "open"). */
  workflowStatus: string | null;
  /** bid_request_quotes.completion_synced_at: when TreeCheck last set Job complete from Jobber. */
  completionSyncedAt: string | null;
  /** bid_request_quotes.jobber_completed_at: Jobber's completedAt as last stored. */
  jobberCompletedAt: string | null;
}

const CLOSED_JOB_STATUS_KEYS = new Set(["requiresinvoicing", "archived"]);

const isInstant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

// A visit count as read, or null when it is missing or not a whole number of at least 0.
const visitCount = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);

// True when two instants are the same moment (or both missing), whatever their ISO 8601 spelling.
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return isInstant(a) && isInstant(b) ? Date.parse(a) === Date.parse(b) : a === b;
}

/** Decides complete, cancelled, record_only or noop for a linked Jobber job (see the top of this file). */
export function completionDecision(
  job: JobCompletionFacts | null | undefined,
  state?: CompletionSyncState | null,
): CompletionDecision {
  if (!job || job.deleted) return "noop";
  const closed = isInstant(job.completedAt) || CLOSED_JOB_STATUS_KEYS.has(statusKey(job.jobStatus));
  const completed = visitCount(job.completedVisits);
  if (!closed || completed === null) return "noop";
  const open = isOpenWorkflow(state?.workflowStatus);
  if (completed === 0) return open ? "cancelled" : "noop";
  if (visitCount(job.incompleteVisits) !== 0) return "noop";
  if (!open) return "record_only";
  if (state?.completionSyncedAt && sameInstant(state.jobberCompletedAt, job.completedAt)) return "record_only";
  return "complete";
}

/** When one Jobber visit happens; freeDays' BusyVisit fits it. Filled by a later PR from the job's visits. */
export interface VisitTimes {
  /** Start, an ISO 8601 instant with its zone ("Z" or "+hh:mm"); null or missing for an unscheduled visit. */
  startAt?: string | null;
  /** End, with its zone; when missing or not after the start, the visit ends on its start day. */
  endAt?: string | null;
}

/** visitDateMatch's answer. */
export interface VisitDateMatch {
  /** True when some visit covers the date. */
  matches: boolean;
  /** Each scheduled visit's local start day, sorted, without repeats (M9's "has its visit on", booked_date). */
  visitDates: string[];
  /** Visits given with a start that could not be read (not an ISO time with its zone); they cover no day. */
  unreadable: number;
}

const DEFAULT_TIMEZONE = "America/Chicago";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// The same rule as freeDays: a Jobber time carries its zone, so the day never depends on the server's zone.
const ZONED_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

// NaN for anything that is not an ISO time with a zone. Unlike freeDays, which fails loudly so the
// calendar falls back, this comparison never throws: one malformed visit must not stop the webhook.
function zonedInstantMs(iso: unknown): number {
  return typeof iso === "string" && ZONED_INSTANT_RE.test(iso) ? Date.parse(iso) : NaN;
}

// The calendar day (YYYY-MM-DD) of an instant in a time zone, as freeDays.localDateOf reads it.
function localDayAt(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whether any visit covers `date` (YYYY-MM-DD) in the company time zone, plus each visit's start day. */
export function visitDateMatch(
  visits: readonly VisitTimes[] | null | undefined,
  date: string | null,
  tz?: string | null,
): VisitDateMatch {
  const zone = tz || DEFAULT_TIMEZONE;
  const day = typeof date === "string" && DAY_RE.test(date) ? date : null;
  const starts = new Set<string>();
  let matches = false;
  let unreadable = 0;
  for (const visit of visits ?? []) {
    // A visit that is not even an object came from a mapping bug, so it counts as unreadable.
    if (typeof visit !== "object" || visit === null) {
      unreadable++;
      continue;
    }
    const start = zonedInstantMs(visit.startAt);
    // Unscheduled or unreadable start: not on the calendar, so it covers no day.
    if (!Number.isFinite(start)) {
      if (visit.startAt !== null && visit.startAt !== undefined && visit.startAt !== "") unreadable++;
      continue;
    }
    const endMs = zonedInstantMs(visit.endAt);
    // A missing or unreadable end reads as the start day.
    const end = Number.isFinite(endMs) ? endMs : start;
    const first = localDayAt(start, zone);
    // Through the instant just before the end, so a visit ending at local midnight leaves the next day out.
    const last = end > start ? localDayAt(end - 1, zone) : first;
    starts.add(first);
    if (day !== null && first <= day && day <= last) matches = true;
  }
  return { matches, visitDates: [...starts].sort(), unreadable };
}
