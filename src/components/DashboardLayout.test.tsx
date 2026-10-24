// The phone apps' "Plan" menu item (Apple's 1.2 review couldn't find the plans under Settings > Profile). Hooks are
// mocked; rendered with React's own renderer in jsdom (no extra test library).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ storePlans: true, isTeamMember: false }));

vi.mock('@/lib/platform', () => ({
  isAppStoreSafeMode: () => true,
  isNativeStoreBilling: () => true,
  getWebBaseUrl: () => 'https://app.example.test',
  canUseAppleIAP: () => true,
  canUseStorePlans: () => state.storePlans,
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ isAdmin: false, isTeamMember: state.isTeamMember, signOut: vi.fn(), effectiveContractorId: 'owner-1', user: { id: 'owner-1', email: 'owner@example.test' } }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) },
}));
vi.mock('@/components/billing/BillingBanner', () => ({ BillingBanner: () => null }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => undefined }));
vi.mock('@/hooks/pulse/usePulseAccess', () => ({ usePulseAccess: () => ({ allowed: false }) }));
vi.mock('@/hooks/useCompanySettings', () => ({
  useCompanySettings: () => ({ data: { onboarding_completed_at: '2026-10-01T00:00:00Z' }, isLoading: false }),
  usesSubs: () => false,
}));
vi.mock('@/hooks/useCrew', () => ({ useIsCrewOnly: () => ({ isCrew: false, isCrewOnly: false, loading: false }) }));
vi.mock('@/components/HubTabs', () => ({ HubTabs: () => null }));
vi.mock('@/components/DemoSwitchButton', () => ({ DemoSwitchButton: () => null }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }));
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasProduct: () => true }), PRODUCT_MARKETING_URLS: {} }));
vi.mock('@/hooks/useFreePlan', () => ({ useFreePlan: () => ({ data: null }) }));

import DashboardLayout from './DashboardLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

async function show() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/dashboard/home']}>
          <Routes>
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route path="home" element={<div>Home page</div>} />
            </Route>
            <Route path="/plan" element={<div>Plan screen</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}

const planLinks = () => [...host.querySelectorAll('a')].filter((a) => a.textContent?.trim() === 'Plan');

beforeEach(() => {
  state.storePlans = true;
  state.isTeamMember = false;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('DashboardLayout Plan item', () => {
  it('shows Plan to an owner in a phone app that sells the plans, and opens the plan screen', async () => {
    await show();
    const links = planLinks();
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toBe('/plan');
    await act(async () => links[0].click());
    expect(host.textContent).toContain('Plan screen');
  });

  it('puts Plan just above Settings', async () => {
    await show();
    const labels = [...host.querySelectorAll('nav a')].map((a) => a.textContent?.trim());
    expect(labels.indexOf('Plan')).toBe(labels.indexOf('Settings') - 1);
  });

  it('hides Plan from team members, who cannot buy', async () => {
    state.isTeamMember = true;
    await show();
    expect(planLinks()).toHaveLength(0);
  });

  it('hides Plan where the app does not sell the plans (website, or a build without store keys)', async () => {
    state.storePlans = false;
    await show();
    expect(planLinks()).toHaveLength(0);
  });
});
