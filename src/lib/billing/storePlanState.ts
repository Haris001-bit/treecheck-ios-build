// What the phone plan screen shows (payments milestone, Part B), from the company billing row, whether the company
// may take a phone plan (company-billing's storeBlocker) and which store this phone uses. Pure, so it is tested.

export type StoreProviderId = 'app_store' | 'play_store';

export type StorePlanBilling = {
  pricing_version?: string;
  provider?: string;
  status?: string;
  complimentary?: boolean;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
};

export type StorePlanScreen =
  | { kind: 'team' }
  | { kind: 'complimentary' }
  // A website plan is running: nothing to buy in the app.
  | { kind: 'web' }
  // A phone plan is running; `here` when it's this phone's store, so Manage and Restore apply.
  | { kind: 'current'; provider: StoreProviderId; here: boolean }
  | { kind: 'blocked'; reason: string }
  | { kind: 'choose' };

/** Whether the row's plan still gives access, the same rule as the server's planRunning (_shared/storePlans.ts). */
export function planIsRunning(b: StorePlanBilling | null | undefined, now: number): boolean {
  if (!b || b.pricing_version !== '2026-10') return false;
  if (b.status === 'trialing') return !!b.trial_ends_at && Date.parse(b.trial_ends_at) > now;
  if (b.status === 'active') return !!b.current_period_end && Date.parse(b.current_period_end) > now;
  return b.status === 'past_due';
}

export function storePlanScreen(input: {
  isTeamMember: boolean;
  billing: StorePlanBilling | null | undefined;
  storeBlocker: string | null | undefined;
  deviceStore: StoreProviderId;
  now: number;
}): StorePlanScreen {
  const { billing: b } = input;
  if (input.isTeamMember) return { kind: 'team' };
  if (b?.complimentary) return { kind: 'complimentary' };
  if (planIsRunning(b, input.now)) {
    if (b?.provider === 'app_store' || b?.provider === 'play_store') return { kind: 'current', provider: b.provider, here: b.provider === input.deviceStore };
    return { kind: 'web' };
  }
  // On the plans with nothing running (a plan that ended, or a signup that never paid): a phone plan takes it over.
  if (b?.pricing_version === '2026-10') return { kind: 'choose' };
  return input.storeBlocker ? { kind: 'blocked', reason: input.storeBlocker } : { kind: 'choose' };
}

/** Days of free trial a store product offers new subscribers, from RevenueCat's product (iOS intro price, Android free phase). */
export function freeTrialDays(product: {
  introPrice?: { price?: number; periodNumberOfUnits?: number; periodUnit?: string } | null;
  defaultOption?: { freePhase?: { billingPeriod?: { iso8601?: string } | null } | null } | null;
} | null | undefined): number | null {
  const intro = product?.introPrice;
  if (intro && intro.price === 0 && intro.periodNumberOfUnits) {
    const unit = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 }[String(intro.periodUnit ?? '').toUpperCase()];
    return unit ? unit * intro.periodNumberOfUnits : null;
  }
  const iso = product?.defaultOption?.freePhase?.billingPeriod?.iso8601;
  const m = iso?.match(/^P(\d+)([DWMY])$/);
  return m ? Number(m[1]) * { D: 1, W: 7, M: 30, Y: 365 }[m[2] as 'D' | 'W' | 'M' | 'Y'] : null;
}
