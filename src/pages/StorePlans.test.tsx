// The phone plan screen (payments milestone, Part B), rendered: an owner sees the store's own prices and trial, a team
// member is sent to the owner, a website subscriber buys nothing, a running phone plan can be managed. Hooks mocked.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let isTeamMember = false;
let status: unknown = { billing: { pricing_version: 'legacy' }, members: [], storeBlocker: null };
const later = new Date(Date.now() + 10 * 86_400_000).toISOString();
const pkg = (identifier: string, productId: string, priceString: string) => ({
  identifier,
  product: { identifier: productId, priceString, introPrice: { price: 0, periodNumberOfUnits: 2, periodUnit: 'WEEK' } },
});
const PACKAGES = [
  pkg('$rc_monthly', 'treecheck_core_scout_monthly', '$127.99'),
  pkg('core_monthly', 'treecheck_core_monthly', '$78.99'),
  pkg('$rc_annual', 'treecheck_core_yearly', '$779.99'),
];

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'owner-1' }, isTeamMember }) }));
vi.mock('@/lib/platform', () => ({
  canUseStorePlans: () => true, isNativeAndroid: () => false, storeName: () => 'the App Store',
}));
vi.mock('@/hooks/useCompanyBilling', () => ({ companyBillingAction: vi.fn(async () => status) }));
vi.mock('@/hooks/useRevenueCat', () => ({
  useStorePlanPackages: () => ({ data: PACKAGES, isLoading: false }),
  useIapCustomerInfo: () => ({ data: null }),
  useBuyStorePlan: () => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined }),
  useIapRestore: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import StorePlans from './StorePlans';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(
    <QueryClientProvider client={client}><MemoryRouter><StorePlans /></MemoryRouter></QueryClientProvider>,
  ));
  // Let the status query resolve.
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return host.textContent ?? '';
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  isTeamMember = false;
  status = { billing: { pricing_version: 'legacy' }, members: [], storeBlocker: null };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('StorePlans', () => {
  it("shows an owner each plan at the store's price, with its free trial, Restore and the legal links", async () => {
    const text = await show();
    expect(text).toContain('Choose your plan');
    expect(text).toContain('Core + 1 Scout');
    expect(text).toContain('14 days free, then $127.99/month');
    expect(text).toContain('14 days free, then $78.99/month');
    expect(text).toContain('14 days free, then $779.99/year');
    expect(text).toContain('Start 14-day free trial');
    expect(text).toContain('Renews automatically until you cancel.');
    expect(text).toContain('Restore Purchases');
    expect(text).toContain('Terms of Use');
    expect(text).toContain('Privacy Policy');
  });
  it('sends a team member to the company owner, with nothing to buy', async () => {
    isTeamMember = true;
    const text = await show();
    expect(text).toContain('Your company owner chooses TreeCheck');
    expect(text).not.toContain('Start 14-day free trial');
  });
  it('tells a website subscriber there is nothing to buy here', async () => {
    status = { billing: { pricing_version: '2026-10', provider: 'stripe', status: 'active', current_period_end: later }, members: [] };
    const text = await show();
    expect(text).toContain("You're subscribed on the website");
    expect(text).not.toContain('Start 14-day free trial');
  });
  it('shows a running App Store plan with Manage subscription', async () => {
    status = { billing: { pricing_version: '2026-10', provider: 'app_store', status: 'active', current_period_end: later, capacity: { ownerScout: true } }, members: [] };
    const text = await show();
    expect(text).toContain('Core + 1 Scout, billed through the App Store');
    expect(text).toContain('Renews on');
    expect(text).toContain('Manage subscription');
  });
  it("shows why a company the server keeps where it is can't buy", async () => {
    status = { billing: { pricing_version: 'legacy' }, members: [], storeBlocker: 'Contact us to move your team to the new plans.' };
    const text = await show();
    expect(text).toContain('Contact us to move your team to the new plans.');
    expect(text).not.toContain('Start 14-day free trial');
  });
});
