// The phone apps' subscription notice: an owner in an app that sells the plans gets the plan screen instead of
// "Subscription changes happen outside the app" (what Apple's 1.2 reviewer saw). Rendered with React's own renderer.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ storePlans: true, isTeamMember: false, isCrewOnly: false, loading: false }));

vi.mock('@/lib/platform', () => ({ canUseStorePlans: () => state.storePlans }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isTeamMember: state.isTeamMember }) }));
vi.mock('@/hooks/useCrew', () => ({ useIsCrewOnly: () => ({ isCrewOnly: state.isCrewOnly, loading: state.loading, isCrew: state.isCrewOnly }) }));

import SafeModeInfo from './SafeModeInfo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

async function show() {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/dashboard/subscription-info']}>
        <Routes>
          <Route path="/dashboard/subscription-info" element={<SafeModeInfo />} />
          <Route path="/plan" element={<div>Plan screen</div>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

const NOTICE = 'Subscription changes happen outside the app';

beforeEach(() => {
  Object.assign(state, { storePlans: true, isTeamMember: false, isCrewOnly: false, loading: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SafeModeInfo', () => {
  it('sends an owner to the plan screen when the app sells the plans', async () => {
    await show();
    expect(host.textContent).toContain('Plan screen');
    expect(host.textContent).not.toContain(NOTICE);
  });

  it('keeps the notice for team members, who cannot buy', async () => {
    state.isTeamMember = true;
    await show();
    expect(host.textContent).toContain(NOTICE);
  });

  it('keeps the notice for subcontractors', async () => {
    state.isCrewOnly = true;
    await show();
    expect(host.textContent).toContain(NOTICE);
  });

  it('keeps the notice where the app does not sell the plans', async () => {
    state.storePlans = false;
    await show();
    expect(host.textContent).toContain(NOTICE);
  });

  it('shows nothing while it is still working out who the user is', async () => {
    state.loading = true;
    await show();
    expect(host.textContent).toBe('');
  });
});
