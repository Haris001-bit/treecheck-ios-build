import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home, { HOME_SEEN_KEY } from './Home';

const state = vi.hoisted(() => ({ loading: false, isCrewOnly: false, isTeamMember: false, queries: vi.fn(), pulse: vi.fn() }));
vi.mock('@/hooks/useCrew', () => ({ useIsCrewOnly: () => state }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'office-test' }, isTeamMember: state.isTeamMember }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => { state.queries(); return { isLoading: true }; } }));
vi.mock('@/components/pulse/home/PulseHomeCard', () => ({ PulseHomeCard: () => { state.pulse(); return <p>Pulse test</p>; } }));
vi.mock('@/components/home/HomeAdvertisementSample', () => ({ HomeAdvertisementSample: () => <p>Sample test</p> }));
vi.mock('@/hooks/useFreePlan', () => ({ useFreePlan: () => ({ data: undefined, isLoading: true }) }));

let host: HTMLDivElement;
let root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
function show(path = '/dashboard/home') {
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/dashboard/home" element={<Home />} />
    <Route path="/dashboard/crew-bids" element={<p>Subcontractor jobs</p>} />
  </Routes></MemoryRouter>));
}
afterEach(() => { act(() => root.unmount()); host.remove(); sessionStorage.clear(); state.loading = false; state.isCrewOnly = false; state.isTeamMember = false; vi.clearAllMocks(); });
describe('Home audience protection', () => {
  it('mounts no summaries while account access is loading', () => {
    state.loading = true; show();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Welcome back.');
    expect(state.queries).not.toHaveBeenCalled(); expect(state.pulse).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(HOME_SEEN_KEY)).toBeNull();
  });
  it.each(['/dashboard/home', '/dashboard/home?sample=1'])('redirects subcontractors without mounting dashboard content at %s', (path) => {
    state.isCrewOnly = true; show(path);
    expect(host.textContent).toContain('Subcontractor jobs');
    expect(state.queries).not.toHaveBeenCalled(); expect(state.pulse).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(HOME_SEEN_KEY)).toBeNull();
  });
  it.each([false, true])('keeps the same Home for owners and office team (team=%s)', (team) => {
    state.isTeamMember = team; show();
    expect(host.textContent).toContain('Welcome back.');
    expect(host.textContent).toContain('Booked vs sold');
    expect(state.queries).toHaveBeenCalled(); expect(state.pulse).toHaveBeenCalled();
    expect(sessionStorage.getItem(HOME_SEEN_KEY)).toBe('1');
  });
});