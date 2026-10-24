// The words on the Scout learning card (the weekly feedback loop). Pure, so the tests cover every state.
// Owners read this, so: plain words, no jargon, and no long dashes.
import { addDays, format, parseISO } from "date-fns";

export interface LearnJob {
  ref: string;
  picked_on: string;
  service: string;
  city: string | null;
  estimate: number;
  estimate_low: number;
  estimate_high: number;
  picked: number;
  auto: boolean;
  gap_pct: number;
  size_given: boolean | null;
  older: boolean;
  /** Reports from 2026-10-22 on: Scout's own notes, the crew's numbers, whether there's a photo, and what Scout would
   * have priced the job at with that run's new adjustments. */
  may_include_edit?: boolean;
  notes?: string | null;
  crew?: LearnCrew | null;
  has_photo?: boolean;
  projected?: number;
}

export interface LearnCrew {
  hours: number | null;
  crew: number | null;
  ground_crew: number | null;
  disposal_loads: number | null;
  mini_skid: boolean | null;
  equipment: string | null;
}

export type RunStatus = "running" | "rewritten" | "unchanged" | "no_jobs" | "failed";

export interface LearnRun {
  id: string;
  kind: "initial" | "weekly";
  week_start: string | null;
  status: RunStatus;
  finished_at: string | null;
  jobs: LearnJob[];
  avg_gap_pct: number | null;
  summary: string | null;
  changes: string[];
  active: boolean;
  undone_at: string | null;
}

export interface LearnFactor { service: string; size: string; factor: number; jobs: number }
export interface LearnGuidance { factors: LearnFactor[]; rules: string[] }

export interface SurfaceReport {
  active: { run_id: string; guidance: LearnGuidance | null; since: string | null } | null;
  can_undo: boolean;
  runs: LearnRun[];
}

export interface LearningReport {
  visible: boolean;
  is_owner?: boolean;
  enabled?: boolean;
  pending_first_run?: boolean;
  scout?: SurfaceReport;
  website?: SurfaceReport | null;
}

export const INTRO =
  "Every week Scout compares its estimates with the prices you picked in Jobs, and adjusts how it prices your jobs. " +
  "You see what it learned here, and you can undo the latest change or switch it off at any time.";
export const TEAM_OFF = "Your company owner can turn this on.";
export const PENDING = "Learning from your past jobs. This takes a few minutes.";
export const UNDO_CONFIRM = "Scout goes back to the adjustments it used before this change. You can't redo it.";

export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** "Oct 13" from a YYYY-MM-DD date. */
export function dateLabel(date: string | null): string {
  if (!date) return "";
  try {
    return format(parseISO(date), "MMM d");
  } catch {
    return date;
  }
}

/**
 * How far Scout's total was from the picked total on a run's jobs, in percent, or null for none. One small job
 * can't swing it the way an average of the per-job gaps does (a $297 pick on a $1,012 estimate is +241% alone).
 */
export function overallGap(jobs: LearnJob[]): number | null {
  let scout = 0;
  let picked = 0;
  for (const j of jobs) {
    if (!(Number(j.estimate) > 0) || !(Number(j.picked) > 0)) continue;
    scout += Number(j.estimate);
    picked += Number(j.picked);
  }
  return picked > 0 ? ((scout - picked) / picked) * 100 : null;
}

/** How far Scout was off, in words. */
export function gapText(gap: number | null): string {
  if (gap === null || !Number.isFinite(gap)) return "";
  const pct = Math.round(Math.abs(gap));
  if (pct === 0) return "Scout matched";
  return gap > 0 ? `Scout was ${pct}% high` : `Scout was ${pct}% low`;
}

/** The heading over a run's report, e.g. "Last week (Oct 19 to Oct 25)" or "Week of Oct 19". */
export function runTitle(run: LearnRun, latest: boolean): string {
  if (run.kind === "initial") return "From your past jobs";
  if (!latest || !run.week_start) return `Week of ${dateLabel(run.week_start)}`;
  let end = "";
  try {
    end = format(addDays(parseISO(run.week_start), 6), "MMM d");
  } catch {
    end = "";
  }
  return end ? `Last week (${dateLabel(run.week_start)} to ${end})` : `Week of ${dateLabel(run.week_start)}`;
}

/** One line on what the run did. */
export function statusLine(run: LearnRun): string {
  if (run.undone_at) return "You undid this change.";
  switch (run.status) {
    case "rewritten":
      return "Scout learned from these jobs. Its new adjustments are live.";
    case "unchanged":
      return "Scout looked at these jobs and kept its current adjustments.";
    case "no_jobs":
      return "No new picked jobs that week, so nothing changed.";
    case "failed":
      return "This report didn't finish. Scout keeps its current adjustments and tries again.";
    default:
      return "Working on this report.";
  }
}

const SERVICE_WORDS: Record<string, string> = { "Tree Removal": "Tree removals", "Stump Grinding": "Stump grinding jobs" };
const SIZE_WORDS: Record<string, string> = {
  "1-6": "of 1 to 6 inches", "7-12": "of 7 to 12 inches", "13-24": "of 13 to 24 inches", "25-36": "of 25 to 36 inches",
  "36+": "over 36 inches", not_given: "with no trunk size given", any: "",
};

/** One price factor as a sentence, e.g. "Tree removals with no trunk size given come out 20% lower." */
export function factorSentence(f: LearnFactor): string {
  const what = [SERVICE_WORDS[f.service] ?? f.service, SIZE_WORDS[f.size] ?? ""].filter(Boolean).join(" ");
  const pct = Math.round(Math.abs(f.factor - 1) * 100);
  if (pct === 0) return `${what} keep Scout's standard price.`;
  return `${what} come out ${pct}% ${f.factor < 1 ? "lower" : "higher"}.`;
}

/** The overall gap had Scout priced the run's jobs with its new adjustments, or null when the run has no such figure. */
export function projectedGap(jobs: LearnJob[]): number | null {
  const withProjection = jobs.filter((j) => typeof j.projected === "number" && j.projected > 0);
  if (!withProjection.length) return null;
  return overallGap(withProjection.map((j) => ({ ...j, estimate: j.projected as number })));
}

/** The crew's offer in a line, e.g. "6 hours, crew of 3, 2 on the ground, 2 loads, mini skid". */
export function crewText(c: LearnCrew | null | undefined): string {
  if (!c) return "";
  const n = (v: number | null, one: string, many: string) => (v != null && v > 0 ? `${v} ${v === 1 ? one : many}` : "");
  return [
    n(c.hours, "hour", "hours"),
    c.crew != null && c.crew > 0 ? `crew of ${c.crew}` : "",
    c.ground_crew != null && c.ground_crew > 0 ? `${c.ground_crew} on the ground` : "",
    n(c.disposal_loads, "load", "loads"),
    c.mini_skid ? "mini skid" : "",
    c.equipment ?? "",
  ].filter(Boolean).join(", ");
}

/** The newest finished run, and whether a newer one is still being worked out. */
export function latestRun(runs: LearnRun[]): { latest: LearnRun | null; working: boolean } {
  const finished = runs.filter((r) => r.status !== "running");
  return { latest: finished[0] ?? null, working: runs.some((r) => r.status === "running") };
}
