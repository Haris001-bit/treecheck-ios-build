// Financial Pulse: when Pulse last had news from Jobber, for "Jobber ... ago" on the screen and the
// stale-data warnings (A8, A11). Server-side only. No imports, so it can be
// unit-tested without Deno.

/** A check for changes re-reads anything updated this close to the last check, so nothing slips between. */
export const WATERMARK_OVERLAP_MS = 2 * 60_000;

const instant = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);

/**
 * When Pulse last had news from Jobber (ISO instant), or null while the first import is still running.
 * The later of:
 * * the start of the last full check for changes (the watermark is saved with the overlap taken off);
 * * the newest job saved once the first import is done. A webhook saves a job the moment it changes in
 *   Jobber, so this moves between full checks. Jobs saved while the first import is still running don't
 *   count: the past jobs are not all in yet.
 */
export function jobberUpdatedAt(
  state: { incremental_watermark?: unknown; backfill_completed_at?: unknown } | null | undefined,
  newestJobSave: string | null | undefined,
): string | null {
  const watermark = instant(state?.incremental_watermark);
  const imported = instant(state?.backfill_completed_at);
  const saved = instant(newestJobSave);
  const times: number[] = [];
  if (Number.isFinite(watermark)) times.push(watermark + WATERMARK_OVERLAP_MS);
  else if (Number.isFinite(imported)) times.push(imported);
  if (Number.isFinite(imported) && Number.isFinite(saved)) times.push(saved);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}
