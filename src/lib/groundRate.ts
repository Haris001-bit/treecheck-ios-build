export const STANDARD_GROUND_RATE = 25;
export const GROUND_RATE_LIMIT = { min: 0, max: 200 };

/** Blank → null (standard rate). Out of range or not a number → undefined (reject). */
export function rateValue(raw: unknown): number | null | undefined {
  const t = String(raw ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < GROUND_RATE_LIMIT.min || n > GROUND_RATE_LIMIT.max) return undefined;
  return Math.round(n * 100) / 100;
}
