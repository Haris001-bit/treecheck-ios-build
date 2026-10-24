import { CATALOG } from './catalog';

/** The plan someone picks before checkout (payments milestone): Core with or without the owner's Scout license, monthly or yearly. */
export type PlanChoice = { ownerScout: boolean; interval: 'month' | 'year' };

/** What that plan costs per interval, in cents. */
export const planPrice = (choice: PlanChoice) =>
  CATALOG.core[choice.interval] + (choice.ownerScout ? CATALOG.scout[choice.interval] : 0);
