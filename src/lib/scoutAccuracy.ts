// Mirrors the hit rule in public.home_scout_accuracy(): keep both in sync.
export const SCOUT_HIT_BAND = 0.15;

export function isScoutHit(min: number, max: number, sold: number): boolean {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (sold >= lo && sold <= hi) return true;
  return Math.abs((lo + hi) / 2 - sold) / sold <= SCOUT_HIT_BAND;
}
