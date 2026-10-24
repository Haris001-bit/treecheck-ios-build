// Canonical TreeCheck app pricing for NEW customers (pricing version 2026-10).
// Amounts are integer cents. Legacy $50/$35/$9 pricing lives in src/lib/plans.ts
// and src/lib/subscriptions.ts and is kept only for existing customers.

export type BillingInterval = 'month' | 'year';
export type SeatType = 'scout' | 'manager' | 'field';
export type ProductKey = 'core' | SeatType | 'dma';

export const PRICING_VERSION = '2026-10';
export const LEGACY_PRICING_VERSION = 'legacy';

export const CATALOG: Record<ProductKey, { label: string; month: number; year: number }> = {
  core: { label: 'TreeCheck Core', month: 7900, year: 78000 },
  scout: { label: 'Scout estimator seat', month: 4900, year: 46800 },
  manager: { label: 'Manager/Admin seat', month: 2900, year: 28800 },
  field: { label: 'Field/Job seat', month: 1200, year: 12000 },
  dma: { label: 'Digital Marketing Agent', month: 9900, year: 94800 },
};

export const CORE_INCLUDED_FIELD_SEATS = 2;
export const DMA_CAPTURE_CONTRIBUTORS = 10;

/** Monthly equivalent of an annual price, in whole dollars as marketed. */
export function annualMonthlyEquivalent(key: ProductKey): number {
  return Math.floor(CATALOG[key].year / 12 / 100);
}

export interface Permissions {
  assignedJobs: boolean;
  manageJobsSubs: boolean;
  createScout: boolean;
  reviewEstimates: boolean;
  dmaSubmit: boolean;
  dmaManage: boolean;
  operationalSettings: boolean;
  viewPulse: boolean; // owner-granted only; never implies a seat
}

export const NO_PERMISSIONS: Permissions = {
  assignedJobs: false, manageJobsSubs: false, createScout: false, reviewEstimates: false,
  dmaSubmit: false, dmaManage: false, operationalSettings: false, viewPulse: false,
};

export const PRESETS: Record<string, { label: string; permissions: Permissions }> = {
  office_manager: { label: 'Office Manager', permissions: { ...NO_PERMISSIONS, assignedJobs: true, manageJobsSubs: true, reviewEstimates: true, operationalSettings: true } },
  scout_rep: { label: 'Scout / Sales Rep', permissions: { ...NO_PERMISSIONS, assignedJobs: true, createScout: true, reviewEstimates: true } },
  field_crew: { label: 'Field / Crew', permissions: { ...NO_PERMISSIONS, assignedJobs: true } },
  marketing_capture: { label: 'Marketing Capture', permissions: { ...NO_PERMISSIONS, dmaSubmit: true } },
  sub_guest: { label: 'Subcontractor Guest', permissions: { ...NO_PERMISSIONS, assignedJobs: true } },
};

/** Seat a teammate needs; null = no paid seat (capture-only). One seat per person. */
export function requiredSeat(p: Permissions): SeatType | null {
  if (p.createScout) return 'scout';
  if (p.manageJobsSubs || p.reviewEstimates || p.operationalSettings || p.dmaManage) return 'manager';
  if (p.assignedJobs) return 'field';
  return null;
}

const SEAT_RANK: Record<SeatType, number> = { field: 1, manager: 2, scout: 3 };
/** True when a permission set fits within an existing seat (no billing change). */
export function fitsSeat(seat: SeatType, p: Permissions): boolean {
  const need = requiredSeat(p);
  return need === null || SEAT_RANK[need] <= SEAT_RANK[seat];
}

export interface CompanyPlan {
  ownerScout: boolean; // owner holds a Scout license
  scoutSeats: number; // teammates
  managerSeats: number;
  fieldUsers: number; // teammates on Field seats (2 included)
  dma: 'none' | 'paid' | 'website';
}

export interface QuoteLine { key: ProductKey; quantity: number; unit: number; total: number }

export function quote(plan: CompanyPlan, interval: BillingInterval) {
  const lines: QuoteLine[] = [];
  const add = (key: ProductKey, quantity: number) => {
    if (quantity <= 0) return;
    const unit = CATALOG[key][interval];
    lines.push({ key, quantity, unit, total: unit * quantity });
  };
  add('core', 1);
  add('scout', plan.scoutSeats + (plan.ownerScout ? 1 : 0));
  add('manager', plan.managerSeats);
  add('field', Math.max(0, plan.fieldUsers - CORE_INCLUDED_FIELD_SEATS));
  if (plan.dma === 'paid') add('dma', 1);
  return { lines, total: lines.reduce((s, l) => s + l.total, 0) };
}

export function formatCents(c: number): string {
  const d = c / 100;
  return `$${d.toLocaleString('en-US', { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
