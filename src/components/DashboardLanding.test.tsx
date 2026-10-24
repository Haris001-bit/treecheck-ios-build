import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardLanding } from './DashboardLanding';

const state = vi.hoisted(() => ({ loading: false, isCrewOnly: false, mounts: vi.fn() }));
vi.mock('@/hooks/useCrew', () => ({ useIsCrewOnly: () => state }));
vi.mock('@/pages/Dashboard', () => ({ default: () => { state.mounts(); return <p>Available Leads test</p>; } }));

let host: HTMLDivElement;
let root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
function show() {
  act(() => root.render(<MemoryRouter initialEntries={['/dashboard']}><Routes>
    <Route path="/dashboard" element={<DashboardLanding />} />
    <Route path="/dashboard/home" element={<p>Home test</p>} />
    <Route path="/dashboard/crew-bids" element={<p>Crew test</p>} />
  </Routes></MemoryRouter>));
}
afterEach(() => { act(() => root.unmount()); host.remove(); sessionStorage.clear(); state.loading = false; state.isCrewOnly = false; state.mounts.mockClear(); });
describe('dashboard landing without a leads flash', () => {
  it('owners go straight to Home without mounting leads', () => {
    show(); expect(host.textContent).toContain('Home test'); expect(state.mounts).not.toHaveBeenCalled();
  });
  it('waits for account type without mounting leads or Home', () => {
    state.loading = true; show(); expect(host.querySelector('[role="status"]')).not.toBeNull(); expect(state.mounts).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('Home test');
  });
  it('crew goes to jobs to bid even after Home was seen', () => {
    sessionStorage.setItem('home-seen-session', '1'); state.isCrewOnly = true; show(); expect(host.textContent).toContain('Crew test'); expect(state.mounts).not.toHaveBeenCalled();
  });
  it('owners can still open Available Leads after Home', () => {
    sessionStorage.setItem('home-seen-session', '1'); show(); expect(host.textContent).toContain('Available Leads test');
  });
});