// The phone plan screen's states (payments milestone, Part B): owner, team member, website subscriber, a running phone
// plan here or in the other store, a blocked company, and the free trial read from each store's product.
import { describe, expect, it } from 'vitest';
import { freeTrialDays, planIsRunning, storePlanScreen } from './storePlanState';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const later = new Date(NOW + 10 * 86_400_000).toISOString();
const earlier = new Date(NOW - 86_400_000).toISOString();
const base = { isTeamMember: false, billing: undefined, storeBlocker: null, deviceStore: 'app_store' as const, now: NOW };

describe('phone plan screen', () => {
  it('an owner with no plan chooses one', () => {
    expect(storePlanScreen(base)).toEqual({ kind: 'choose' });
    expect(storePlanScreen({ ...base, billing: { pricing_version: 'legacy' } })).toEqual({ kind: 'choose' });
  });
  it('a team member is sent to the owner', () => {
    expect(storePlanScreen({ ...base, isTeamMember: true, billing: { pricing_version: '2026-10', provider: 'stripe', status: 'active', current_period_end: later } })).toEqual({ kind: 'team' });
  });
  it('a company paying on the website buys nothing here', () => {
    expect(storePlanScreen({ ...base, billing: { pricing_version: '2026-10', provider: 'stripe', status: 'active', current_period_end: later } })).toEqual({ kind: 'web' });
    expect(storePlanScreen({ ...base, billing: { pricing_version: '2026-10', provider: 'stripe', status: 'trialing', trial_ends_at: later } })).toEqual({ kind: 'web' });
  });
  it('a running phone plan is shown, managed here only on its own store', () => {
    const play = { pricing_version: '2026-10', provider: 'play_store', status: 'active', current_period_end: later };
    expect(storePlanScreen({ ...base, billing: play, deviceStore: 'play_store' })).toEqual({ kind: 'current', provider: 'play_store', here: true });
    expect(storePlanScreen({ ...base, billing: play, deviceStore: 'app_store' })).toEqual({ kind: 'current', provider: 'play_store', here: false });
  });
  it('a plan that has ended, or a website signup that never paid, can choose a phone plan', () => {
    expect(storePlanScreen({ ...base, billing: { pricing_version: '2026-10', provider: 'app_store', status: 'canceled', current_period_end: earlier } })).toEqual({ kind: 'choose' });
    expect(storePlanScreen({ ...base, billing: { pricing_version: '2026-10', provider: 'stripe', status: 'incomplete' } })).toEqual({ kind: 'choose' });
  });
  it('a company the server keeps where it is sees why, and a complimentary one sees that', () => {
    expect(storePlanScreen({ ...base, storeBlocker: 'Contact us to move your team to the new plans.' })).toEqual({ kind: 'blocked', reason: 'Contact us to move your team to the new plans.' });
    expect(storePlanScreen({ ...base, billing: { pricing_version: 'legacy', complimentary: true } })).toEqual({ kind: 'complimentary' });
  });
  it('treats a failed renewal as running, like the server', () => {
    expect(planIsRunning({ pricing_version: '2026-10', status: 'past_due' }, NOW)).toBe(true);
    expect(planIsRunning({ pricing_version: '2026-10', status: 'trialing', trial_ends_at: earlier }, NOW)).toBe(false);
  });
});

describe('free trial from the store product', () => {
  it("reads Apple's introductory offer and Google's free phase", () => {
    expect(freeTrialDays({ introPrice: { price: 0, periodNumberOfUnits: 2, periodUnit: 'WEEK' } })).toBe(14);
    expect(freeTrialDays({ introPrice: { price: 0, periodNumberOfUnits: 14, periodUnit: 'DAY' } })).toBe(14);
    expect(freeTrialDays({ defaultOption: { freePhase: { billingPeriod: { iso8601: 'P14D' } } } })).toBe(14);
    expect(freeTrialDays({ defaultOption: { freePhase: { billingPeriod: { iso8601: 'P2W' } } } })).toBe(14);
  });
  it('shows no trial when the store offers none, or a paid introductory price', () => {
    expect(freeTrialDays({ introPrice: null, defaultOption: { freePhase: null } })).toBeNull();
    expect(freeTrialDays({ introPrice: { price: 0.99, periodNumberOfUnits: 1, periodUnit: 'MONTH' } })).toBeNull();
    expect(freeTrialDays(undefined)).toBeNull();
  });
});
