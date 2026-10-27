// The Jobber page when no Jobber place is the company's yet (JC1): pressing Connect Jobber shows Mark's stand by message
// in a popup instead of leaving for Jobber. Rendered with React's own renderer, with Supabase mocked.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError, info: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => {
  const row = { data: null, error: null };
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => row };
  return { supabase: { from: () => chain, functions: { invoke: mocks.invoke } } };
});

import JobberIntegration from './JobberIntegration';
import { JOBBER_WAITLIST_MESSAGE, JOBBER_WAITLIST_TITLE } from '../../supabase/functions/_shared/connectWaitlist';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

// The popup opens in a portal on document.body.
const page = () => document.body.textContent ?? '';
const button = (label: string) => {
  const found = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`No "${label}" button on: ${page()}`);
  return found;
};
const popupOpen = () => document.body.querySelector('[role="alertdialog"]') !== null;

async function until(check: () => void, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      check();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function show(path = '/dashboard/integrations/jobber') {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <JobberIntegration />
      </MemoryRouter>,
    ),
  );
  await until(() => expect(page()).toContain('Not connected'));
}

const WAITLIST = { data: { code: 'jobber_waitlist', title: JOBBER_WAITLIST_TITLE, error: JOBBER_WAITLIST_MESSAGE }, error: null };

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.toastError.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Connect Jobber with no Jobber place free', () => {
  it("shows Mark's stand by message in a popup, not an error, and stays on the page", async () => {
    mocks.invoke.mockResolvedValue(WAITLIST);
    await show();
    await act(async () => button('Connect Jobber').click());
    await until(() => expect(popupOpen()).toBe(true));
    expect(page()).toContain(JOBBER_WAITLIST_TITLE);
    expect(page()).toContain(JOBBER_WAITLIST_MESSAGE);
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith('jobber-connect', expect.anything());
    // The button is usable again (not stuck on "Redirecting").
    expect(button('Connect Jobber').disabled).toBe(false);
  });

  it('closes with OK', async () => {
    mocks.invoke.mockResolvedValue(WAITLIST);
    await show();
    await act(async () => button('Connect Jobber').click());
    await until(() => expect(popupOpen()).toBe(true));
    await act(async () => button('OK').click());
    await until(() => expect(popupOpen()).toBe(false));
  });

  it('shows the server wording when it changes, so the phone apps need no update for it', async () => {
    mocks.invoke.mockResolvedValue({ data: { code: 'jobber_waitlist', title: 'New title', error: 'New wording.' }, error: null });
    await show();
    await act(async () => button('Connect Jobber').click());
    await until(() => expect(page()).toContain('New wording.'));
    expect(page()).toContain('New title');
  });

  it('opens the popup when Jobber sends the owner back from its App Marketplace', async () => {
    mocks.invoke.mockResolvedValue(WAITLIST);
    await show('/dashboard/integrations/jobber?from=jobber');
    await until(() => expect(popupOpen()).toBe(true));
    expect(page()).toContain(JOBBER_WAITLIST_MESSAGE);
  });

  it("other refusals still show as an error note, with no popup", async () => {
    mocks.invoke.mockResolvedValue({ data: { error: 'Only the account owner can connect Jobber.', code: 'owner_only' }, error: null });
    await show();
    await act(async () => button('Connect Jobber').click());
    await until(() => expect(mocks.toastError).toHaveBeenCalledWith('Only the account owner can connect Jobber.'));
    expect(popupOpen()).toBe(false);
  });
});
