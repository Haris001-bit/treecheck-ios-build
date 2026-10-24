import { expect, it } from 'vitest';
import { connectedPublisher, withinTrial } from '../../supabase/functions/dma-setup/rules';

it('an existing website URL is not a publishing connection', () => {
  expect(connectedPublisher('new-company', { website_url: 'https://example.com' })).toBe(false);
});
it('keeps Timber website customers on their original publishing flow', () => {
  expect(connectedPublisher('705cecc2-5926-48c1-a728-b3ebd6b920a2', null)).toBe(true);
});
it('does not enable an unconfigured tenant just because it has a publishing URL', () => {
  expect(connectedPublisher('new-company', { site_provider: 'first_impression', publish_endpoint_url: 'https://example.com/publish' })).toBe(false);
});
it('server trial access ends at exactly 14 days and does not require a post count', () => {
  const end = '2026-10-15T00:00:00Z';
  expect(withinTrial(end, Date.parse('2026-10-01T00:00:00Z'))).toBe(true);
  expect(withinTrial(end, Date.parse(end)-1)).toBe(true);
  expect(withinTrial(end, Date.parse(end))).toBe(false);
  expect(withinTrial(null)).toBe(false);
});