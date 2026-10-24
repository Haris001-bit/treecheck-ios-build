// Free owner plan (Oklahoma companies only): what a screen shows. Pure, so the rules are tested without the server.
// The database decides the plan and counts use (free_plan_status / free_plan_claim); nothing here grants access.

export type CompanyPlan = 'paid' | 'trialing' | 'free' | 'locked' | 'none';

export interface FreePlanStatus {
  plan: CompanyPlan;
  is_owner?: boolean;
  trial_used?: boolean;
  location_set?: boolean;
  location_label?: string | null;
  eligible?: boolean;
  jobs_used?: number;
  jobs_limit?: number;
  scout_used?: number;
  scout_limit?: number;
  dma_used?: number;
  dma_limit?: number;
  locked_previews?: number;
}

export type FreeCta =
  | { kind: 'none' }
  | { kind: 'trial' | 'store_plan' | 'upgrade'; label: string };

/**
 * The one button a Free (or locked) owner gets. A trial never restarts, so after one it's an upgrade.
 * The phone apps (store builds) never show a web price or checkout: only the phone plan screen, where the App Store or
 * Google Play decides the free trial, or nothing.
 * Subcontractors and team members never get a button.
 */
export function freePlanCta(s: FreePlanStatus | null | undefined, opts: { storeBuild: boolean; storePlans: boolean }): FreeCta {
  if (!s || (s.plan !== 'free' && s.plan !== 'locked') || !s.is_owner) return { kind: 'none' };
  if (opts.storeBuild) return opts.storePlans ? { kind: 'store_plan', label: 'Choose a plan' } : { kind: 'none' };
  return s.trial_used ? { kind: 'upgrade', label: 'Upgrade to full access' } : { kind: 'trial', label: 'Start your 14-day free trial' };
}

/** "3 of 5 free jobs used this month". */
export function usageLine(used: number | undefined, limit: number | undefined, noun: string): string {
  const u = Math.max(0, Number(used) || 0), l = Math.max(0, Number(limit) || 0);
  return `${Math.min(u, l)} of ${l} free ${noun} used this month`;
}

export function atLimit(used: number | undefined, limit: number | undefined): boolean {
  return (Number(used) || 0) >= (Number(limit) || 0);
}

/** What the Free card and the trial card promise on signup and at every limit. Kept in one place. */
export const FREE_INCLUDES = [
  'Subs: find, invite and rate your subs',
  '5 jobs a month sent to subs',
  '3 Scout previews a month (estimate blurred)',
  '3 DMA previews a month (post partly hidden)',
  'No card needed',
] as const;

export const TRIAL_INCLUDES = [
  'Full Scout AI estimates',
  'Full DMA posts',
  'Unlimited jobs to subs',
  'Pulse and team seats',
] as const;
