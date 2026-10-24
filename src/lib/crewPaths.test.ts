import { describe, expect, it } from 'vitest';
import { isCrewPath } from './crewPaths';

describe('isCrewPath', () => {
  it('allows the crew menu and the pages crew texts link to', () => {
    for (const p of ['/dashboard/crew-bids', '/dashboard/crew-bids/', '/dashboard/crew-availability', '/dashboard/ground-hours', '/dashboard/profile', '/dashboard/notifications', '/dashboard/subscription-info']) {
      expect(isCrewPath(p), p).toBe(true);
    }
  });

  it('refuses owner pages, Settings included', () => {
    for (const p of ['/dashboard', '/dashboard/', '/dashboard/settings/admin', '/dashboard/start', '/dashboard/bid-board', '/dashboard/instant-estimator', '/dashboard/team', '/dashboard/pay', '/dashboard/pulse', '/dashboard/crew-bidsx', '/dashboard/profile-x']) {
      expect(isCrewPath(p), p).toBe(false);
    }
  });
});
