// Limits for numbers owners type during onboarding and calibration (signup test, 2026-10-19). Negative margins and
// rates, a 99,999-inch trunk and a -5 hour job were all saved as typed. The limits are wide on purpose: they only
// catch typos, never a real job.
import type { CharKey, ConfirmedCharacteristics } from '@/lib/production/calibration';

export interface Limit { min: number; max: number }

/** What Scout's confirm step accepts. Blank stays allowed: it means "don't know". */
export const CHAR_LIMITS: Partial<Record<CharKey, Limit>> = {
  dbh_inches: { min: 1, max: 200 },
  height_ft: { min: 5, max: 300 },
  loads: { min: 0, max: 100 },
  tree_count: { min: 1, max: 50 },
};
export const JOB_HOURS_LIMIT: Limit = { min: 0.5, max: 240 };
export const LOADS_LIMIT: Limit = { min: 0, max: 100 };

export function inRange(value: number, limit: Limit): boolean {
  return Number.isFinite(value) && value >= limit.min && value <= limit.max;
}

/** The first typed number outside its limit, or null when every number is plausible. */
export function firstOutOfRange(c: ConfirmedCharacteristics): CharKey | null {
  for (const [key, limit] of Object.entries(CHAR_LIMITS) as [CharKey, Limit][]) {
    const value = c[key]?.value;
    if (value == null) continue;
    if (typeof value !== 'number' || !inRange(value, limit)) return key;
  }
  return null;
}

/** Large-company rate cards: the widest a typed price, percent or count may be (typos only, never a real job). */
export const RATE_CARD_MONEY_MAX = 1_000_000;
export const RATE_CARD_PERCENT_MAX = 100;
export const RATE_CARD_COUNT_MAX = 1_000;

/** A typed cost or percentage: blank is 0, never negative, never above `max`. */
export function clampTyped(raw: string, max = Number.MAX_SAFE_INTEGER): number {
  const n = raw === '' ? 0 : Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
}
