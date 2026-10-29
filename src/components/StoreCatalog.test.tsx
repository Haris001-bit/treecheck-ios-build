// The phone apps' first-screen plans (Mark, 2026-10-29: "just like the website"): the store's own prices and trial,
// fetched live, never the website's Stripe prices. Rendered with React's own renderer; the store hook is a stand-in.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pkg = (identifier: string, productId: string, priceString: string, trialWeeks: number | null = 2) => ({
  identifier,
  product: {
    identifier: productId, priceString,
    introPrice: trialWeeks ? { price: 0, periodNumberOfUnits: trialWeeks, periodUnit: 'WEEK' } : null,
  },
});
const state = vi.hoisted(() => ({ data: [] as unknown[] | undefined, isLoading: false }));

vi.mock('@/lib/platform', () => ({ isNativeAndroid: () => false, storeName: () => 'the App Store' }));
vi.mock('@/hooks/useRevenueCat', () => ({ useStorePlanPackages: () => ({ data: state.data, isLoading: state.isLoading }) }));

import { StoreCatalog } from './StoreCatalog';
import { DmaAddOn } from './CompanyCatalog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const onStart = vi.fn();
const show = () => {
  act(() => root.render(<MemoryRouter><StoreCatalog onStart={onStart} /></MemoryRouter>));
  return host.textContent ?? '';
};
const buttons = () => Array.from(host.querySelectorAll('button')).filter((b) => /Start free|Get started/.test(b.textContent ?? ''));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onStart.mockReset();
  state.isLoading = false;
  state.data = [
    pkg('$rc_monthly', 'treecheck_core_scout_monthly', '$127.99'),
    pkg('core_monthly', 'treecheck_core_monthly', '$78.99'),
    pkg('$rc_annual', 'treecheck_core_yearly', '$779.99'),
  ];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the plans on the apps’ first screen', () => {
  it("show every plan the store sells at the store's own price and trial, like the website's pricing", () => {
    const text = show();
    expect(text).toContain('Simple pricing');
    expect(text).toContain('Recommended');
    expect(text).toContain('Core + Scout');
    expect(text).toContain('$127.99/month');
    expect(text).toContain('Core, yearly');
    expect(text).toContain('$78.99/month');
    expect(text).toContain('$779.99/year');
    expect(text).toContain('14 days free for new subscribers, then $127.99/month.');
    expect(text).toContain('Renews automatically until you cancel.');
    expect(text).toContain('Prices from the App Store.');
    expect(text).toContain('Terms of Use');
    expect(text).toContain('Privacy Policy');
    // The website's own Stripe prices never appear in the apps (Apple 3.1.1).
    expect(text).not.toMatch(/\$128(?!\.)|\$79(?!\.)/);
  });

  it('every start button opens the signup, where the plan is then bought in the store', () => {
    show();
    const all = buttons();
    expect(all.map((b) => b.textContent)).toEqual(['Start free for 14 days', 'Start free for 14 days', 'Start free for 14 days']);
    act(() => all[1].click());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a free trial when the store offers none to this person', () => {
    state.data = [pkg('$rc_monthly', 'treecheck_core_scout_monthly', '$127.99', null)];
    const text = show();
    expect(text).not.toContain('days free');
    expect(buttons().map((b) => b.textContent)).toEqual(['Get started']);
  });

  it("shows nothing when the store can't be reached, and a spinner while it loads", () => {
    state.data = [];
    expect(show()).toBe('');
    state.data = undefined;
    state.isLoading = true;
    show();
    expect(host.querySelector('[aria-label="Loading plans"]')).not.toBeNull();
  });

  it('the Digital Marketing Agent box in the apps: the same box and demo link, with no website price', () => {
    act(() => root.render(<MemoryRouter><DmaAddOn inApp /></MemoryRouter>));
    const text = host.textContent ?? '';
    expect(text).toContain('Want TreeCheck connected to your website?');
    expect(text).toContain('Included when we build your AI-enabled website.');
    expect(text).toContain('Keeping your current website? We write the content and you copy it into your site.');
    expect(text).toContain('Schedule a demo');
    expect(text).not.toContain('$');
    expect(text).not.toContain('Add it anytime after signup');
  });

  it('the website keeps its own box with the price', () => {
    act(() => root.render(<MemoryRouter><DmaAddOn /></MemoryRouter>));
    expect(host.textContent).toMatch(/\$\d+\/month per company/);
    expect(host.textContent).toContain('Add it anytime after signup');
  });

  it('the start page shows these in the phone apps and the Stripe plans only on the website', () => {
    const page = readFileSync(join(process.cwd(), 'src', 'pages', 'StartTrial.tsx'), 'utf8');
    expect(page).toContain('{store && <StoreCatalog onStart={() => openSignup(0)} />}');
    expect(page).toContain('{store && <DmaAddOn inApp />}');
    expect(page).toMatch(/const plans = !store && !Capacitor\.isNativePlatform\(\) &&/);
    expect(page).toContain('{plans && <CompanyCatalog');
  });
});
