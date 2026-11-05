import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/hooks/useEntitlements', () => ({ PRODUCT_MARKETING_URLS: { dma_web: 'https://tradesmarketing.ai/dma-web' } }));
import DMAIntro from './DMAIntro';

describe('DMAIntro', () => {
  it('shows Learn more and the copy-and-paste way, on the website and in the phone apps (Haris, 2026-11-06)', () => {
    const html = renderToStaticMarkup(<DMAIntro onCopyPaste={() => {}} />);
    expect(html).toContain('Learn more');
    expect(html).toContain('Try copy-and-paste posts');
  });
});
