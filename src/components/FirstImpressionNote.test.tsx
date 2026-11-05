import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { FirstImpressionNote } from './DMAEmailPosts';

describe('First Impression reminder', () => {
  it('links to the demo page, on the website and in the phone apps (Haris, 2026-11-06)', () => {
    const html = renderToStaticMarkup(<FirstImpressionNote />);
    expect(html).toContain('automatically and instantly');
    expect(html).toContain('href="https://tradesmarketing.ai/dma-web"');
  });
});
