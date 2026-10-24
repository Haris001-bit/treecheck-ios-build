// TreeCheck Jobber sync: Jobber's visit days on the Jobs calendar (JS2). For each job linked to a Jobber quote
// (bid_requests.jobber_quote_id), the local days of its Jobber visits are saved in job_jobber_days, and
// calendar_jobs() shows them in the office view instead of the job's award days. Server-side only. Maintained
// outside Lovable. Reads Jobber only: no Jobber writes and no texts. Saves job ids and dates only, never visit
// details, and logs counts only.
//
// Run by the jobber-visit-days function, which crew-release-holds calls every 10 minutes; the SQL claim lets a
// company through at most once every 9 minutes. Visits are read with the free-days query (TC_BusyVisits, reused
// unchanged) and each visit's days are read the way free days reads them: every local day from its start to the
// instant before its end. Completed visits count here, because the calendar shows where the work was.

import { deadline, jobberRead, shortJobberError, tokenFor, type JobberReply } from "./jobberApi.ts";
import { addDays, busyDayCounts, localDateOf, todayIn, type BusyVisit } from "./freeDays.ts";
import { TC_BusyVisits } from "./jobberQueries.calendar.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Days before today the sync keeps up to date. */
export const VISIT_DAYS_BACK = 30;
/** Days after today the sync keeps up to date. */
export const VISIT_DAYS_AHEAD = 90;
/** Pages of 100 visits read per run at most; with more left, the days up to the last visit read are saved. */
export const MAX_PAGES = 15;

/** A visit as TC_BusyVisits returns it. */
export interface VisitNode {
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

/** The days kept in step with Jobber, and the wider span read so visits that started earlier still count. */
export interface VisitDaysWindow {
  from: string;
  to: string;
  readFrom: string;
  readTo: string;
}

/** One calendar day of a linked job. */
export interface JobDay {
  bid_request_id: string;
  day: string;
}

export interface VisitDaysOptions {
  /** The company's IANA time zone. */
  tz: string;
  /** Budget for the Jobber read, in ms (default 20000). */
  budgetMs?: number;
  /** For tests: the current time and the token. */
  now?: Date;
  token?: (admin: Admin, ownerId: string) => Promise<string | null>;
}

export interface VisitDaysResult {
  /**
   * synced: every page read and the window saved. partial: the page cap was reached, so the days up to the last
   * visit read were saved. not_due: synced in the last 9 minutes. no_linked_jobs: nothing linked, any old days
   * cleared. not_connected: no Jobber token, nothing written. incomplete: too little read to save anything.
   * failed: an error, nothing written.
   */
  state: "synced" | "partial" | "not_due" | "no_linked_jobs" | "not_connected" | "incomplete" | "failed";
  /** Linked jobs that have at least one Jobber day in the window. */
  jobs: number;
  /** Job days saved. */
  days: number;
  /** Jobber pages read. */
  pages: number;
  /** Visits whose times couldn't be read (counted, never thrown). */
  unreadable: number;
  error?: string;
}

/** A visit in busyDayCounts' terms, always as not complete: the calendar shows completed visits too. */
function asBusyVisit(n: VisitNode): BusyVisit {
  return { startAt: n.startAt ?? null, endAt: n.endAt ?? null, allDay: n.allDay === true, isComplete: false, jobId: n.job?.id ?? null };
}

/** The window for a company's local today: 30 days back to 90 ahead, read with a week before and two days after. */
export function visitDaysWindow(today: string): VisitDaysWindow {
  const from = addDays(today, -VISIT_DAYS_BACK);
  const to = addDays(today, VISIT_DAYS_AHEAD);
  // As calendarDays reads: a week before the window and a day either side, whatever the time zone.
  return { from, to, readFrom: `${addDays(from, -8)}T00:00:00Z`, readTo: `${addDays(to, 2)}T00:00:00Z` };
}

/**
 * The local days, from `from` to `to`, of each linked job's visits: visits of jobs made from a TreeCheck quote
 * (`jobByQuote`: Jobber quote id to job id). Completed visits count. A visit with no start is skipped; one whose
 * times can't be read is counted in `unreadable`, never thrown. Sorted by job, then day, without duplicates.
 */
export function jobVisitDays(
  visits: readonly (VisitNode | null | undefined)[],
  jobByQuote: ReadonlyMap<string, string>,
  tz: string,
  from: string,
  to: string,
): { rows: JobDay[]; unreadable: number } {
  const seen = new Set<string>();
  const rows: JobDay[] = [];
  let unreadable = 0;
  for (const visit of visits) {
    const quoteId = visit?.job?.quote?.id;
    const jobId = quoteId ? jobByQuote.get(quoteId) : undefined;
    if (!visit || !jobId || !visit.startAt) continue;
    let days: string[];
    try {
      days = Object.keys(busyDayCounts([asBusyVisit(visit)], tz, { from, to }));
    } catch {
      unreadable++;
      continue;
    }
    for (const day of days) {
      const key = `${jobId}|${day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ bid_request_id: jobId, day });
    }
  }
  rows.sort((a, b) => a.bid_request_id.localeCompare(b.bid_request_id) || a.day.localeCompare(b.day));
  return { rows, unreadable };
}

/**
 * The last day of the window fully read. Every page read: the window's end. Pages left (visits come oldest first):
 * the day before the last visit read starts, as calendarDays does. Null when no visit time can be trusted.
 */
export function coveredUntil(visits: readonly (VisitNode | null | undefined)[], more: boolean, tz: string, to: string): string | null {
  if (!more) return to;
  for (let i = visits.length - 1; i >= 0; i--) {
    const start = visits[i]?.startAt;
    if (!start) continue;
    try {
      const day = addDays(localDateOf(start, tz), -1);
      return day < to ? day : to;
    } catch {
      return null;
    }
  }
  return null;
}

/** Saves a company's days for the window in one transaction (replace_job_jobber_days). */
async function replaceDays(admin: Admin, ownerId: string, from: string, to: string, rows: JobDay[]): Promise<number> {
  const { data, error } = await admin.rpc("replace_job_jobber_days", { p_owner: ownerId, p_from: from, p_to: to, p_rows: rows });
  if (error) throw new Error(`saving the days failed: ${error.message ?? error}`);
  return Number(data ?? 0);
}

function report(ownerId: string, r: VisitDaysResult): VisitDaysResult {
  const short = ownerId.slice(0, 8);
  const line = `visit days ${short}: ${r.state}, ${r.jobs} jobs, ${r.days} days, ${r.pages} pages, ${r.unreadable} unreadable`;
  if (r.state === "failed") console.warn(`${line}: ${r.error ?? "unknown error"}`);
  else console.log(line);
  return r;
}

/** One company's sync. Never throws; on any error nothing is written. */
export async function syncVisitDays(admin: Admin, ownerId: string, opts: VisitDaysOptions): Promise<VisitDaysResult> {
  const base: VisitDaysResult = { state: "failed", jobs: 0, days: 0, pages: 0, unreadable: 0 };
  try {
    const { data: due, error: claimError } = await admin.rpc("claim_jobber_visit_days", { p_owner: ownerId });
    if (claimError) throw new Error(`claim failed: ${claimError.message ?? claimError}`);
    if (due !== true) return { ...base, state: "not_due" };

    const today = todayIn(opts.tz, opts.now ?? new Date());
    const win = visitDaysWindow(today);

    const { data: linked, error: jobsError } = await admin
      .from("bid_requests").select("id, jobber_quote_id")
      .eq("owner_contractor_id", ownerId).not("jobber_quote_id", "is", null);
    if (jobsError) throw new Error(`reading the jobs failed: ${jobsError.message ?? jobsError}`);
    const jobByQuote = new Map<string, string>();
    for (const row of (linked ?? []) as Array<{ id?: string; jobber_quote_id?: string | null }>) {
      if (row.id && row.jobber_quote_id) jobByQuote.set(String(row.jobber_quote_id), row.id);
    }
    if (jobByQuote.size === 0) {
      // Nothing linked: clear any days left from jobs that were unlinked.
      const days = await replaceDays(admin, ownerId, win.from, win.to, []);
      return report(ownerId, { ...base, state: "no_linked_jobs", days });
    }

    let token: string | null = null;
    try {
      token = await (opts.token ?? tokenFor)(admin, ownerId);
    } catch (e) {
      console.warn("visit days: Jobber token unavailable", e instanceof Error ? e.message : e);
    }
    if (!token) return report(ownerId, { ...base, state: "not_connected" });

    // The token is in hand before the budget starts (the token rule in jobberApi.ts).
    const signal = deadline(opts.budgetMs ?? 20_000);
    const visits: VisitNode[] = [];
    let after: string | null = null;
    let more = false;
    let pages = 0;
    while (pages < MAX_PAGES) {
      const reply: JobberReply<VisitsPage> = await jobberRead<VisitsPage>(
        token, TC_BusyVisits, { from: win.readFrom, to: win.readTo, after }, { signal },
      );
      const data: VisitsPage = reply.data ?? {};
      pages++;
      visits.push(...(data.visits?.nodes ?? []).filter((n): n is VisitNode => Boolean(n)));
      more = data.visits?.pageInfo?.hasNextPage === true;
      after = data.visits?.pageInfo?.endCursor ?? null;
      if (!more || !after) break;
    }

    const covered = coveredUntil(visits, more, opts.tz, win.to);
    if (!covered || covered < win.from) return report(ownerId, { ...base, state: "incomplete", pages });
    const { rows, unreadable } = jobVisitDays(visits, jobByQuote, opts.tz, win.from, covered);
    const days = await replaceDays(admin, ownerId, win.from, covered, rows);
    const jobs = new Set(rows.map((r) => r.bid_request_id)).size;
    return report(ownerId, { state: more ? "partial" : "synced", jobs, days, pages, unreadable });
  } catch (e) {
    return report(ownerId, { ...base, error: shortJobberError(e) });
  }
}
