import { describe, expect, it } from 'vitest';
import * as web from './giveaway';
import * as server from '../../supabase/functions/_shared/giveaway';

describe('RipSaw giveaway', () => {
  it('is open on Nov 30 at 11:30 PM Central', () => expect(server.giveawayOpen(new Date('2026-12-01T05:30:00Z'))).toBe(true));
  it('closes after Nov 30 at 11:59 PM Central', () => expect(server.giveawayOpen(new Date('2026-12-01T06:00:00Z'))).toBe(false));
  it('the server and the page use the same dates', () => {
    expect(server.GIVEAWAY_ENDS_AT).toBe(web.GIVEAWAY_ENDS_AT);
    expect(server.GIVEAWAY_STARTS_AT).toBe(web.GIVEAWAY_STARTS_AT);
    expect(server.GIVEAWAY_ID).toBe(web.GIVEAWAY_ID);
  });
  it('a card-checkout signup counts once its trial is running', () =>
    expect(server.TRIAL_STARTED_BILLING_STATUSES).toContain('trialing'));
  it('a checkout that never finished does not count', () =>
    expect(server.TRIAL_STARTED_BILLING_STATUSES).not.toContain('incomplete'));
  it('the disclosure says there is no charge during the trial and the subscription follows unless canceled', () =>
    expect(web.GIVEAWAY_DISCLOSURE).toBe('No charge during the 14-day trial. Subscription begins after the trial unless canceled.'));
});
