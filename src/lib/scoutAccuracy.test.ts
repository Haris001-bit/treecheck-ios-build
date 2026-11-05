import { describe, it, expect } from 'vitest';
import { isScoutHit } from './scoutAccuracy';

describe('Scout accuracy hit rule', () => {
  it('counts a sold price inside the range as a hit', () => {
    expect(isScoutHit(2000, 3000, 2400)).toBe(true);
  });
  it('counts 14% off the middle as a hit', () => {
    expect(isScoutHit(1000, 1000, 1000 / 1.14)).toBe(true);
  });
  it('counts 16% off the middle as a miss', () => {
    expect(isScoutHit(1160, 1160, 1000)).toBe(false);
  });
});
