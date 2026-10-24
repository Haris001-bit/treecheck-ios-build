/**
 * Bridges a stored bid request to the deterministic pricing engine.
 * The job's cost inputs live in `bid_requests.pricing_inputs` (jsonb);
 * anything missing falls back to the central pricingConfig defaults.
 */
import { pricingConfig, type PricingInput } from './bidPricing.ts';

export interface StoredPricingInputs {
  crewSize?: number | null;
  jobHours?: number | null;
  totalLaborHours?: number | null;
  laborRate?: number | null;
  laborFlat?: number | null;
  disposalLoads?: number | null;
  disposalRate?: number | null;
  disposalFlat?: number | null;
  equipmentCost?: number | null;
  /** Mini skid steer cost per hour (owner-adjustable). */
  miniSkidRate?: number | null;
  stumpCost?: number | null;
  travelCost?: number | null;
  otherCosts?: number | null;
  fixedDollar?: number | null;
  fixedPercent?: number | null;
  estimatorDollar?: number | null;
  estimatorPercent?: number | null;
  crewShare?: number | null;
  ownerMinimum?: number | null;
  ownerMinimumEnabled?: boolean | null;
}

export const emptyPricingInputs = (): StoredPricingInputs => ({
  crewSize: null,
  jobHours: null,
  laborRate: pricingConfig.laborRateDefault,
  disposalLoads: null,
  disposalRate: pricingConfig.disposalRateDefault,
  equipmentCost: 0,
  miniSkidRate: 100,
  stumpCost: 0,
  travelCost: 0,
  otherCosts: 0,
  fixedDollar: pricingConfig.fixedDollarDefault,
  fixedPercent: pricingConfig.fixedPercentDefault,
  estimatorDollar: pricingConfig.estimatorDollarDefault,
  estimatorPercent: pricingConfig.estimatorPercentDefault,
  crewShare: pricingConfig.crewShareDefault,
  ownerMinimum: pricingConfig.ownerMinimumDefault,
  ownerMinimumEnabled: true,
});

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Build the engine input for one bid (or for a known sale price). */
export function toPricingInput(
  stored: StoredPricingInputs | null | undefined,
  extra: {
    crewMinimum?: number | null;
    crewIdeal?: number | null;
    salePrice?: number | null;
    /** Pay already committed to the other role (e.g. the awarded ground crew). */
    committedCrewPay?: number;
    /** Legacy per-job lump-sum cost from before the calculator existed. */
    legacyOwnerCost?: number;
  } = {},
): PricingInput {
  const s = stored ?? {};
  const other =
    (n(s.otherCosts) ?? 0) + (extra.committedCrewPay ?? 0) + (extra.legacyOwnerCost ?? 0);
  return {
    salePrice: extra.salePrice ?? null,
    crewMinimum: extra.crewMinimum ?? null,
    crewIdeal: extra.crewIdeal ?? null,
    crewSize: n(s.crewSize),
    jobHours: n(s.jobHours),
    totalLaborHours: n(s.totalLaborHours),
    laborRate: n(s.laborRate) ?? pricingConfig.laborRateDefault,
    laborFlat: n(s.laborFlat),
    disposalLoads: n(s.disposalLoads),
    disposalRate: n(s.disposalRate) ?? pricingConfig.disposalRateDefault,
    disposalFlat: n(s.disposalFlat),
    equipmentCosts: n(s.equipmentCost) ? [{ name: 'Mini skid steer', cost: n(s.equipmentCost)! }] : [],
    stumpCost: n(s.stumpCost),
    travelCost: n(s.travelCost),
    otherCosts: other,
    fixedDollar: n(s.fixedDollar) ?? pricingConfig.fixedDollarDefault,
    fixedPercent: n(s.fixedPercent) ?? pricingConfig.fixedPercentDefault,
    estimatorDollar: n(s.estimatorDollar) ?? pricingConfig.estimatorDollarDefault,
    estimatorPercent: n(s.estimatorPercent) ?? pricingConfig.estimatorPercentDefault,
    crewShare: n(s.crewShare) ?? pricingConfig.crewShareDefault,
    ownerMinimum: n(s.ownerMinimum) ?? pricingConfig.ownerMinimumDefault,
    ownerMinimumEnabled: s.ownerMinimumEnabled !== false,
  };
}

/** Mini skid steer default charged to the job per hour (owner can change it per job). */
export const MINI_SKID_RATE = 100;

/** Folds a climber offer's own answers (disposal loads, mini skid steer) into the job's pricing inputs. */
export function withBidExtras(
  stored: StoredPricingInputs | null | undefined,
  bid: { est_disposal_loads?: number | null; ground_crew_size?: number | null; est_hours?: number | null; crew_size?: number | null; needs_mini_skid?: boolean | null; mini_skid_hours?: number | null } | null | undefined,
): StoredPricingInputs {
  const out: StoredPricingInputs = { ...(stored ?? {}) } as StoredPricingInputs;
  if (!bid) return out;
  if (out.disposalLoads == null && bid.est_disposal_loads != null) out.disposalLoads = Number(bid.est_disposal_loads);
  // Ground crew the climber asked for: ground crew × job length × labor rate.
  // The climber's own answer wins over any guess saved on the job.
  const g = Number(bid.ground_crew_size);
  if (out.totalLaborHours == null && out.laborFlat == null && bid.ground_crew_size != null && g >= 0) {
    const hrs = Number(bid.est_hours) || 0;
    out.crewSize = g;
    if (hrs > 0) out.jobHours = hrs;
  }
  // Mini skid steer runs the whole job: hours always match the offer's job length.
  const hrs = Number(bid.mini_skid_hours) > 0 ? Number(bid.mini_skid_hours) : Number(bid.est_hours);
  if (bid.needs_mini_skid && hrs > 0) {
    out.equipmentCost = (Number((out as any).equipmentCost) || 0) + hrs * (n(out.miniSkidRate) ?? MINI_SKID_RATE);
  }
  return out;
}
