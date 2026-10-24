export const OWNER_PLAN = { name: 'Scout', baseMonthly: 50, extraSeatMonthly: 35, trialDays: 14 } as const;
export const CREW_PLAN = { trialDays: 14, radiusMiles: 30 } as const;
export const CREW_TRADES = [
  { value: 'climber', label: 'Climber' },
  { value: 'ground', label: 'Ground worker' },
  { value: 'stump', label: 'Stump grinder' },
  { value: 'crane', label: 'Crane operator' },
  { value: 'both', label: 'Climber and ground worker' },
] as const;
/** Subcontractors never pay: membership is always free. */
export function crewMonthlyPrice(_companyCount: number) {
  return 0;
}
