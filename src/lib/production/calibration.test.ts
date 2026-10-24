import { describe, it, expect } from 'vitest';
import { seedConfirmed, toJobCharacteristics, verdict, summarize, emptyAi, actualPersonHours } from './calibration';
import { buildProductionPlan } from './engine';

describe('calibration', () => {
  it('keeps unknown AI fields unknown and marks owner edits known', () => {
    const ai = emptyAi();
    ai.dbh_inches = { value: 28, confidence: 'medium' };
    ai.height_ft = { value: 50, confidence: 'unknown' };
    const c = seedConfirmed(ai);
    expect(c.height_ft.source).toBe('unknown');
    expect(c.height_ft.value).toBeNull();
    c.access = { value: 'tight', source: 'owner', aiConfidence: 'unknown' };
    const j = toJobCharacteristics(c);
    expect(j.dbhInches?.source).toBe('inferred');
    expect(j.heightFt).toBeUndefined();
    expect(j.access?.source).toBe('known');
  });
  it('low AI confidence becomes a hint', () => {
    const ai = emptyAi(); ai.dbh_inches = { value: 20, confidence: 'low' };
    expect(toJobCharacteristics(seedConfirmed(ai)).dbhInches?.source).toBe('hint');
  });
  it('verdict and summary', () => {
    const p = buildProductionPlan({ dbhInches: { value: 28, source: 'known' } });
    const actual = { method: p.method, crew: [{ roleKey: 'climber', count: 1 }, { roleKey: 'ground', count: 3 }], durationHours: p.durationHours * 2, equipment: ['chipper'], loads: 2 };
    expect(verdict(p, actual)).toMatch(/underestimated/);
    expect(actualPersonHours(actual)).toBeGreaterThan(p.personHours);
    const s = summarize([{ predicted_plan: p, actual }]);
    expect(s.jobs).toBe(1);
    expect(s.commonActGround).toBe(3);
    expect(s.equipment.find((e) => e.key === 'chipper')?.used).toBe(1);
  });
});
