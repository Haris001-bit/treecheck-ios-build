import { afterEach, describe, expect, it } from 'vitest';
import { clearOnboardingDraft, readOnboardingDraft, writeOnboardingDraft } from './onboardingDraft';

const USER = 'user-1';

afterEach(() => sessionStorage.clear());

describe('onboarding draft', () => {
  it('returns the same question and answers after a reload', () => {
    writeOnboardingDraft(USER, { step: 3, s: { operating_model: 'employees' }, costs: { laborRate: 45 }, calibrated: true });
    expect(readOnboardingDraft(USER)).toEqual({ step: 3, s: { operating_model: 'employees' }, costs: { laborRate: 45 }, calibrated: true });
  });

  it('keeps nothing on question 1', () => {
    writeOnboardingDraft(USER, { step: 2, s: { a: 1 }, costs: null, calibrated: false });
    writeOnboardingDraft(USER, { step: 0, s: { a: 1 }, costs: null, calibrated: false });
    expect(readOnboardingDraft(USER)).toBeNull();
  });

  it('is per user, and cleared on Finish', () => {
    writeOnboardingDraft(USER, { step: 2, s: { a: 1 }, costs: null, calibrated: false });
    expect(readOnboardingDraft('someone-else')).toBeNull();
    clearOnboardingDraft(USER);
    expect(readOnboardingDraft(USER)).toBeNull();
  });

  it('ignores a malformed draft', () => {
    sessionStorage.setItem(`onboarding-draft:${USER}`, '{not json');
    expect(readOnboardingDraft(USER)).toBeNull();
    sessionStorage.setItem(`onboarding-draft:${USER}`, JSON.stringify({ step: 'two', s: {} }));
    expect(readOnboardingDraft(USER)).toBeNull();
  });

  it('does nothing without a signed-in user', () => {
    writeOnboardingDraft(undefined, { step: 2, s: {}, costs: null, calibrated: false });
    expect(sessionStorage.length).toBe(0);
    expect(readOnboardingDraft(undefined)).toBeNull();
  });
});
