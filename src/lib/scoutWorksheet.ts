/**
 * Scout Estimator Worksheet — pure reverse-engineer pricing logic.
 *
 * The estimator enters what the company PAYS (climber payout, ground crew
 * man-hours, crane, mini skid, chipper, dump fees, stump grinding) and the
 * worksheet works BACKWARD to a homeowner price that hits the company's
 * target profit. No AI involved.
 *
 * price = totalCost ÷ (1 − targetProfit%)
 *
 * Shared by the capture form and the review screen so every surface produces
 * an identical number.
 */

export interface ScoutRateCard {
  /** What you pay per person per hour on the ground crew. */
  labor_rate: number;
  /** What you pay the crane per hour. */
  crane_hourly: number;
  crane_mobilization_fee: number;
  /** What you pay for the mini skid steer per hour (or per day). */
  mini_skid_rate: number;
  mini_skid_rate_type: 'day' | 'hour' | string;
  /** Chipper / chip truck, billed per day or per hour on site. */
  chipper_rate: number;
  chipper_rate_type: 'day' | 'hour' | string;
  /** Dump fee per load of debris. */
  disposal_per_load: number;
  /** What the stump grinder sub charges: base price up to N inches, then per inch. */
  stump_base_price: number;
  stump_base_inches: number;
  stump_per_inch: number;
  /** Average overhead amount per job (insurance, admin, fuel, marketing). */
  overhead_per_job: number;
  /** Desired profit as a share of the sale (30 = keep 30% of the price). */
  target_profit_pct: number;
  minimum_job_price: number;
}

export const DEFAULT_RATE_CARD: ScoutRateCard = {
  labor_rate: 25,
  crane_hourly: 350,
  crane_mobilization_fee: 0,
  mini_skid_rate: 100,
  mini_skid_rate_type: 'hour',
  chipper_rate: 0,
  chipper_rate_type: 'day',
  disposal_per_load: 150,
  stump_base_price: 250,
  stump_base_inches: 12,
  stump_per_inch: 7,
  overhead_per_job: 0,
  target_profit_pct: 30,
  minimum_job_price: 0,
};

export interface WorksheetInputs {
  /** What the climber gets paid for the job (part of the cost). */
  climberPayout: number | null;
  groundCrew: number | null;
  hours: number | null;
  loads: number | null;
  craneRequired: boolean;
  craneHours: number | null;
  chipper?: boolean;
  miniSkid?: boolean;
  stump: boolean;
  stumpDiameterInches: number | null;
  extrasAmount: number | null;
  extrasNote?: string | null;
}

export const EMPTY_WORKSHEET: WorksheetInputs = {
  climberPayout: null,
  groundCrew: null,
  hours: null,
  loads: null,
  craneRequired: false,
  craneHours: null,
  chipper: false,
  miniSkid: false,
  stump: false,
  stumpDiameterInches: null,
  extrasAmount: null,
  extrasNote: null,
};

export interface WorksheetLine {
  label: string;
  detail?: string;
  amount: number;
}

export interface WorksheetResult {
  lines: WorksheetLine[];
  /** Total of everything you pay (direct costs). */
  subtotal: number;
  /** Homeowner price after the target profit is added (never below the minimum). */
  total: number;
  /** Profit dollars built into `total`. */
  profit: number;
  profitPct: number;
  hasInput: boolean;
}

const n = (v: number | null | undefined) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
const round = (v: number) => Math.round(v * 100) / 100;

/** True when the estimator actually filled something in worth pricing. */
export function worksheetHasInput(w: WorksheetInputs): boolean {
  return (
    n(w.climberPayout) > 0 ||
    (n(w.hours) > 0 && (n(w.groundCrew) > 0 || w.craneRequired || !!w.miniSkid || !!w.chipper)) ||
    n(w.loads) > 0 ||
    (w.craneRequired && n(w.craneHours) > 0) ||
    (w.stump && n(w.stumpDiameterInches) > 0) ||
    n(w.extrasAmount) > 0
  );
}

export function calculateWorksheet(w: WorksheetInputs, rates: ScoutRateCard): WorksheetResult {
  const lines: WorksheetLine[] = [];
  const hours = n(w.hours);

  // Climber payout — what the climber gets paid for the job.
  if (n(w.climberPayout) > 0) {
    lines.push({ label: 'Climber payout', amount: n(w.climberPayout) });
  }

  // Ground crew man-hours
  const crew = n(w.groundCrew);
  if (hours > 0 && crew > 0) {
    const amt = hours * crew * n(rates.labor_rate);
    lines.push({
      label: 'Ground crew',
      detail: `${crew} × ${hours} hr × $${n(rates.labor_rate)}/hr`,
      amount: amt,
    });
  }

  // Crane
  if (w.craneRequired) {
    const ch = n(w.craneHours);
    if (ch > 0) {
      lines.push({ label: 'Crane', detail: `${ch} hr × $${n(rates.crane_hourly)}/hr`, amount: ch * n(rates.crane_hourly) });
    }
    if (n(rates.crane_mobilization_fee) > 0) {
      lines.push({ label: 'Crane mobilization', amount: n(rates.crane_mobilization_fee) });
    }
  }

  // Mini skid steer — runs with the job hours (or flat per day)
  if (w.miniSkid && n(rates.mini_skid_rate) > 0) {
    const perHour = rates.mini_skid_rate_type !== 'day';
    const amt = perHour ? n(rates.mini_skid_rate) * hours : n(rates.mini_skid_rate);
    if (amt > 0) {
      lines.push({
        label: 'Mini skid steer',
        detail: perHour ? `${hours} hr × $${n(rates.mini_skid_rate)}/hr` : `$${n(rates.mini_skid_rate)} per day`,
        amount: amt,
      });
    }
  }

  // Chipper / chip truck
  if (w.chipper && n(rates.chipper_rate) > 0) {
    const perHour = rates.chipper_rate_type === 'hour';
    const amt = perHour ? n(rates.chipper_rate) * hours : n(rates.chipper_rate);
    if (amt > 0) {
      lines.push({
        label: 'Chipper / chip truck',
        detail: perHour ? `${hours} hr × $${n(rates.chipper_rate)}/hr` : `$${n(rates.chipper_rate)} per day`,
        amount: amt,
      });
    }
  }

  // Disposal (dump fees)
  const loads = n(w.loads);
  if (loads > 0) {
    lines.push({ label: 'Disposal', detail: `${loads} load${loads === 1 ? '' : 's'} × $${n(rates.disposal_per_load)}`, amount: loads * n(rates.disposal_per_load) });
  }

  // Stump grinding (what the stump grinder sub charges)
  if (w.stump) {
    const dia = n(w.stumpDiameterInches);
    const baseIn = n(rates.stump_base_inches);
    const extraIn = Math.max(0, dia - baseIn);
    const amt = n(rates.stump_base_price) + extraIn * n(rates.stump_per_inch);
    lines.push({
      label: 'Stump grinding',
      detail: dia > 0
        ? `$${n(rates.stump_base_price)} up to ${baseIn}" + ${extraIn.toFixed(1)}" × $${n(rates.stump_per_inch)}`
        : `$${n(rates.stump_base_price)} base`,
      amount: amt,
    });
  }

  // Extras
  if (n(w.extrasAmount) > 0) {
    lines.push({ label: w.extrasNote?.trim() || 'Extras', amount: n(w.extrasAmount) });
  }

  // Overhead — your average cost per job to cover the business (insurance,
  // admin, fuel, marketing). Added once to every priced job.
  if (lines.length > 0 && n(rates.overhead_per_job) > 0) {
    lines.push({ label: 'Overhead', detail: 'average per job', amount: n(rates.overhead_per_job) });
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);

  // Reverse-engineer the homeowner price so the target profit is a share of the sale:
  // price = cost ÷ (1 − profit%).
  const profitPct = Math.min(95, Math.max(0, n(rates.target_profit_pct)));
  let total = subtotal;
  if (subtotal > 0 && profitPct > 0 && profitPct < 100) {
    total = subtotal / (1 - profitPct / 100);
  }
  if (n(rates.minimum_job_price) > 0 && total > 0 && total < n(rates.minimum_job_price)) {
    total = n(rates.minimum_job_price);
  }
  const profit = total - subtotal;

  return {
    lines: lines.map((l) => ({ ...l, amount: round(l.amount) })),
    subtotal: round(subtotal),
    total: round(total),
    profit: round(profit),
    profitPct,
    hasInput: worksheetHasInput(w),
  };
}

/** Short human summary, e.g. "climber $800 · 5 hrs · 2 crew · 2 loads · crane 3 hr · mini skid · stump 18"" */
export function worksheetSummary(w: WorksheetInputs): string {
  const parts: string[] = [];
  if (n(w.climberPayout) > 0) parts.push(`climber $${n(w.climberPayout)}`);
  if (n(w.hours) > 0) parts.push(`${n(w.hours)} hrs`);
  if (n(w.groundCrew) > 0) parts.push(`${n(w.groundCrew)} crew`);
  if (n(w.loads) > 0) parts.push(`${n(w.loads)} loads`);
  if (w.craneRequired && n(w.craneHours) > 0) parts.push(`crane ${n(w.craneHours)} hr`);
  if (w.miniSkid) parts.push('mini skid');
  if (w.chipper) parts.push('chipper');
  if (w.stump && n(w.stumpDiameterInches) > 0) parts.push(`stump ${n(w.stumpDiameterInches)}"`);
  return parts.join(' · ');
}

/* ---------- row <-> inputs mapping (scout_captures columns) ---------- */

export interface WorksheetRow {
  wk_climber_payout?: number | null;
  wk_ground_crew?: number | null;
  wk_hours?: number | null;
  wk_loads?: number | null;
  wk_crane_required?: boolean | null;
  wk_crane_hours?: number | null;
  wk_chipper?: boolean | null;
  wk_mini_skid?: boolean | null;
  wk_stump?: boolean | null;
  wk_stump_diameter_inches?: number | null;
  wk_extras_amount?: number | null;
  wk_extras_note?: string | null;
  wk_total?: number | null;
}

export function worksheetFromRow(row: WorksheetRow | null | undefined): WorksheetInputs {
  if (!row) return { ...EMPTY_WORKSHEET };
  return {
    climberPayout: row.wk_climber_payout ?? null,
    groundCrew: row.wk_ground_crew ?? null,
    hours: row.wk_hours ?? null,
    loads: row.wk_loads ?? null,
    craneRequired: !!row.wk_crane_required,
    craneHours: row.wk_crane_hours ?? null,
    chipper: !!row.wk_chipper,
    miniSkid: !!row.wk_mini_skid,
    stump: !!row.wk_stump,
    stumpDiameterInches: row.wk_stump_diameter_inches ?? null,
    extrasAmount: row.wk_extras_amount ?? null,
    extrasNote: row.wk_extras_note ?? null,
  };
}

export function worksheetToRow(w: WorksheetInputs, result: WorksheetResult) {
  return {
    wk_climber_payout: w.climberPayout,
    wk_ground_crew: w.groundCrew,
    wk_hours: w.hours,
    wk_loads: w.loads,
    wk_crane_required: w.craneRequired,
    wk_crane_hours: w.craneHours,
    wk_chipper: !!w.chipper,
    wk_mini_skid: !!w.miniSkid,
    wk_stump: w.stump,
    wk_stump_diameter_inches: w.stumpDiameterInches,
    wk_extras_amount: w.extrasAmount,
    wk_extras_note: w.extrasNote?.trim() || null,
    wk_total: result.hasInput ? result.total : null,
    wk_breakdown: result.hasInput
      ? ([...result.lines, { label: `Target profit (${result.profitPct}%)`, amount: result.profit }] as unknown as Record<string, unknown>[])
      : null,
  };
}
