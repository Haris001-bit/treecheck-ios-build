import { describe, expect, it } from 'vitest';
import { hasWorkedTogether, isNewNetworkResult, matchesCrewTrade } from './crewLists';
describe('sub lists', () => {
  it('includes marked outside work, not mere invitations', () => {
    expect(hasWorkedTogether({ id: 'one', worked_together_before: true }, new Set())).toBe(true);
    expect(hasWorkedTogether({ id: 'one', worked_together_before: false }, new Set())).toBe(false);
  });
  it('includes completed hires without requiring ratings', () => {
    expect(hasWorkedTogether({ id: 'hired' }, new Set(['hired']))).toBe(true);
    expect(hasWorkedTogether({ id: 'invited' }, new Set(['hired']))).toBe(false);
  });
  it('deduplicates connected subs regardless of sharing', () => {
    expect(isNewNetworkResult('mine', [{ user_id: 'mine' }])).toBe(false);
    expect(isNewNetworkResult('other', [{ user_id: 'mine' }])).toBe(true);
  });
  it('includes both-trade subs correctly', () => {
    expect(matchesCrewTrade('both', 'ground')).toBe(true);
    expect(matchesCrewTrade('both', 'climber')).toBe(true);
    expect(matchesCrewTrade('both', 'stump')).toBe(false);
    expect(matchesCrewTrade('pending', 'all')).toBe(true);
  });
});
