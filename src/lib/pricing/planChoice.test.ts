import { describe, expect, it } from 'vitest';
import { renewalText, planName } from './planChoice';

describe('signup renewal line', () => {
  it('monthly Core + Scout renews at $128/month', () =>
    expect(renewalText({ ownerScout: true, interval: 'month' })).toBe('Then $128/month.'));
  it('monthly Core renews at $79/month', () =>
    expect(renewalText({ ownerScout: false, interval: 'month' })).toBe('Then $79/month.'));
  it('annual Core + Scout is $1,248/year billed annually', () =>
    expect(renewalText({ ownerScout: true, interval: 'year' })).toBe('Then $1,248/year, billed annually.'));
  it('annual Core is $780/year billed annually', () =>
    expect(renewalText({ ownerScout: false, interval: 'year' })).toBe('Then $780/year, billed annually.'));
  it('Core alone is never named as including Scout', () =>
    expect(planName({ ownerScout: false, interval: 'month' })).toBe('Core'));
});
