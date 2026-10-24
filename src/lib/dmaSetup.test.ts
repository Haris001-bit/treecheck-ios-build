import { describe, expect, it } from 'vitest';
import { dmaSetupSchema, EMPTY_VOICE, buildBrandVoice, withinDMATrial } from './dmaSetup';

const values = { company_name: 'Test Tree Company', contact_name: 'Owner', delivery_email: 'owner@example.com', service_area: 'Testville, AL', website_url: '', voice_answers: EMPTY_VOICE, voice_preview: '' };
describe('DMA company setup', () => {
  it('does not require a website or social accounts', () => expect(dmaSetupSchema.safeParse(values).success).toBe(true));
  it('rejects invalid delivery email', () => expect(dmaSetupSchema.safeParse({ ...values, delivery_email: 'not-email' }).success).toBe(false));
  it('allows at most three choices per voice question', () => expect(dmaSetupSchema.safeParse({ ...values, voice_answers: { ...EMPTY_VOICE, tone: ['a', 'b', 'c', 'd'] } }).success).toBe(false));
  it('rejects executable website URLs', () => expect(dmaSetupSchema.safeParse({ ...values, website_url: 'javascript:alert(1)' }).success).toBe(false));
  it('keeps company positioning distinct from verified claims', () => expect(buildBrandVoice({ ...EMPTY_VOICE, standards: ['Careful work'], avoid: 'fear tactics' })).toContain('Desired positioning (not verified claims): Careful work'));
  it('permits unlimited usage throughout the existing 14 day trial without a post counter', () => {
    const start = Date.parse('2026-10-01T00:00:00Z');
    const end = '2026-10-15T00:00:00Z';
    for (let post = 0; post < 100; post++) expect(withinDMATrial(end, start + post * 1000)).toBe(true);
    expect(withinDMATrial(end, start + 14 * 86400000 - 1)).toBe(true);
  });
  it('ends trial access at the existing expiry, never extending it', () => {
    expect(withinDMATrial('2026-10-15T00:00:00Z', Date.parse('2026-10-15T00:00:00Z'))).toBe(false);
    expect(withinDMATrial(null)).toBe(false);
  });
});