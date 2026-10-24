import { describe, expect, it } from 'vitest';
import { seedConfirmed, type CharKey, type ConfirmedCharacteristics } from '@/lib/production/calibration';
import { clampTyped, firstOutOfRange, inRange, JOB_HOURS_LIMIT } from './inputLimits';

const confirmed = (values: Partial<Record<CharKey, number>>): ConfirmedCharacteristics => {
  const c = seedConfirmed(null);
  for (const [k, v] of Object.entries(values) as [CharKey, number][]) c[k] = { ...c[k], value: v, source: 'owner' };
  return c;
};

describe('firstOutOfRange', () => {
  it('accepts a normal job and blanks', () => {
    expect(firstOutOfRange(confirmed({ dbh_inches: 30, height_ft: 60, loads: 3, tree_count: 1 }))).toBeNull();
    expect(firstOutOfRange(seedConfirmed(null))).toBeNull();
  });

  it('catches the values the signup test saved', () => {
    expect(firstOutOfRange(confirmed({ dbh_inches: 99999 }))).toBe('dbh_inches');
    expect(firstOutOfRange(confirmed({ height_ft: -40 }))).toBe('height_ft');
    expect(firstOutOfRange(confirmed({ loads: -3 }))).toBe('loads');
    expect(firstOutOfRange(confirmed({ tree_count: 0 }))).toBe('tree_count');
  });

  it('refuses a number that is not finite', () => {
    expect(firstOutOfRange(confirmed({ dbh_inches: Number.NaN }))).toBe('dbh_inches');
  });
});

describe('job hours', () => {
  it('needs a positive, plausible duration', () => {
    expect(inRange(6, JOB_HOURS_LIMIT)).toBe(true);
    expect(inRange(-5, JOB_HOURS_LIMIT)).toBe(false);
    expect(inRange(0, JOB_HOURS_LIMIT)).toBe(false);
    expect(inRange(1000, JOB_HOURS_LIMIT)).toBe(false);
  });
});

describe('clampTyped', () => {
  it('keeps typed costs and percentages at zero or above, and under the cap', () => {
    expect(clampTyped('-50')).toBe(0);
    expect(clampTyped('')).toBe(0);
    expect(clampTyped('45.5')).toBe(45.5);
    expect(clampTyped('-20', 90)).toBe(0);
    expect(clampTyped('150', 90)).toBe(90);
    expect(clampTyped('1e999')).toBe(0);
  });
});
