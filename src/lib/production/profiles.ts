/**
 * Large-company setup: workload pricing profiles (Normal, High Demand, Winter Fill, Storm). An admin activates or
 * schedules one; analytics only recommend, in words. The AI never changes a price by itself. Pure.
 */
import type { Profile, RateCardDefinition, Service } from './rules';
import { dollars, r2 } from './answers';

export interface ProfileWindow { key: string; from: string; to: string }
export interface ProfileSettings { active_profile?: string | null; profile_schedule?: ProfileWindow[] | null }

/**
 * A manager's choice to act on the advice: crew-time prices raised by a percent, into a draft card that is reviewed and
 * published like any other. Per man-hour: the rates (company and crew) and the day prices go up. Pay plus a target
 * return: the margin rises so the selling rates go up by the same percent (they are worked out again at publish), and
 * the day prices go up. Whole dollars. Nothing else on the card changes.
 */
export function applyIncrease(def: RateCardDefinition, percent: number): RateCardDefinition {
  const f = 1 + Math.max(0, percent) / 100;
  const up = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * f));
  const next = structuredClone(def);
  if (next.pricing.method === 'cost_plus') {
    const m = next.pricing.targetMargin ?? 0.3;
    next.pricing.targetMargin = Math.min(0.95, Math.round((1 - (1 - m) / f) * 1000) / 1000);
    next.pricing.derivedRates = undefined;
  } else {
    next.pricing.manHourRate = up(next.pricing.manHourRate);
    next.crews = next.crews.map((c) => (c.manHourRate === undefined ? c : { ...c, manHourRate: up(c.manHourRate) }));
  }
  next.services = next.services.map((s) => (s.strategy.kind === 'crew_time' && s.strategy.floors?.length
    ? { ...s, strategy: { ...s.strategy, floors: s.strategy.floors.map((fl) => ({ ...fl, price: up(fl.price) as number })) } }
    : s));
  return next;
}

/** The profile in force on a day (YYYY-MM-DD): a scheduled window beats the manual choice; Normal otherwise. */
export function activeProfile(def: RateCardDefinition, settings: ProfileSettings | null | undefined, day: string): Profile | null {
  const byKey = (k: string | null | undefined) => (k ? def.profiles.find((p) => p.key === k) ?? null : null);
  for (const w of settings?.profile_schedule ?? []) {
    if (w && w.from <= day && day <= w.to) {
      const p = byKey(w.key);
      if (p) return p;
    }
  }
  return byKey(settings?.active_profile) ?? byKey('normal');
}

/** The adjustment for one service: a per-service figure beats a per-category one, which beats the company-wide one. */
export function profilePercent(p: Profile | null, s: Pick<Service, 'key' | 'category'>): number {
  if (!p) return 0;
  const svc = p.byService?.[s.key];
  if (typeof svc === 'number') return svc;
  const cat = p.byCategory?.[s.category];
  if (typeof cat === 'number') return cat;
  return p.percent;
}

export interface ProfileAdvice { key: string | null; text: string; increase?: { low: number; high: number } }

const DEFAULT_BANDS: Record<string, { min?: number; max?: number }> = {
  winter_fill: { max: 1 },
  normal: { min: 1, max: 3 },
  high_demand: { min: 3 },
};

/**
 * Which profile the booked backlog suggests (Normal at 1 to 2 weeks booked, High Demand at 3 or more, Winter Fill
 * when it's low), and, when crews earn less per man-hour than the target, a price increase of half to three quarters
 * of the gap: $108 against $125 gives "about 8 to 12%".
 */
export function recommendProfile(def: RateCardDefinition, input: { backlogWeeks: number; realizedRate?: number | null; targetRate?: number | null }): ProfileAdvice {
  const weeks = Math.max(0, input.backlogWeeks);
  const fits = (p: Profile) => {
    const band = p.backlogWeeks ?? DEFAULT_BANDS[p.key];
    if (!band) return false;
    return (band.min === undefined || weeks >= band.min) && (band.max === undefined || weeks < band.max);
  };
  const pick = def.profiles.find((p) => p.key !== 'storm' && fits(p)) ?? null;
  const parts: string[] = [];
  const w = r2(weeks);
  parts.push(`About ${w} week${w === 1 ? '' : 's'} of work is booked${pick ? `, so ${pick.name} fits` : ''}.`);
  let increase: ProfileAdvice['increase'];
  const real = input.realizedRate ?? null;
  const target = input.targetRate ?? null;
  if (real !== null && target !== null && real > 0 && target > real) {
    const gap = (target - real) / real;
    increase = { low: Math.round(gap * 50), high: Math.round(gap * 75) };
    parts.push(`Crews averaged ${dollars(real)} a man-hour against the ${dollars(target)} target. Raising prices about ${increase.low} to ${increase.high}% would move it closer.`);
  }
  return { key: pick?.key ?? null, text: parts.join(' '), increase };
}
