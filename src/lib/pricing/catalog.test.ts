import { describe, it, expect } from 'vitest';
import { quote, requiredSeat, fitsSeat, annualMonthlyEquivalent, NO_PERMISSIONS, CompanyPlan, CATALOG } from './catalog';

const base: CompanyPlan = { ownerScout: false, scoutSeats: 0, managerSeats: 0, fieldUsers: 0, dma: 'none' };
const t = (p: Partial<CompanyPlan>) => [quote({ ...base, ...p }, 'month').total, quote({ ...base, ...p }, 'year').total];

describe('acceptance totals', () => {
  it('Core only', () => expect(t({})).toEqual([7900, 78000]));
  it('Core + 1 Scout', () => expect(t({ ownerScout: true })).toEqual([12800, 124800]));
  it('Core + 1 Manager', () => expect(t({ managerSeats: 1 })).toEqual([10800, 106800]));
  it('Core + 3 Field users total', () => expect(t({ fieldUsers: 3 })).toEqual([9100, 90000]));
  it('Core + 2 Scout + 2 Field + DMA', () => expect(t({ scoutSeats: 2, fieldUsers: 2, dma: 'paid' })).toEqual([27600, 266400]));
});

describe('recommended starting package', () => {
  it('Core + 1 Scout is exactly Core plus one Scout seat, no extra charge', () =>
    expect(quote({ ...base, ownerScout: true }, 'month').total).toBe(CATALOG.core.month + CATALOG.scout.month));
  it('recommended annual total is $1,248 and markets at $104/month equivalent', () => {
    const year = quote({ ...base, ownerScout: true }, 'year').total;
    expect(year).toBe(CATALOG.core.year + CATALOG.scout.year);
    expect(Math.floor(year / 12 / 100)).toBe(104);
  });
  it('Core-only stays available at $79/month and $780/year', () => expect(t({})).toEqual([7900, 78000]));
});

describe('rules', () => {
  it('website DMA adds no charge', () => expect(t({ dma: 'website' })).toEqual([7900, 78000]));
  it('Scout + manager permissions = one Scout seat', () =>
    expect(requiredSeat({ ...NO_PERMISSIONS, createScout: true, manageJobsSubs: true })).toBe('scout'));
  it('capture-only needs no seat', () => expect(requiredSeat({ ...NO_PERMISSIONS, dmaSubmit: true })).toBeNull());
  it('Pulse alone needs no seat', () => expect(requiredSeat({ ...NO_PERMISSIONS, viewPulse: true })).toBeNull());
  it('narrowing a Scout seat to field work fits (no billing change)', () =>
    expect(fitsSeat('scout', { ...NO_PERMISSIONS, assignedJobs: true })).toBe(true));
  it('field seat cannot create Scout estimates', () =>
    expect(fitsSeat('field', { ...NO_PERMISSIONS, createScout: true })).toBe(false));
  it('annual monthly equivalents', () =>
    expect(['core', 'scout', 'manager', 'field', 'dma'].map((k) => annualMonthlyEquivalent(k as never))).toEqual([65, 39, 24, 10, 79]));
});
