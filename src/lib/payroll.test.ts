import { describe, it, expect } from 'vitest';
import { climberPayFromQuote, groundPay, weekStartChicago, addDays } from './payroll';

describe('climberPayFromQuote', () => {
  it('pays min at or below the min quote', () => {
    expect(climberPayFromQuote(1000, 1400, 1000, 300, 400)).toBe(300);
    expect(climberPayFromQuote(1000, 1400, 800, 300, 400)).toBe(300);
  });
  it('pays ideal at or above the ideal quote', () => {
    expect(climberPayFromQuote(1000, 1400, 1400, 300, 400)).toBe(400);
    expect(climberPayFromQuote(1000, 1400, 2000, 300, 400)).toBe(400);
  });
  it('interpolates in between', () => {
    expect(climberPayFromQuote(1000, 1400, 1200, 300, 400)).toBe(350);
    expect(climberPayFromQuote(1000, 1400, 1100, 300, 400)).toBe(325);
  });
  it('handles same min and ideal', () => {
    expect(climberPayFromQuote(1000, 1000, 1500, 300, 300)).toBe(300);
  });
});

describe('groundPay', () => {
  it('half-day minimum at $25', () => {
    expect(groundPay(2)).toBe(100);
    expect(groundPay(6)).toBe(150);
  });
  it('uses a day rate', () => expect(groundPay(3, 200, 'day')).toBe(200));
  it('uses a job hourly rate', () => expect(groundPay(5, 30, 'hourly')).toBe(150));
  it('zero hours pays nothing', () => expect(groundPay(0)).toBe(0));
});

describe('weeks', () => {
  it('finds Monday', () => {
    expect(weekStartChicago(new Date('2026-10-14T16:00:00Z'))).toBe('2026-10-12');
    expect(weekStartChicago(new Date('2026-10-12T04:00:00Z'))).toBe('2026-10-05');
  });
  it('adds days', () => expect(addDays('2026-10-12', -7)).toBe('2026-10-05'));
});

import { groundPay as gp } from './payroll';
import { rateValue } from './groundRate';
describe('worker hourly rate', () => {
  it('$35/hr worker on a 2h job gets the 4h minimum: $140', () => expect(gp(2, null, null, 35)).toBe(140));
  it('standard worker stays at $100 minimum', () => expect(gp(2, null, null, null)).toBe(100));
  it('day rate on the call-out wins', () => expect(gp(8, 220, 'day', 35)).toBe(220));
  it('rate input rejects over $200 and blank means standard', () => {
    expect(rateValue('250')).toBeUndefined();
    expect(rateValue('')).toBeNull();
  });
});
