// Settings > Crews & pricing: the Jobber card stays hidden until the approval extras are on, then asks for a
// reconnect while a permission is missing. Rendered with React's own renderer; the function call is a stand-in.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_OFF } from '@/lib/production/client';

const call = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useProductionWork', () => ({ productionCall: call }));

import { JobberExtrasCard } from './JobberExtrasCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const probe = (over: Record<string, unknown>) => ({ ok: true, probe: { connected: true, users: true, requests: true, products: true, customFields: true, ...over }, counts: { services: 2, team: 1, fields: 0 } });
const show = async (on: boolean) => {
  await act(async () => root.render(<MemoryRouter><JobberExtrasCard status={{ ...STATUS_OFF, jobber_extras: on }} /></MemoryRouter>));
};

beforeEach(() => {
  call.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('JobberExtrasCard', () => {
  it('shows nothing and asks nothing while the extras are off', async () => {
    await show(false);
    expect(host.textContent).toBe('');
    expect(call).not.toHaveBeenCalled();
  });

  it('asks for a reconnect while a permission is missing', async () => {
    call.mockResolvedValue(probe({ customFields: false }));
    await show(true);
    expect(call).toHaveBeenCalledWith('production-setup', { action: 'jobber_extras', refresh: false });
    expect(host.textContent).toContain('Jobber needs to be reconnected once');
    expect(host.querySelector('a[href="/dashboard/integrations/jobber"]')?.textContent).toBe('Reconnect Jobber');
    expect(host.textContent).not.toContain('Match services');
  });

  it('offers matching and the quote fields once every permission is there', async () => {
    call.mockResolvedValue(probe({}));
    await show(true);
    expect(host.textContent).toContain('Services (2 matched)');
    expect(host.textContent).toContain('Team (1 matched)');
    expect(host.textContent).toContain('Quote fields (0 of 5 in Jobber)');
    expect(host.textContent).not.toContain('Reconnect Jobber');
  });
});
