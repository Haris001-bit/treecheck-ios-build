import { describe, expect, it } from 'vitest';
import * as web from './consent';
import * as server from '../../supabase/functions/_shared/consent';

describe('signup permission', () => {
  it('records nothing when the answers are missing', () => expect(server.parseConsent(undefined)).toBeNull());
  it('keeps marketing optional: account yes, marketing no is a valid answer', () =>
    expect(server.parseConsent({ version: web.CONSENT_VERSION, account: true, marketing: false })).toEqual({ account: true, marketing: false }));
  it('the server stores the same wording the sign-up page shows', () => {
    expect(server.CONSENT_VERSION).toBe(web.CONSENT_VERSION);
    expect(server.ACCOUNT_CONSENT_TEXT).toBe(web.ACCOUNT_CONSENT_TEXT);
    expect(server.MARKETING_CONSENT_TEXT).toBe(web.MARKETING_CONSENT_TEXT);
  });
  it('marketing wording says it is not required to sign up', () =>
    expect(web.MARKETING_CONSENT_TEXT).toContain('not required to sign up'));
});
