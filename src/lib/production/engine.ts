/**
 * Scout Production Engine — pure, deterministic, no UI and no I/O.
 * Every screen must call this module; never re-implement estimates elsewhere.
 */
export const ENGINE_VERSION = 'prod-v1.0';

export type Source = 'known' | 'inferred' | 'hint';
export interface Fact<T> { value: T; source: Source; note?: string }

export type Access = 'easy' | 'moderate' | 'tight';
export type DropZone = 'open' | 'restricted';
export type Condition = 'healthy' | 'declining' | 'dead';
export type Rigging = 'none' | 'basic' | 'intermediate' | 'advanced';

/** Tree / job characteristics only. Climber-supplied crew or hours are deliberately not accepted. */
export interface JobCharacteristics {
  service?: string | null;
  dbhInches?: Fact<number>;
  heightFt?: Fact<number>;
  canopyDense?: Fact<boolean>;
  multipleLeaders?: Fact<boolean>;
  condition?: Fact<Condition>;
  nearStructure?: Fact<boolean>;
  access?: Fact<Access>;
  dropZone?: Fact<DropZone>;
  powerLines?: Fact<boolean>;
  rigging?: Fact<Rigging>;
  loads?: Fact<number>;
  craneIndicated?: Fact<boolean>;
  treeCount?: Fact<number>;
  stumpDiameterInches?: Fact<number> | null;
}

export type JobMethod = 'ground_felling' | 'climbing' | 'climbing_rigging' | 'bucket' | 'crane';
export const METHOD_LABELS: Record<JobMethod, string> = {
  ground_felling: 'Ground/felling removal',
  climbing: 'Climbing removal',
  climbing_rigging: 'Climbing removal with rigging',
  bucket: 'Bucket-assisted removal',
  crane: 'Crane/specialty review',
};

export interface CrewLine { roleKey: string; count: number; hours: number }
export interface EquipmentLine { key: string; hours: number }
export type Confidence = 'high' | 'medium' | 'low';

export interface ProductionPlan {
  engineVersion: string;
  method: JobMethod;
  crew: CrewLine[];
  durationHours: number;
  personHours: number;
  equipment: EquipmentLine[];
  loads: number;
  factors: string[];
  assumptions: string[];
  confidence: Confidence;
  reviewRecommended: boolean;
}

export interface CompanyCostConfig {
  laborRates: Record<string, number>;      // roleKey -> loaded hourly cost
  equipmentRates: Record<string, number>;  // equipmentKey -> hourly cost
  targetMargin: number;                    // 0..0.95
  minimumJobCharge?: number | null;
  disposalPerLoad?: number | null;
}

export interface CostBreakdown { labor: number; equipment: number; disposal: number; total: number; missingRates: string[] }
export interface PriceEvaluation { price: number; cost: number; grossProfit: number; grossMargin: number }
export interface PriceRecommendation extends PriceEvaluation { marginPrice: number; minimumApplied: boolean }
export type BallparkStatus = 'within' | 'below' | 'above' | 'none';

const r2 = (n: number) => Math.round(n * 100) / 100;
const halfHour = (n: number) => Math.max(0.5, Math.round(n * 2) / 2);
export const personHoursOf = (crew: CrewLine[]) => r2(crew.reduce((s, c) => s + c.count * c.hours, 0));

const DEFAULT_DBH = 24;

export function buildProductionPlan(job: JobCharacteristics): ProductionPlan {
  const factors: string[] = [];
  const assumptions: string[] = [];
  let uncertainty = 0;
  const weigh = (f: Fact<unknown> | undefined | null) => (!f ? 1 : f.source === 'known' ? 0 : 0.5);

  // DBH
  const dbh = job.dbhInches?.value && job.dbhInches.value > 0 ? job.dbhInches.value : DEFAULT_DBH;
  uncertainty += weigh(job.dbhInches);
  if (job.dbhInches) factors.push(`${job.dbhInches.source === 'known' ? '' : 'approximately '}${Math.round(dbh)}" DBH`);
  else assumptions.push(`DBH unknown — assumed ${DEFAULT_DBH} in`);

  // Height
  let height: number;
  if (job.heightFt?.value) {
    height = job.heightFt.value;
    factors.push(`approximately ${Math.round(height)} ft tall`);
  } else {
    height = Math.min(90, Math.max(30, Math.round(dbh * 2.2)));
    assumptions.push(`Height unknown — estimated ${height} ft from trunk size`);
  }
  uncertainty += weigh(job.heightFt);

  const dense = !!job.canopyDense?.value;
  const leaders = !!job.multipleLeaders?.value;
  const condition = job.condition?.value ?? 'healthy';
  const near = !!job.nearStructure?.value;
  const power = !!job.powerLines?.value;
  const trees = Math.max(1, Math.round(job.treeCount?.value ?? 1));
  if (dense) factors.push('dense canopy');
  if (leaders) factors.push('multiple leaders');
  if (condition !== 'healthy') factors.push(condition === 'dead' ? 'dead/hazard tree' : 'declining condition');
  if (near) factors.push('structure near work area');
  if (power) factors.push('power lines nearby');
  if (trees > 1) factors.push(`${trees} trees`);

  // Access
  let access: Access;
  if (job.access) { access = job.access.value; factors.push(`${access} access`); }
  else { access = 'moderate'; assumptions.push('Access unknown — assumed moderate'); }
  uncertainty += weigh(job.access);

  // Drop zone / rigging
  const riggingHint = job.rigging?.value;
  let drop: DropZone;
  if (job.dropZone) { drop = job.dropZone.value; if (drop === 'restricted') factors.push('restricted drop zone'); }
  else if (near || power || (riggingHint && riggingHint !== 'none')) { drop = 'restricted'; assumptions.push('Drop zone assumed restricted (targets nearby)'); }
  else { drop = 'restricted'; assumptions.push('Drop zone unknown — assumed restricted to be safe'); }
  uncertainty += job.dropZone ? weigh(job.dropZone) : job.rigging ? 0.5 : 1;
  if (riggingHint) assumptions.push(`Using ${riggingHint} rigging level as a secondary hint`);

  const crane = !!job.craneIndicated?.value;
  const needsRigging = drop === 'restricted' || near || power || (riggingHint === 'intermediate' || riggingHint === 'advanced');

  let method: JobMethod;
  if (crane) method = 'crane';
  else if (!needsRigging && height <= 40) method = 'ground_felling';
  else if (needsRigging) method = 'climbing_rigging';
  else method = 'climbing';
  if (method === 'climbing_rigging') factors.push('likely rigging');
  if (crane) factors.push('crane indicated');

  // Duration
  let hours = 1 + dbh * 0.12;
  hours *= Math.sqrt(Math.max(height, 20) / 50);
  if (dense) hours *= 1.1;
  if (leaders) hours *= 1.1;
  if (condition === 'dead') hours *= 1.15;
  if (power) hours *= 1.2;
  if (access === 'tight') hours *= 1.2; else if (access === 'moderate') hours *= 1.1;
  if (method === 'climbing_rigging') hours *= riggingHint === 'advanced' ? 1.5 : 1.35;
  if (method === 'ground_felling') hours *= 0.6;
  if (method === 'crane') hours *= 0.75;
  hours *= 1 + (trees - 1) * 0.85;
  const stumpDia = job.stumpDiameterInches?.value ?? 0;
  const stumpHours = stumpDia > 0 ? 0.5 + stumpDia * 0.03 : 0;
  if (stumpDia > 0) factors.push(`stump grinding ~${Math.round(stumpDia)}"`);
  const duration = halfHour(hours + stumpHours);

  // Loads
  let loads: number;
  if (job.loads?.value && job.loads.value > 0) {
    loads = Math.ceil(job.loads.value);
    if (job.loads.source === 'hint') assumptions.push('Debris loads taken from earlier job notes');
  } else {
    loads = Math.max(1, Math.ceil((dbh / 14) * trees));
    assumptions.push(`Debris estimated at ${loads} load${loads === 1 ? '' : 's'} from tree size`);
  }
  factors.push(`approximately ${loads} debris load${loads === 1 ? '' : 's'}`);

  // Crew
  let ground = 2;
  if (dbh >= 30 || method === 'climbing_rigging') ground += 1;
  if (method === 'crane') ground = 3;
  if (method === 'ground_felling') ground = dbh >= 24 ? 2 : 1;
  ground = Math.min(4, ground);
  const crew: CrewLine[] = method === 'ground_felling'
    ? [{ roleKey: 'crew_lead', count: 1, hours: duration }, { roleKey: 'ground', count: ground, hours: duration }]
    : [{ roleKey: 'climber', count: 1, hours: duration }, { roleKey: 'ground', count: ground, hours: duration }];

  // Equipment
  const equipment: EquipmentLine[] = [
    { key: 'chipper', hours: duration },
    { key: 'chip_truck', hours: duration },
  ];
  if (dbh >= 20 && access !== 'tight') equipment.push({ key: 'mini_skid', hours: duration });
  if (stumpDia > 0) equipment.push({ key: 'stump_grinder', hours: halfHour(stumpHours) });
  if (crane) equipment.push({ key: 'crane', hours: halfHour(Math.min(duration, 4)) });

  const confidence: Confidence = uncertainty >= 2 ? 'low' : uncertainty >= 1 ? 'medium' : 'high';
  return {
    engineVersion: ENGINE_VERSION,
    method, crew, durationHours: duration, personHours: personHoursOf(crew),
    equipment, loads, factors, assumptions, confidence, reviewRecommended: confidence === 'low',
  };
}

export function computeCost(plan: Pick<ProductionPlan, 'crew' | 'equipment' | 'loads'>, cfg: CompanyCostConfig): CostBreakdown {
  const missing: string[] = [];
  let labor = 0;
  for (const c of plan.crew) {
    const rate = cfg.laborRates[c.roleKey];
    if (rate == null) missing.push(c.roleKey);
    labor += c.count * c.hours * (rate ?? 0);
  }
  let equipment = 0;
  for (const e of plan.equipment) {
    const rate = cfg.equipmentRates[e.key];
    if (rate == null) missing.push(e.key);
    equipment += e.hours * (rate ?? 0);
  }
  const disposal = (cfg.disposalPerLoad ?? 0) * plan.loads;
  return { labor: r2(labor), equipment: r2(equipment), disposal: r2(disposal), total: r2(labor + equipment + disposal), missingRates: missing };
}

export function evaluatePrice(price: number, cost: number): PriceEvaluation {
  const grossProfit = r2(price - cost);
  return { price: r2(price), cost: r2(cost), grossProfit, grossMargin: price > 0 ? grossProfit / price : 0 };
}

/** Gross-margin pricing: price = cost / (1 - margin). Never cost × (1 + margin). */
export function recommendPrice(cost: number, cfg: Pick<CompanyCostConfig, 'targetMargin' | 'minimumJobCharge'>): PriceRecommendation {
  const m = Math.min(0.95, Math.max(0, cfg.targetMargin));
  const marginPrice = Math.round(cost / (1 - m));
  const min = cfg.minimumJobCharge ?? 0;
  const minimumApplied = min > marginPrice;
  const price = minimumApplied ? min : marginPrice;
  return { ...evaluatePrice(price, cost), marginPrice, minimumApplied };
}

export function ballparkStatus(price: number, min?: number | null, max?: number | null): BallparkStatus {
  if (min == null && max == null) return 'none';
  const lo = min ?? max!; const hi = max ?? min!;
  if (price < lo) return 'below';
  if (price > hi) return 'above';
  return 'within';
}
