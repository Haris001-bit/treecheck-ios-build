import { describe, it, expect } from 'vitest';
import { availableCapacity, captureSlotsRemaining, checkoutTrialEnd, paidQuantities, remainingTrialEnd, validateAssignment } from './lifecycle';
import { NO_PERMISSIONS } from './catalog';

describe('company seat lifecycle rules', () => {
  it('two field seats are included, managers do not consume them', () => expect(paidQuantities({ scout: 2, manager: 1, field: 2 }, false)).toEqual({ scout: 2, manager: 1, field: 0 }));
  it('owner estimating adds one Scout and never a Manager seat', () => expect(paidQuantities({ scout: 0, manager: 0, field: 2 }, true)).toEqual({ scout: 1, manager: 0, field: 0 }));
  it('removed members release prepaid capacity for reassignment', () => expect(availableCapacity({ scout: 1, manager: 0, field: 2 }, [{ seat: 'scout', kind: 'employee', active: false, permissions: NO_PERMISSIONS }]).scout).toBe(1));
  it('pending invitations reserve paid capacity before acceptance', () => expect(availableCapacity({ scout: 1, manager: 0, field: 2 }, [{ seat: 'scout', kind: 'employee', active: true, permissions: NO_PERMISSIONS }]).scout).toBe(0));
  it('capture-only contributors cannot receive Pulse access', () => expect(() => validateAssignment({ seat: null, kind: 'capture', active: true, permissions: { ...NO_PERMISSIONS, dmaSubmit: true, viewPulse: true } })).toThrow());
  it('subcontractors cannot receive Scout or office access', () => expect(() => validateAssignment({ seat: null, kind: 'subcontractor', active: true, permissions: { ...NO_PERMISSIONS, createScout: true } })).toThrow());
  it('a Scout with manager permissions occupies only one seat', () => expect(() => validateAssignment({ seat: 'scout', kind: 'employee', active: true, permissions: { ...NO_PERMISSIONS, createScout: true, operationalSettings: true } })).not.toThrow());
  it('ten capture contributors are included, paid teammates do not count', () => expect(captureSlotsRemaining([{ seat: 'manager', kind: 'employee', active: true, permissions: NO_PERMISSIONS }])).toBe(10));
  it('conversion uses original trial end, never another fourteen days', () => expect(remainingTrialEnd('2026-10-31T12:00:00Z', Date.parse('2026-10-20T12:00:00Z'))).toBe(Date.parse('2026-10-31T12:00:00Z') / 1000));
  it('an expired trial cannot start another Stripe trial', () => expect(remainingTrialEnd('2026-10-17T12:00:00Z', Date.parse('2026-10-20T12:00:00Z'))).toBeNull());
});

describe('checkout trial end (Stripe needs at least 48 hours)', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('keeps the original end when more than 49 hours remain', () => expect(checkoutTrialEnd('2026-10-31T12:00:00Z', now)).toBe(Date.parse('2026-10-31T12:00:00Z') / 1000));
  it('moves a trial ending within 48 hours to 49 hours from now', () => expect(checkoutTrialEnd('2026-10-21T00:00:00Z', now)).toBe(now / 1000 + 49 * 3600));
  it('gives an ended trial no trial at all', () => expect(checkoutTrialEnd('2026-10-19T12:00:00Z', now)).toBeNull());
  it('gives no trial without a trial date', () => expect(checkoutTrialEnd(null, now)).toBeNull());
});
