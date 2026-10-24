// TreeCheck Jobber sync: which days a climber can be offered or can pick (plan sections 4 and 8).
//
// Pure functions only: no Deno globals, no network and no clock ("now" and "today" are parameters), so
// the edge functions and the vitest suite (src/lib/jobberSync/freeDays.test.ts) run the same file.
// Maintained outside Lovable.
//
// Dates are local calendar days in the company's time zone (company_jobber_settings.timezone, default
// America/Chicago), written YYYY-MM-DD. An instant becomes a local day once, through Intl (localDateOf,
// todayIn); after that everything is calendar arithmetic at UTC noon, so a daylight-saving change never
// adds or loses a day. Weekdays are 0 = Sunday to 6 = Saturday, as in company_settings.closed_weekdays
// and _shared/jobActivity.ts.
//
// Busy days (busyDayCounts): a Jobber visit counts on every local day from its start through the
// instant just before its end, so a visit that ends exactly at local midnight leaves the next day free.
// All-day visits are read the same way, from their local start day through the day of the instant just
// before endAt. Completed visits, visits with no start and visits of excluded jobs never count. Step 0
// test T7 records Jobber's raw startAt, endAt and allDay strings (a 7:30 pm visit, an all-day visit and
// a 2-day visit); the PR that maps Jobber's visits into BusyVisit checks them against this reading first.
//
// Day statuses (dayStatuses), first match wins:
// * past: before today;
// * free: a day locked for this job because its ground crew is already hired for it (lockedDates). Plan
//   section 8: closed weekdays always win, except on such a day, so the climber can keep it in their
//   pick (bid-climber-dates refuses a pick that drops the hired day). It beats busy days too;
// * closed: a closed weekday, whatever Jobber says;
// * busy: at least busyThreshold Jobber visits, or a day TreeCheck already promised to another job;
// * unknown: after the last day the Jobber data covers (allowed, then checked when the climber picks);
// * free: everything else. Saturdays and Sundays get a status like any day; only the offer skips them.
//
// Offered dates (pickOfferedDates), best first, and the first rule that finds a day wins: free weekdays;
// unknown weekdays (no Jobber data, so weekdays minus closed and committed days); any open weekday (every
// weekday busy, today's fallback); open weekend days (closed on every weekday); any day from today on.
// So the list is never empty while the window holds a day from today on. The caller starts the window
// tomorrow, as bid-request-create does today.
//
// Picked dates (validatePickedDates) keep the "wants-site-visit" marker, turn away past days and anything
// that is not a date, and refuse closed or busy days found in the statuses. A date outside the statuses
// is kept unchecked, so build the statuses over every picked date, with the job's hired day in
// lockedDates so it is kept.

/** The marker a climber adds to their picked dates to ask for a site visit first. It is not a date. */
export const WANTS_SITE_VISIT = "wants-site-visit";

/** How a day shows to climbers and the office. */
export type DayStatusKind = "past" | "closed" | "busy" | "unknown" | "free";

/** One day of the window (YYYY-MM-DD) and its status. */
export interface DayStatus {
  date: string;
  status: DayStatusKind;
}

/**
 * A Jobber visit reduced to what the busy count needs. A later PR maps Jobber's visit nodes into it,
 * once introspection and T7 confirm the field names and the raw time strings.
 */
export interface BusyVisit {
  /** ISO 8601 instant with its zone ("Z" or "+hh:mm"); null for an unscheduled visit. */
  startAt: string | null;
  /** ISO 8601 instant with its zone; null counts the start day only. */
  endAt: string | null;
  /** Jobber's all-day flag. Read like a timed visit (see the header) until T7 shows otherwise. */
  allDay?: boolean;
  /** A completed visit never makes a day busy. */
  isComplete?: boolean;
  /** The Jobber job the visit belongs to, matched against excludeJobIds. */
  jobId?: string | null;
}

/** Options for busyDayCounts. */
export interface BusyCountOptions {
  /** Jobber jobs whose visits never count, such as the job already linked to this TreeCheck job. */
  excludeJobIds?: Iterable<string>;
  /** First local day to count. Pass the cached window so one very long visit stays bounded. */
  from?: string;
  /** Last local day to count (inclusive). */
  to?: string;
}

/** Inputs for dayStatuses. Every date is a local YYYY-MM-DD in the company's time zone. */
export interface DayStatusInput {
  /** First day of the window. */
  from: string;
  /** How many days the window holds. */
  days: number;
  /** The company's local today (todayIn). Earlier days are "past". */
  today: string;
  /** Weekdays the company is closed, 0 = Sunday to 6 = Saturday. */
  closedWeekdays: Iterable<number>;
  /** Jobber visits per local day (busyDayCounts, or the cached busy_counts); null with no Jobber data. */
  busyCounts: Readonly<Record<string, number>> | null;
  /** Days TreeCheck already promised to other jobs. Always "busy". */
  committedDates: Iterable<string>;
  /** Visits that make a day busy (busy_visits_per_day). Anything below 1 counts as 1. */
  busyThreshold: number;
  /** Last day the Jobber data covers; later days are "unknown". null when there is no Jobber data at all. */
  coverageEnd: string | null;
  /**
   * Days locked for this job because its ground crew is already hired for them (the filled day-pick
   * call-out's awarded_date). Unless past, each reads "free", even on a closed weekday or a busy day, so
   * the climber can keep it (plan section 8). None when left out.
   */
  lockedDates?: Iterable<string>;
}

/** Why validatePickedDates turned a date away. "invalid" is anything that is not a real YYYY-MM-DD date. */
export type RejectReason = "past" | "closed" | "busy" | "invalid";

/** What validatePickedDates returns: the kept dates in the order given, and each date turned away with why. */
export interface PickedDates {
  kept: string[];
  rejected: Array<{ date: string; reason: RejectReason }>;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A Jobber time must carry its zone, so the local day never depends on the server's own time zone.
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const QUIET_FROM_HOUR = 21;
const QUIET_UNTIL_HOUR = 7;

// One formatter per zone and kind: building a new one for every visit is slow over hundreds of visits.
const formats = new Map<string, Intl.DateTimeFormat>();

function partsAt(ms: number, timeZone: string, kind: "day" | "hour"): Record<string, string> {
  const key = `${kind} ${timeZone}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(
      "en-CA",
      kind === "day"
        ? { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }
        : { timeZone, hour: "2-digit", hourCycle: "h23" },
    );
    formats.set(key, format);
  }
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(ms)) parts[part.type] = part.value;
  return parts;
}

function localDateAt(ms: number, timeZone: string): string {
  const { year, month, day } = partsAt(ms, timeZone, "day");
  return `${year}-${month}-${day}`;
}

function msOf(now: Date): number {
  const ms = now.getTime();
  if (!Number.isFinite(ms)) throw new Error("Not a valid Date");
  return ms;
}

function instantMs(iso: string): number {
  const ms = INSTANT_RE.test(iso) ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) throw new Error(`Not an ISO time with a zone: ${JSON.stringify(iso)}`);
  return ms;
}

// UTC noon of a real calendar date, or NaN: "2026-02-30" is NaN, though Date.UTC would roll it into March.
function noonMs(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return new Date(ms).toISOString().startsWith(date) ? ms : NaN;
}

function noonOf(date: string): number {
  const ms = noonMs(date);
  if (Number.isNaN(ms)) throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  return ms;
}

function requireDate(date: string): string {
  noonOf(date);
  return date;
}

/** Today's date (YYYY-MM-DD) in the time zone at the instant `now`. */
export function todayIn(tz: string, now: Date): string {
  return localDateAt(msOf(now), tz);
}

/** The local date (YYYY-MM-DD) in the time zone of an ISO instant that carries its zone ("Z" or "+hh:mm"). */
export function localDateOf(iso: string, tz: string): string {
  return localDateAt(instantMs(iso), tz);
}

/** The date `n` days after `date` (negative goes back), counted at UTC noon so daylight saving never shifts it. */
export function addDays(date: string, n: number): string {
  if (!Number.isInteger(n)) throw new Error(`addDays needs a whole number of days, got ${n}`);
  return new Date(noonOf(date) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Weekday of a YYYY-MM-DD date: 0 = Sunday to 6 = Saturday, the numbers closed_weekdays uses. */
export function weekdayOf(date: string): number {
  return new Date(noonOf(date)).getUTCDay();
}

/** Whole days from `a` to `b`, so daysBetween("2026-10-08", "2026-10-10") is 2. */
export function daysBetween(a: string, b: string): number {
  return Math.round((noonOf(b) - noonOf(a)) / DAY_MS);
}

/** Jobber visits per local day (YYYY-MM-DD to count), each visit read as the header describes. */
export function busyDayCounts(
  visits: readonly BusyVisit[],
  tz: string,
  options: BusyCountOptions = {},
): Record<string, number> {
  const excluded = new Set<string>(options.excludeJobIds ?? []);
  const from = options.from ? requireDate(options.from) : null;
  const to = options.to ? requireDate(options.to) : null;
  const counts: Record<string, number> = {};
  for (const visit of visits) {
    if (!visit.startAt || visit.isComplete || (visit.jobId && excluded.has(visit.jobId))) continue;
    const start = instantMs(visit.startAt);
    const end = visit.endAt ? instantMs(visit.endAt) : start;
    let day = localDateAt(start, tz);
    // The day of the instant just before the end: a visit ending at local midnight leaves that day free.
    let last = end > start ? localDateAt(end - 1, tz) : day;
    if (from && from > day) day = from;
    if (to && to < last) last = to;
    for (; day <= last; day = addDays(day, 1)) counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}

/** The status of each day in the window, first match wins: past, locked (free), closed, busy, unknown, free. */
export function dayStatuses(input: DayStatusInput): DayStatus[] {
  const today = requireDate(input.today);
  const coverageEnd = input.coverageEnd ? requireDate(input.coverageEnd) : null;
  const closed = new Set(Array.from(input.closedWeekdays, Number));
  const committed = new Set(input.committedDates);
  const locked = new Set(input.lockedDates ?? []);
  const threshold = input.busyThreshold >= 1 ? input.busyThreshold : 1;
  const statusOf = (date: string): DayStatusKind => {
    if (date < today) return "past";
    if (locked.has(date)) return "free";
    if (closed.has(weekdayOf(date))) return "closed";
    if ((input.busyCounts?.[date] ?? 0) >= threshold || committed.has(date)) return "busy";
    if (coverageEnd === null || date > coverageEnd) return "unknown";
    return "free";
  };
  const out: DayStatus[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(input.from, i);
    out.push({ date, status: statusOf(date) });
  }
  return out;
}

const isWeekend = (date: string) => {
  const day = weekdayOf(date);
  return day === 0 || day === 6;
};
const isOpen = (s: DayStatus) => s.status !== "past" && s.status !== "closed";

// pickOfferedDates' rules, best first (see the header).
const OFFER_RULES: ReadonlyArray<(s: DayStatus) => boolean> = [
  (s) => s.status === "free" && !isWeekend(s.date),
  (s) => s.status === "unknown" && !isWeekend(s.date),
  (s) => isOpen(s) && !isWeekend(s.date),
  isOpen,
  (s) => s.status !== "past",
];

/** Up to `want` dates to offer climbers, free weekdays first; never empty while a window day is today or later. */
export function pickOfferedDates(statuses: readonly DayStatus[], want = 4): string[] {
  for (const rule of OFFER_RULES) {
    const picked = statuses.filter(rule).slice(0, want).map((s) => s.date);
    if (picked.length > 0) return picked;
  }
  return [];
}

/** Splits picked dates into kept and rejected: keeps the site-visit marker, refuses past, closed and busy days. */
export function validatePickedDates(
  dates: readonly string[],
  options: { today: string; statuses?: readonly DayStatus[] },
): PickedDates {
  const today = requireDate(options.today);
  const statusByDate = new Map(
    (options.statuses ?? []).map((s): [string, DayStatusKind] => [s.date, s.status]),
  );
  const result: PickedDates = { kept: [], rejected: [] };
  for (const date of new Set(dates)) {
    if (date === WANTS_SITE_VISIT) {
      result.kept.push(date);
    } else if (Number.isNaN(noonMs(date))) {
      result.rejected.push({ date, reason: "invalid" });
    } else if (date < today) {
      result.rejected.push({ date, reason: "past" });
    } else {
      // Free, unknown or outside the statuses: allowed, since a check that cannot run fails open.
      const status = statusByDate.get(date);
      if (status === "closed" || status === "busy") result.rejected.push({ date, reason: status });
      else result.kept.push(date);
    }
  }
  return result;
}

/** True from 21:00 to 06:59 local time, when automatic crew hire texts are held. */
export function inQuietHours(tz: string, now: Date): boolean {
  const hour = Number(partsAt(msOf(now), tz, "hour").hour);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

/** True while the awarded climber still owes their days: status "requested" and no confirmed dates (plan 0.17). */
export function climberDatesPending(request: {
  climber_dates_status?: string | null;
  confirmed_dates?: unknown;
}): boolean {
  // "requested" alone is not enough: ground-crew-daily also sets it to ask for more days on a job whose
  // days are already confirmed.
  if (request.climber_dates_status !== "requested") return false;
  return !Array.isArray(request.confirmed_dates) || request.confirmed_dates.length === 0;
}
