import { CATALOG, formatCents } from './catalog';

/** The plan someone picks before checkout (payments milestone): Core with or without the owner's Scout license, monthly or yearly. */
export type PlanChoice = { ownerScout: boolean; interval: 'month' | 'year' };

/** What that plan costs per interval, in cents. */
export const planPrice = (choice: PlanChoice) =>
  CATALOG.core[choice.interval] + (choice.ownerScout ? CATALOG.scout[choice.interval] : 0);

/** The plan's name as the signup screen shows it. */
export const planName = (choice: PlanChoice) => (choice.ownerScout ? 'Core + Scout' : 'Core');

/** What the chosen plan renews at after the trial, built from the same price checkout charges. */
export const renewalText = (choice: PlanChoice) =>
  choice.interval === 'year'
    ? `Then ${formatCents(planPrice(choice))}/year, billed annually.`
    : `Then ${formatCents(planPrice(choice))}/month.`;
