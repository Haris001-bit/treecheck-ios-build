// TreeCheck Jobber sync: the company's days as climbers see them: past, closed, booked in Jobber, or
// free. Used by bid-request-create (the days offered to climbers) and bid-submit (the days a climber
// picks). Server-side only. Maintained outside Lovable.
//
// Jobber is read once per call, with a short budget. If Jobber isn't connected or doesn't answer in
// time, closed and past days still apply and every other day counts as not checked, so a climber is
// never blocked by Jobber being down.

import { deadline, jobberRead, tokenFor } from "./jobberApi.ts";
import { addDays, busyDayCounts, dayStatuses, localDateOf, todayIn, type BusyVisit, type DayStatus } from "./freeDays.ts";
import { TC_BusyVisits } from "./jobberQueries.calendar.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** The days of the window and where their busy status came from. */
export interface CalendarDays {
  statuses: DayStatus[];
  /** "jobber" when Jobber's calendar was read; otherwise only closed and past days are known. */
  source: "jobber" | "unavailable" | "not_connected";
  /** The company's local today. */
  today: string;
}

export interface CalendarOptions {
  /** The company's IANA time zone. */
  tz: string;
  /** Weekdays the company is closed, 0 = Sunday to 6 = Saturday. */
  closedWeekdays: number[];
  /** Jobber visits on one day before that day counts as booked. */
  busyThreshold: number;
  /** Days from today to the window's first day (default 0). */
  startOffset?: number;
  /** How many days the window holds (default 28). */
  days?: number;
  /** Leave out visits of the Jobber job made from this quote: the job's own visits never block its own days. */
  excludeQuoteId?: string | null;
  /** Budget for the Jobber read, in ms (default 6000). */
  budgetMs?: number;
  /** For tests: the current time and the token. */
  now?: Date;
  token?: (admin: Admin, ownerId: string) => Promise<string | null>;
}

interface VisitNode {
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean | null;
  isComplete?: boolean | null;
  job?: { id?: string | null; quote?: { id?: string | null } | null } | null;
}

interface VisitsPage {
  visits?: {
    nodes?: Array<VisitNode | null> | null;
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
  } | null;
}

const MAX_PAGES = 5;

/** A Jobber visit in busyDayCounts' terms. */
export function toBusyVisit(n: VisitNode): BusyVisit {
  return {
    startAt: n.startAt ?? null,
    endAt: n.endAt ?? null,
    allDay: n.allDay === true,
    isComplete: n.isComplete === true,
    jobId: n.job?.id ?? null,
  };
}

/** The window's day statuses, with Jobber's visits when it can be read. Never throws for Jobber trouble. */
export async function calendarDays(admin: Admin, ownerId: string, opts: CalendarOptions): Promise<CalendarDays> {
  const now = opts.now ?? new Date();
  const today = todayIn(opts.tz, now);
  const from = addDays(today, opts.startOffset ?? 0);
  const days = opts.days ?? 28;
  const last = addDays(from, days - 1);

  let source: CalendarDays["source"] = "not_connected";
  let busyCounts: Record<string, number> | null = null;
  let coverageEnd: string | null = null;

  let token: string | null = null;
  try {
    token = await (opts.token ?? tokenFor)(admin, ownerId);
  } catch (e) {
    console.warn("calendar: Jobber token unavailable", e instanceof Error ? e.message : e);
  }
  if (token) {
    try {
      // The token is in hand before the budget starts (the token rule in jobberApi.ts).
      const signal = deadline(opts.budgetMs ?? 6000);
      // A day either side of the window, and a week before it, so visits that started earlier and
      // run into it still count whatever the time zone.
      const vars = { from: `${addDays(from, -8)}T00:00:00Z`, to: `${addDays(last, 2)}T00:00:00Z` };
      const visits: BusyVisit[] = [];
      let after: string | null = null;
      let more = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, throttle } = await jobberRead<VisitsPage>(token, TC_BusyVisits, { ...vars, after }, { signal });
        const nodes = (data.visits?.nodes ?? []).filter((n): n is VisitNode => Boolean(n));
        const own = (n: VisitNode) => Boolean(opts.excludeQuoteId) && n.job?.quote?.id === opts.excludeQuoteId;
        visits.push(...nodes.filter((n) => !own(n)).map(toBusyVisit));
        if (page === 0 && throttle?.requestedQueryCost != null) console.log(`calendar: query cost ${throttle.requestedQueryCost}`);
        more = data.visits?.pageInfo?.hasNextPage === true;
        after = data.visits?.pageInfo?.endCursor ?? null;
        if (!more || !after) break;
      }
      busyCounts = busyDayCounts(visits, opts.tz, { from, to: last });
      // With pages left unread, only the days before the last visit read are fully known.
      const lastStart = visits.length ? visits[visits.length - 1].startAt : null;
      coverageEnd = more && lastStart ? addDays(localDateOf(lastStart, opts.tz), -1) : last;
      source = "jobber";
    } catch (e) {
      console.warn("calendar: Jobber unavailable", e instanceof Error ? e.message : e);
      source = "unavailable";
      busyCounts = null;
      coverageEnd = null;
    }
  }

  const statuses = dayStatuses({
    from,
    days,
    today,
    closedWeekdays: opts.closedWeekdays,
    busyCounts,
    committedDates: [],
    busyThreshold: opts.busyThreshold,
    coverageEnd,
  });
  return { statuses, source, today };
}

/** "Tue Oct 20" for 2026-10-20. */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).replace(",", "");
}

/** The climber-facing reason a picked day was refused. */
export function refusalText(date: string, reason: "busy" | "closed"): string {
  return reason === "busy"
    ? `${dayLabel(date)} is already booked in Jobber. Pick another day.`
    : `${dayLabel(date)} is a day the company is closed. Pick another day.`;
}
