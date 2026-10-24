/** Pure calibration helpers. Production comparisons never use selling price. */
import type { JobCharacteristics, ProductionPlan, JobMethod, Fact, Source } from './engine';
import { personHoursOf } from './engine';

export type AiConfidence = 'high' | 'medium' | 'low' | 'unknown';
export interface AiField<T> { value: T | null; confidence: AiConfidence }
export interface AiCharacteristics {
  dbh_inches: AiField<number>; height_ft: AiField<number>; canopy_dense: AiField<boolean>;
  multiple_leaders: AiField<boolean>; condition: AiField<'healthy' | 'declining' | 'dead'>;
  near_structure: AiField<boolean>; access: AiField<'easy' | 'moderate' | 'tight'>;
  drop_zone: AiField<'open' | 'restricted'>; power_lines: AiField<boolean>; crane_indicated: AiField<boolean>;
  loads: AiField<number>; tree_count: AiField<number>; observations: string[];
}

/** One owner-reviewed characteristic: value (null = unknown), where it came from, AI confidence. */
export interface ConfirmedField<T = unknown> { value: T | null; source: 'ai' | 'owner' | 'unknown'; aiConfidence: AiConfidence }
export type ConfirmedCharacteristics = Record<CharKey, ConfirmedField>;

export const CHAR_KEYS = ['dbh_inches', 'height_ft', 'canopy_dense', 'multiple_leaders', 'condition', 'near_structure', 'access', 'drop_zone', 'power_lines', 'crane_indicated', 'loads', 'tree_count'] as const;
export type CharKey = typeof CHAR_KEYS[number];

export const emptyAi = (): AiCharacteristics => ({
  ...Object.fromEntries(CHAR_KEYS.map((k) => [k, { value: null, confidence: 'unknown' }])) as any,
  observations: [],
});

/** Seed the confirm step from AI output, keeping unknowns as unknown. */
export function seedConfirmed(ai: AiCharacteristics | null): ConfirmedCharacteristics {
  const src = ai ?? emptyAi();
  return Object.fromEntries(CHAR_KEYS.map((k) => {
    const f = (src as any)[k] as AiField<unknown> | undefined;
    const known = f && f.value != null && f.confidence !== 'unknown';
    return [k, { value: known ? f!.value : null, source: known ? 'ai' : 'unknown', aiConfidence: f?.confidence ?? 'unknown' }];
  })) as ConfirmedCharacteristics;
}

/** Map confirmed characteristics into Production Engine inputs. Owner-set = known; AI = inferred (low AI confidence = hint). */
export function toJobCharacteristics(c: ConfirmedCharacteristics): JobCharacteristics {
  const fact = <T,>(k: CharKey): Fact<T> | undefined => {
    const f = c[k];
    if (!f || f.value == null || f.source === 'unknown') return undefined;
    const source: Source = f.source === 'owner' ? 'known' : f.aiConfidence === 'low' ? 'hint' : 'inferred';
    return { value: f.value as T, source };
  };
  return {
    service: 'Tree Removal',
    dbhInches: fact<number>('dbh_inches'), heightFt: fact<number>('height_ft'),
    canopyDense: fact('canopy_dense'), multipleLeaders: fact('multiple_leaders'), condition: fact('condition'),
    nearStructure: fact('near_structure'), access: fact('access'), dropZone: fact('drop_zone'),
    powerLines: fact('power_lines'), craneIndicated: fact('crane_indicated'), loads: fact<number>('loads'),
    treeCount: fact<number>('tree_count'),
  };
}

export interface ActualJob {
  method: JobMethod | 'other';
  crew: { roleKey: string; count: number }[];
  durationHours: number;
  equipment: string[];
  loads: number | null;
}

export const actualPersonHours = (a: ActualJob) => Math.round(a.crew.reduce((s, c) => s + c.count * a.durationHours, 0) * 100) / 100;

const countRole = (crew: { roleKey: string; count: number }[], k: string) => crew.filter((c) => c.roleKey === k).reduce((s, c) => s + c.count, 0);

export function verdict(predicted: ProductionPlan, actual: ActualJob): string {
  const p = predicted.personHours || personHoursOf(predicted.crew);
  const a = actualPersonHours(actual);
  if (!p || !a) return 'Not enough information to compare labor on this job.';
  const diff = (a - p) / p;
  if (Math.abs(diff) <= 0.15) return "Scout's production estimate was close to how your company performed this job.";
  return diff > 0 ? 'Scout underestimated labor on this job.' : 'Scout overestimated labor on this job.';
}

export interface CalibrationRecord { predicted_plan: ProductionPlan | null; actual: ActualJob | null }

const avg = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
const mode = (xs: number[]) => {
  if (!xs.length) return null;
  const m = new Map<number, number>(); xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
};

export interface CalibrationSummary {
  jobs: number;
  avgPredDuration: number | null; avgActDuration: number | null;
  avgPredPersonHours: number | null; avgActPersonHours: number | null;
  commonPredGround: number | null; commonActGround: number | null;
  equipment: { key: string; predicted: number; used: number }[];
}

/** Production-only summary; selling price is intentionally excluded. */
export function summarize(records: CalibrationRecord[]): CalibrationSummary {
  const done = records.filter((r) => r.predicted_plan && r.actual) as { predicted_plan: ProductionPlan; actual: ActualJob }[];
  const eqKeys = new Set<string>();
  done.forEach((r) => { r.predicted_plan.equipment.forEach((e) => eqKeys.add(e.key)); r.actual.equipment.forEach((e) => eqKeys.add(e)); });
  return {
    jobs: done.length,
    avgPredDuration: avg(done.map((r) => r.predicted_plan.durationHours)),
    avgActDuration: avg(done.map((r) => r.actual.durationHours).filter((x) => x > 0)),
    avgPredPersonHours: avg(done.map((r) => r.predicted_plan.personHours)),
    avgActPersonHours: avg(done.map((r) => actualPersonHours(r.actual)).filter((x) => x > 0)),
    commonPredGround: mode(done.map((r) => countRole(r.predicted_plan.crew, 'ground'))),
    commonActGround: mode(done.map((r) => countRole(r.actual.crew, 'ground'))),
    equipment: [...eqKeys].map((key) => ({
      key,
      predicted: done.filter((r) => r.predicted_plan.equipment.some((e) => e.key === key)).length,
      used: done.filter((r) => r.actual.equipment.includes(key)).length,
    })),
  };
}
