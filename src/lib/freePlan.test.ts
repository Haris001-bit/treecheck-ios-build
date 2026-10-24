import { describe, expect, it } from 'vitest';
import { atLimit, freePlanCta, usageLine, type FreePlanStatus } from './freePlan';

const free = (over: Partial<FreePlanStatus> = {}): FreePlanStatus => ({ plan: 'free', is_owner: true, trial_used: false, ...over });
const web = { storeBuild: false, storePlans: false };

describe('Free plan prompt', () => {
  it('prompts a Free owner who never had a trial to start the 14-day trial', () => {
    expect(freePlanCta(free(), web)).toEqual({ kind: 'trial', label: 'Start your 14-day free trial' });
  });
  it('never offers a second trial: after one it is an upgrade', () => {
    expect(freePlanCta(free({ trial_used: true }), web).kind).toBe('upgrade');
  });
  it('subcontractor accounts never get a trial or upgrade prompt', () => {
    expect(freePlanCta({ plan: 'none', is_owner: false }, web).kind).toBe('none');
  });
  it('team members of a Free company never get a prompt', () => {
    expect(freePlanCta(free({ is_owner: false }), web).kind).toBe('none');
  });
  it('paid and trialing companies get no prompt', () => {
    expect(freePlanCta(free({ plan: 'paid' }), web).kind).toBe('none');
    expect(freePlanCta(free({ plan: 'trialing' }), web).kind).toBe('none');
  });
  it('the phone apps show no web checkout: the phone plan screen, or nothing without store plans', () => {
    expect(freePlanCta(free(), { storeBuild: true, storePlans: true })).toEqual({ kind: 'store_plan', label: 'Choose a plan' });
    // The App Store or Google Play decides the free trial, so a used TreeCheck trial still gets the plan screen.
    expect(freePlanCta(free({ trial_used: true }), { storeBuild: true, storePlans: true }).kind).toBe('store_plan');
    expect(freePlanCta(free(), { storeBuild: true, storePlans: false }).kind).toBe('none');
    expect(freePlanCta(free({ is_owner: false }), { storeBuild: true, storePlans: true }).kind).toBe('none');
  });
});

describe('Free plan monthly counter', () => {
  it('shows 5 jobs a month', () => {
    expect(usageLine(3, 5, 'jobs')).toBe('3 of 5 free jobs used this month');
  });
  it('is at the limit on the 5th job, so the 6th is stopped', () => {
    expect(atLimit(4, 5)).toBe(false);
    expect(atLimit(5, 5)).toBe(true);
  });
});
