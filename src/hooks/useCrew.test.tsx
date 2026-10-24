import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsCrewOnly } from './useCrew';

const state = vi.hoisted(() => ({ team: false, account: 'company', member: false, network: false, loading: false }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'test' }, effectiveContractorId: 'company', isTeamMember: state.team }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => ({
  isLoading: state.loading,
  data: queryKey[0] === 'crew-account-type' ? { account_type: state.account } :
    queryKey[0] === 'my-crew-memberships' ? (state.member ? [{}] : []) : (state.network ? [{}] : []),
}) }));
let host: HTMLDivElement;
let root: Root;
let result: ReturnType<typeof useIsCrewOnly>;
function Probe() { result = useIsCrewOnly(); return null; }
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement('div'); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); Object.assign(state, { team: false, account: 'company', member: false, network: false, loading: false }); });
function check() { act(() => root.render(<Probe />)); return result; }
describe('company office versus subcontractor audience', () => {
  it('office team retains Home even when also on a crew', () => {
    state.team = true; state.member = true;
    expect(check().isCrewOnly).toBe(false);
  });
  it('an explicit subcontractor stays restricted even with team metadata or owned crew', () => {
    state.account = 'subcontractor'; state.team = true; state.network = true;
    expect(check().isCrewOnly).toBe(true);
  });
  it('legacy crew membership without a company network stays restricted', () => {
    state.member = true; expect(check().isCrewOnly).toBe(true);
  });
  it('waits while audience queries are loading', () => {
    state.loading = true; expect(check().loading).toBe(true);
  });
});