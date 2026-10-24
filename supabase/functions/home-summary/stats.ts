// Month-to-date business numbers for the Dashboard summary, from TreeCheck's own job records only
// (bid_requests and Scout captures) — never Financial Pulse data. Pure, so it is tested without the server.

export interface JobRow {
  created_at: string;
  workflow_status: string | null;
  completed_at: string | null;
  quote_pick: { amount?: number | string | null; picked_at?: string | null } | null;
}
export interface Window { from: string; to: string }
export interface PeriodStats {
  new_jobs: number;
  quotes_accepted: number;
  sold_amount: number;
  completed: number;
  lost: number;
  scout_estimates: number;
}
export interface MonthStats { current: PeriodStats & Window; previous: PeriodStats & Window; open_jobs: number }

const SOLD = new Set(["quote_accepted", "job_scheduled", "job_complete"]);
const LOST = new Set(["quote_declined", "no_longer_needed", "unresponsive"]);
const CLOSED = new Set(["job_complete", ...LOST]);

/** The company's calendar day of an instant. */
export const localDay = (iso: string, tz = "America/Chicago") =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });

/** This month so far, and the same days of last month (shorter if last month was shorter). */
export function monthWindows(today: string): { current: Window; previous: Window } {
  const [y, m, d] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const prevDays = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    current: { from: `${y}-${pad(m)}-01`, to: today },
    previous: { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(Math.min(d, prevDays))}` },
  };
}

const inside = (day: string | null, w: Window) => !!day && day >= w.from && day <= w.to;

export function periodStats(jobs: JobRow[], scoutDays: string[], w: Window, tz = "America/Chicago"): PeriodStats {
  const s: PeriodStats = { new_jobs: 0, quotes_accepted: 0, sold_amount: 0, completed: 0, lost: 0, scout_estimates: 0 };
  for (const j of jobs) {
    const created = localDay(j.created_at, tz);
    if (inside(created, w)) {
      s.new_jobs++;
      if (LOST.has(j.workflow_status ?? "")) s.lost++;
    }
    if (j.completed_at && inside(localDay(j.completed_at, tz), w)) s.completed++;
    const amt = Number(j.quote_pick?.amount ?? 0);
    const picked = j.quote_pick?.picked_at ? localDay(j.quote_pick.picked_at, tz) : null;
    if (amt > 0 && SOLD.has(j.workflow_status ?? "") && inside(picked, w)) {
      s.quotes_accepted++;
      s.sold_amount += amt;
    }
  }
  s.sold_amount = Math.round(s.sold_amount);
  s.scout_estimates = scoutDays.filter((d) => inside(d, w)).length;
  return s;
}

export function monthStats(jobs: JobRow[], scoutCreatedAt: string[], today: string, tz = "America/Chicago"): MonthStats {
  const w = monthWindows(today);
  const scoutDays = scoutCreatedAt.map((t) => localDay(t, tz));
  return {
    current: { ...w.current, ...periodStats(jobs, scoutDays, w.current, tz) },
    previous: { ...w.previous, ...periodStats(jobs, scoutDays, w.previous, tz) },
    open_jobs: jobs.filter((j) => !CLOSED.has(j.workflow_status ?? "open")).length,
  };
}

/** True when there is nothing to say for either period. */
export function nothingRecorded(s: MonthStats): boolean {
  const any = (p: PeriodStats) => p.new_jobs + p.quotes_accepted + p.completed + p.scout_estimates > 0;
  return !any(s.current) && !any(s.previous);
}
