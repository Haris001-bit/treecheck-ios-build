/**
 * Large-company setup: internal costs, margin and commission basis, kept apart from the customer price (only cost
 * viewers see them). Built on Mark's computeCost; cost-plus selling rates use his margin math: cost / (1 - margin).
 * Pure.
 */
import { computeCost, type CompanyCostConfig, type EquipmentLine } from './engine';
import type { Policies } from './rules';
import type { ProductionEstimate } from './productionRules';
import { r2 } from './answers';

export type EquipmentUnit = 'hour' | 'each' | 'job';
export interface CostConfig extends CompanyCostConfig {
  /** production_equipment.unit per key; hour when missing. Materials and vendor fees are 'each' or 'job'. */
  equipmentUnits?: Record<string, EquipmentUnit>;
  /** Resources the company gets from an outside vendor (crane, grapple truck): costed as vendor, not equipment. */
  vendorKeys?: string[];
}

export interface DerivedRates { roles: Record<string, number>; equipment: Record<string, number>; disposalPerLoad?: number }

/** Selling rates frozen into a cost-plus rate card at publish: loaded cost / (1 - target margin). */
export function deriveCostPlusRates(cfg: CompanyCostConfig): DerivedRates {
  const m = Math.min(0.95, Math.max(0, cfg.targetMargin ?? 0));
  const sell = (c: number) => r2(c / (1 - m));
  const roles: Record<string, number> = {};
  const equipment: Record<string, number> = {};
  for (const [k, v] of Object.entries(cfg.laborRates ?? {})) roles[k] = sell(Number(v) || 0);
  for (const [k, v] of Object.entries(cfg.equipmentRates ?? {})) equipment[k] = sell(Number(v) || 0);
  const out: DerivedRates = { roles, equipment };
  if (cfg.disposalPerLoad) out.disposalPerLoad = sell(cfg.disposalPerLoad);
  return out;
}

export interface ItemCost {
  labor: number; equipment: number; materials: number; vendor: number; disposal: number; total: number;
  missingRates: string[];
  /** Cost per resource key, for the commission basis. */
  byResource: Record<string, number>;
}

const unitHours = (cfg: CostConfig, key: string, hours: number) => {
  const u = cfg.equipmentUnits?.[key] ?? 'hour';
  return u === 'hour' ? hours : 1;
};

export function costWorkItem(p: ProductionEstimate, cfg: CostConfig): ItemCost {
  const vendor = new Set(cfg.vendorKeys ?? []);
  const own: EquipmentLine[] = [];
  const ven: EquipmentLine[] = [];
  for (const e of p.equipment) (vendor.has(e.key) ? ven : own).push({ key: e.key, hours: unitHours(cfg, e.key, e.hours) });
  const mats: EquipmentLine[] = p.materials.map((m) => ({ key: m.key, hours: m.quantity }));
  const labor = computeCost({ crew: p.crew, equipment: [], loads: p.loads }, cfg);
  const eq = computeCost({ crew: [], equipment: own, loads: 0 }, cfg);
  const vd = computeCost({ crew: [], equipment: ven, loads: 0 }, cfg);
  const mt = computeCost({ crew: [], equipment: mats, loads: 0 }, cfg);
  const byResource: Record<string, number> = {};
  for (const e of [...own, ...ven, ...mats]) {
    const rate = cfg.equipmentRates[e.key];
    if (rate !== undefined) byResource[e.key] = r2((byResource[e.key] ?? 0) + e.hours * rate);
  }
  const total = r2(labor.labor + labor.disposal + eq.equipment + vd.equipment + mt.equipment);
  return {
    labor: labor.labor, equipment: eq.equipment, materials: mt.equipment, vendor: vd.equipment, disposal: labor.disposal, total,
    missingRates: [...new Set([...labor.missingRates, ...eq.missingRates, ...vd.missingRates, ...mt.missingRates])],
    byResource,
  };
}

export interface CostLine { id: string; price: number; production: ProductionEstimate; counts: boolean }
export interface EstimateCost {
  items: { id: string; cost: ItemCost; price: number; grossProfit: number; margin: number; commissionBasis: number }[];
  totals: { price: number; cost: number; grossProfit: number; margin: number; commissionBasis: number; commission: number | null };
}

/**
 * Costs for an estimate. Commission basis = price, less the cost of resources the company excludes (vendor pass-through
 * such as crane or grapple truck), less fixed deductions when those resources are on the job.
 */
export function costEstimate(lines: CostLine[], cfg: CostConfig, commission: Policies['commission'] | undefined): EstimateCost {
  const excluded = new Set(commission?.excludedResources ?? []);
  const items = lines.map((l) => {
    const cost = costWorkItem(l.production, cfg);
    let basis = l.price;
    for (const [k, v] of Object.entries(cost.byResource)) if (excluded.has(k)) basis -= v;
    for (const d of commission?.deductions ?? []) if (l.production.equipment.some((e) => e.key === d.resource)) basis -= d.amount;
    const grossProfit = r2(l.price - cost.total);
    return { id: l.id, cost, price: l.price, grossProfit, margin: l.price > 0 ? r2(grossProfit / l.price) : 0, commissionBasis: r2(Math.max(0, basis)) };
  });
  const counted = items.filter((_, i) => lines[i].counts);
  const price = r2(counted.reduce((s, i) => s + i.price, 0));
  const cost = r2(counted.reduce((s, i) => s + i.cost.total, 0));
  const commissionBasis = r2(counted.reduce((s, i) => s + i.commissionBasis, 0));
  const grossProfit = r2(price - cost);
  return {
    items,
    totals: {
      price, cost, grossProfit, margin: price > 0 ? r2(grossProfit / price) : 0, commissionBasis,
      commission: commission?.rate !== undefined ? r2(commissionBasis * commission.rate) : null,
    },
  };
}
