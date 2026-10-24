/**
 * Kostner Tree Job Bid Calculator — deterministic pricing engine.
 *
 * SINGLE SOURCE OF TRUTH for every sale price the app shows or sends to the CRM.
 * Pure arithmetic: no AI, no rounding until presentation / constraint-safe final sale.
 * Percentages are stored internally as decimals (40% = 0.40).
 *
 * Keep this file in sync with supabase/functions/_shared/bidPricing.ts
 * (identical logic, Deno copy for edge functions).
 */

export const pricingConfig = {
  fixedDollarDefault: 300,
  fixedPercentDefault: 0,
  crewShareDefault: 0.4, // "Kostner share" — the contract climber's share of net
  estimatorDollarDefault: 0,
  estimatorPercentDefault: 0,
  laborRateDefault: 25,
  disposalRateDefault: 80,
  ownerMinimumDefault: 0.3,
  markupOptions: [0.1, 0.15] as const,
};

export interface EquipmentItem {
  name: string;
  cost: number;
}

export interface PricingInput {
  /** Forward mode when set: a known customer sale price. */
  salePrice?: number | null;

  /** Reverse mode targets — what the contract climber wants to be paid. */
  crewMinimum?: number | null;
  crewIdeal?: number | null;

  /** Climber's share of net, as a decimal (0.40 = 40%). */
  crewShare?: number;

  /** Grounds labor. Provide either crewSize+jobHours, or totalLaborHours (already man-hours). */
  crewSize?: number | null;
  jobHours?: number | null;
  totalLaborHours?: number | null;
  laborRate?: number;
  /** Flat grounds-labor dollars, overrides the hourly calculation when set. */
  laborFlat?: number | null;

  disposalLoads?: number | null;
  disposalRate?: number;
  /** Flat disposal dollars, overrides loads x rate when set. */
  disposalFlat?: number | null;

  equipmentCosts?: EquipmentItem[];
  stumpCost?: number | null;
  travelCost?: number | null;
  otherCosts?: number | null;

  fixedDollar?: number | null;
  fixedPercent?: number | null;

  estimatorDollar?: number | null;
  estimatorPercent?: number | null;

  ownerMinimum?: number | null;
  ownerMinimumEnabled?: boolean;

  markup10Enabled?: boolean;
  markup15Enabled?: boolean;
}

export interface NormalizedCosts {
  fixedDollar: number;
  fixedPercent: number;
  estimatorDollar: number;
  estimatorPercent: number;
  grounds: number;
  disposal: number;
  equipment: number;
  stump: number;
  travel: number;
  other: number;
  /** grounds + disposal + equipment + stump + travel + other (NOT fixed / estimator). */
  otherDollarCosts: number;
  crewShare: number;
  ownerMinimum: number;
  ownerMinimumEnabled: boolean;
}

export interface SaleBreakdown {
  sale: number;
  percentageCosts: number;
  dollarCosts: number;
  totalCosts: number;
  net: number;
  /** Estimator fee actually charged at this sale (dollar + percent portion). */
  estimator: number;
  fixed: number;
  crew: number;
  owner: number;
  ownerPercent: number;
}

export interface ReverseResult {
  feasible: boolean;
  target: number;
  requiredNet: number;
  sale: number;
  breakdown: SaleBreakdown | null;
  reason?: string;
}

export interface PricingResult {
  mode: 'forward' | 'reverse' | 'insufficient';
  enteredSale: number | null;
  /** Sale required to hit the owner minimum in forward mode (null when no adjustment happened). */
  adjustedBaseSale: number | null;
  minimumSaleFloor: number | null;
  baseSale: number | null;
  plus10Sale: number | null;
  plus15Sale: number | null;
  rounded25Quote: number | null;
  rounded50Quote: number | null;
  costs: {
    fixed: number;
    grounds: number;
    disposal: number;
    equipment: number;
    stump: number;
    travel: number;
    other: number;
    estimator: number;
  };
  baseBreakdown: SaleBreakdown | null;
  plus10Breakdown: SaleBreakdown | null;
  plus15Breakdown: SaleBreakdown | null;
  ownerMinimum: {
    enabled: boolean;
    requiredPercent: number;
    passes: boolean;
    actualPercent: number | null;
    shortfallPercent: number | null;
    shortfallDollars: number | null;
  };
  warnings: string[];
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Section 26 — cost normalization. */
export function normalizeCosts(input: PricingInput): NormalizedCosts {
  const laborRate = input.laborRate == null ? pricingConfig.laborRateDefault : num(input.laborRate);
  const disposalRate =
    input.disposalRate == null ? pricingConfig.disposalRateDefault : num(input.disposalRate);

  let grounds: number;
  if (input.laborFlat != null && Number.isFinite(Number(input.laborFlat))) {
    grounds = num(input.laborFlat);
  } else if (input.totalLaborHours != null && Number.isFinite(Number(input.totalLaborHours))) {
    // Already man-hours — do NOT multiply by crew size again (section 4).
    grounds = num(input.totalLaborHours) * laborRate;
  } else {
    grounds = num(input.crewSize) * num(input.jobHours) * laborRate;
  }

  const disposal =
    input.disposalFlat != null && Number.isFinite(Number(input.disposalFlat))
      ? num(input.disposalFlat)
      : num(input.disposalLoads) * disposalRate;

  const equipment = (input.equipmentCosts ?? []).reduce((sum, e) => sum + num(e?.cost), 0);
  const stump = num(input.stumpCost);
  const travel = num(input.travelCost);
  const other = num(input.otherCosts);

  return {
    fixedDollar:
      input.fixedDollar == null ? pricingConfig.fixedDollarDefault : num(input.fixedDollar),
    fixedPercent:
      input.fixedPercent == null ? pricingConfig.fixedPercentDefault : num(input.fixedPercent),
    estimatorDollar:
      input.estimatorDollar == null
        ? pricingConfig.estimatorDollarDefault
        : num(input.estimatorDollar),
    estimatorPercent:
      input.estimatorPercent == null
        ? pricingConfig.estimatorPercentDefault
        : num(input.estimatorPercent),
    grounds,
    disposal,
    equipment,
    stump,
    travel,
    other,
    otherDollarCosts: grounds + disposal + equipment + stump + travel + other,
    crewShare: input.crewShare == null ? pricingConfig.crewShareDefault : num(input.crewShare),
    ownerMinimum:
      input.ownerMinimum == null ? pricingConfig.ownerMinimumDefault : num(input.ownerMinimum),
    ownerMinimumEnabled: input.ownerMinimumEnabled !== false,
  };
}

/** Section 27 — what everyone receives at a known sale price. */
export function calculateAtSale(sale: number, c: NormalizedCosts, crewCap?: number | null): SaleBreakdown {
  const fixed = c.fixedDollar + sale * c.fixedPercent;
  const estimator = c.estimatorDollar + sale * c.estimatorPercent;
  const percentageCosts = sale * c.fixedPercent + sale * c.estimatorPercent;
  const dollarCosts = c.fixedDollar + c.estimatorDollar + c.otherDollarCosts;
  const totalCosts = percentageCosts + dollarCosts;
  const net = sale - totalCosts;
  const shareCrew = net * c.crewShare;
  // In reverse mode the climber is paid exactly what he asked for; any price
  // raise to protect the owner minimum goes to the owner, not the climber.
  const crew = crewCap != null && crewCap > 0 ? Math.min(shareCrew, crewCap) : shareCrew;
  const owner = net - crew;
  return {
    sale,
    percentageCosts,
    dollarCosts,
    totalCosts,
    net,
    estimator,
    fixed,
    crew,
    owner,
    ownerPercent: sale > 0 ? owner / sale : 0,
  };
}

/**
 * Section 21 — round to whole dollars without breaking the constraint that
 * produced the number. Steps up $1 at a time (bounded) until `ok` holds.
 */
function constraintSafeDollarRound(raw: number, ok: (sale: number) => boolean): number {
  let sale = Math.round(raw);
  for (let i = 0; i < 100 && !ok(sale); i++) sale += 1;
  return sale;
}

/** Section 28 — reverse pricing from the climber's requested payout. */
export function reversePrice(target: number, c: NormalizedCosts): ReverseResult {
  const share = c.crewShare;
  if (!(share > 0)) {
    return {
      feasible: false,
      target,
      requiredNet: 0,
      sale: 0,
      breakdown: null,
      reason: 'The climber share must be greater than zero to work backwards from a payout.',
    };
  }
  const requiredNet = target / share;
  const denominator = 1 - c.fixedPercent - c.estimatorPercent;
  if (denominator <= 0) {
    return {
      feasible: false,
      target,
      requiredNet,
      sale: 0,
      breakdown: null,
      reason:
        'Pricing configuration is infeasible because percentage-based costs consume 100% or more of the sale price.',
    };
  }
  const rawSale = (requiredNet + c.fixedDollar + c.estimatorDollar + c.otherDollarCosts) / denominator;
  // Rounding must never leave the climber short of the payout he asked for.
  const sale = constraintSafeDollarRound(
    rawSale,
    (s) => calculateAtSale(s, c).crew >= target - 1e-9,
  );
  return { feasible: true, target, requiredNet, sale, breakdown: calculateAtSale(sale, c) };
}

/** Sections 17 / 30 — smallest sale price that satisfies the owner minimum. */
export function ownerMinimumSale(c: NormalizedCosts): { feasible: boolean; sale: number } {
  const oneMinusK = 1 - c.crewShare;
  const numerator = oneMinusK * (c.fixedDollar + c.estimatorDollar + c.otherDollarCosts);
  const denominator = oneMinusK * (1 - c.fixedPercent - c.estimatorPercent) - c.ownerMinimum;
  if (denominator <= 0) return { feasible: false, sale: 0 };
  const raw = numerator / denominator;
  const sale = constraintSafeDollarRound(
    raw,
    (s) => calculateAtSale(s, c).ownerPercent >= c.ownerMinimum - 1e-9,
  );
  return { feasible: true, sale };
}

/** Section 22 — quote-friendly numbers that never dip below the base sale. */
function safeRoundedQuote(base: number, increment: number): number {
  let q = Math.round(base / increment) * increment;
  while (q < base) q += increment;
  return q;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const c = normalizeCosts(input);
  const warnings: string[] = [];

  const costsOut = {
    fixed: c.fixedDollar,
    grounds: c.grounds,
    disposal: c.disposal,
    equipment: c.equipment,
    stump: c.stump,
    travel: c.travel,
    other: c.other,
    estimator: c.estimatorDollar,
  };

  const empty = (mode: PricingResult['mode']): PricingResult => ({
    mode,
    enteredSale: input.salePrice ?? null,
    adjustedBaseSale: null,
    minimumSaleFloor: null,
    baseSale: null,
    plus10Sale: null,
    plus15Sale: null,
    rounded25Quote: null,
    rounded50Quote: null,
    costs: costsOut,
    baseBreakdown: null,
    plus10Breakdown: null,
    plus15Breakdown: null,
    ownerMinimum: {
      enabled: c.ownerMinimumEnabled,
      requiredPercent: c.ownerMinimum,
      passes: false,
      actualPercent: null,
      shortfallPercent: null,
      shortfallDollars: null,
    },
    warnings,
  });

  const hasSale = input.salePrice != null && Number(input.salePrice) > 0;
  const hasTarget =
    (input.crewMinimum != null && Number(input.crewMinimum) > 0) ||
    (input.crewIdeal != null && Number(input.crewIdeal) > 0);

  // ---- Section 31: mode selection (never mix the two) ----
  if (!hasSale && !hasTarget) {
    warnings.push('Insufficient pricing data: enter a sale price, or the climber’s payout.');
    return empty('insufficient');
  }

  let mode: 'forward' | 'reverse';
  let baseSale: number | null = null;
  let minimumSaleFloor: number | null = null;
  let adjustedBaseSale: number | null = null;
  let crewCap: number | null = null;

  if (hasSale) {
    mode = 'forward';
    const entered = num(input.salePrice);
    const enteredResult = calculateAtSale(entered, c);
    if (!c.ownerMinimumEnabled || enteredResult.ownerPercent >= c.ownerMinimum - 1e-9) {
      baseSale = Math.round(entered);
    } else {
      const req = ownerMinimumSale(c);
      if (!req.feasible) {
        warnings.push('Owner minimum cannot be met under current settings.');
        return empty('forward');
      }
      baseSale = req.sale;
      adjustedBaseSale = req.sale;
      warnings.push(
        `Sale raised from $${Math.round(entered).toLocaleString()} to $${req.sale.toLocaleString()} to meet the ${Math.round(
          c.ownerMinimum * 100,
        )}% owner minimum.`,
      );
    }
  } else {
    mode = 'reverse';
    const minTarget = num(input.crewMinimum);
    const idealTarget = num(input.crewIdeal);

    const minResult = minTarget > 0 ? reversePrice(minTarget, c) : null;
    const idealResult = idealTarget > 0 ? reversePrice(idealTarget, c) : null;

    const infeasible = [minResult, idealResult].find((r) => r && !r.feasible);
    if (infeasible) {
      warnings.push(infeasible.reason!);
      return empty('reverse');
    }

    minimumSaleFloor = minResult ? minResult.sale : null;
    baseSale = idealResult ? idealResult.sale : minResult!.sale;
    if (minimumSaleFloor == null) minimumSaleFloor = baseSale;

    // The climber's payout is fixed at what he asked for (ideal, else minimum).
    crewCap = idealTarget > 0 ? idealTarget : minTarget;

    // Never quote below the owner minimum: raise the price automatically,
    // keeping the climber's payout unchanged so the extra goes to the owner.
    if (c.ownerMinimumEnabled) {
      const denom = 1 - c.fixedPercent - c.estimatorPercent - c.ownerMinimum;
      if (denom > 0) {
        const dollarCosts = c.fixedDollar + c.estimatorDollar + c.otherDollarCosts;
        const reqFor = (t: number) =>
          constraintSafeDollarRound(
            (dollarCosts + t) / denom,
            (s) => calculateAtSale(s, c, t).ownerPercent >= c.ownerMinimum - 1e-9,
          );
        const reqBase = reqFor(crewCap);
        if (baseSale! < reqBase) {
          adjustedBaseSale = reqBase;
          baseSale = reqBase;
        }
        if (minTarget > 0) {
          const reqMin = reqFor(minTarget);
          if (minimumSaleFloor! < reqMin) minimumSaleFloor = reqMin;
        }
      }
    }
  }

  const baseBreakdown = calculateAtSale(baseSale!, c, crewCap);

  // ---- Section 19 / 16: owner minimum status ----
  const passes =
    !c.ownerMinimumEnabled || baseBreakdown.ownerPercent >= c.ownerMinimum - 1e-9;
  let shortfallPercent: number | null = null;
  let shortfallDollars: number | null = null;
  if (c.ownerMinimumEnabled && !passes) {
    shortfallPercent = c.ownerMinimum - baseBreakdown.ownerPercent;
    shortfallDollars = baseSale! * c.ownerMinimum - baseBreakdown.owner;
    if (mode === 'reverse') {
      warnings.push(
        'Owner minimum cannot be met with the current reverse-pricing configuration. Review the climber share, percentage-based expenses, fixed expenses, job costs, or the climber’s target payout.',
      );
    }
  }

  // ---- Section 23: negative profit ----
  if (baseBreakdown.net < 0) {
    warnings.push('This job configuration would lose money.');
  }

  // ---- Section 20: +10% / +15%, fully recalculated at the new sale ----
  const plus10Sale =
    input.markup10Enabled === false ? null : Math.round(baseSale! * 1.1);
  const plus15Sale =
    input.markup15Enabled === false ? null : Math.round(baseSale! * 1.15);

  return {
    mode,
    enteredSale: hasSale ? Math.round(num(input.salePrice)) : null,
    adjustedBaseSale,
    minimumSaleFloor,
    baseSale,
    plus10Sale,
    plus15Sale,
    rounded25Quote: safeRoundedQuote(baseSale!, 25),
    rounded50Quote: safeRoundedQuote(baseSale!, 50),
    costs: costsOut,
    baseBreakdown,
    plus10Breakdown: plus10Sale == null ? null : calculateAtSale(plus10Sale, c, crewCap),
    plus15Breakdown: plus15Sale == null ? null : calculateAtSale(plus15Sale, c, crewCap),
    ownerMinimum: {
      enabled: c.ownerMinimumEnabled,
      requiredPercent: c.ownerMinimum,
      passes,
      actualPercent: baseBreakdown.ownerPercent,
      shortfallPercent,
      shortfallDollars,
    },
    warnings,
  };
}

export const money = (v: number | null | undefined) =>
  v == null || Number.isNaN(Number(v)) ? '—' : `$${Math.round(Number(v)).toLocaleString()}`;

export const pct = (v: number | null | undefined) =>
  v == null || Number.isNaN(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(1)}%`;
