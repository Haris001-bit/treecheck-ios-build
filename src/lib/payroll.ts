// Pay math for the Monday pay summary. Pure — no I/O.

/**
 * Climber pay from the homeowner quote picked.
 * At or below the quote built from his minimum → his minimum.
 * At or above the quote built from his ideal → his ideal.
 * In between → the same fraction of the way from minimum to ideal.
 */
export function climberPayFromQuote(
  saleMin: number | null | undefined,
  saleIdeal: number | null | undefined,
  chosen: number,
  min: number,
  ideal: number | null | undefined,
): number {
  const lo = Number(min);
  const hi = ideal != null && Number(ideal) > 0 ? Number(ideal) : lo;
  if (!(hi > lo)) return Math.round(lo);
  const sMin = Number(saleMin);
  const sIdeal = Number(saleIdeal);
  if (!Number.isFinite(sMin) || !Number.isFinite(sIdeal) || !(sIdeal > sMin)) {
    if (Number.isFinite(sIdeal) && chosen >= sIdeal) return Math.round(hi);
    return Math.round(lo);
  }
  if (chosen <= sMin) return Math.round(lo);
  if (chosen >= sIdeal) return Math.round(hi);
  const f = (chosen - sMin) / (sIdeal - sMin);
  return Math.round(lo + f * (hi - lo));
}

export const GROUND_HOURLY = 25;
export const GROUND_MIN_HOURS = 4;
export const GROUND_MIN_PAY = 100;

/**
 * Ground worker pay for one job.
 * Day rate set on the call-out → that day rate.
 * Otherwise hourly (job rate, else $25): never under 4 hours, never under $100.
 */
export function groundPay(hours: number, rate?: number | null, rateType?: string | null, workerRate?: number | null): number {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  if (rateType === 'day' && rate != null && Number(rate) > 0) return Math.round(Number(rate));
  const r = rate != null && Number(rate) > 0 ? Number(rate) : GROUND_HOURLY;
  const r2 = Math.max(r, Number(workerRate) > 0 ? Number(workerRate) : 0);
  return Math.round(Math.max(GROUND_MIN_PAY, Math.max(h, GROUND_MIN_HOURS) * r2));
}

/** Monday (YYYY-MM-DD) of the Chicago week containing `d`. */
export function weekStartChicago(d: Date): string {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const dow = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - dow);
  const y = local.getFullYear(), m = String(local.getMonth() + 1).padStart(2, '0'), dd = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
