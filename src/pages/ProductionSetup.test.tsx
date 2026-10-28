// Settings > Crews & pricing: who sees it, starting the setup, every step rendering, and publishing only once nothing is
// open. Rendered with React's own renderer; the data hooks are stand-ins.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { priceSheetCard } from '@/lib/production/testing/priceSheetFixture';
import { starterDefinition } from '@/lib/production/starter';
import { STATUS_OFF, type ProductionStatus } from '@/lib/production/client';

const OWNER = 'aaaaaaaa-0000-0000-0000-000000000001';
const state = vi.hoisted(() => ({
  status: null as unknown as ProductionStatus,
  data: null as unknown,
  fresh: true,
  ensure: vi.fn(),
  publish: vi.fn(),
  saveDefinition: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: OWNER, email: 'owner@example.test' }, effectiveContractorId: OWNER, isTeamMember: false }) }));
vi.mock('@/hooks/useProductionStatus', () => ({ useProductionStatus: () => ({ status: state.status, isLoading: false }) }));
vi.mock('@/hooks/useProductionSetup', () => ({
  useProductionSetup: () => ({
    data: state.data, isLoading: false, isFetchedAfterMount: state.fresh, owner: OWNER, ensure: state.ensure, publish: state.publish,
    saveDefinition: state.saveDefinition, saveSettings: vi.fn(), importSheet: vi.fn(), refresh: vi.fn(),
  }),
}));
vi.mock('@/hooks/useProductionConfig', () => ({
  useProductionConfig: () => ({
    data: { roles: [{ role_key: 'climber', name: 'Climber', loaded_hourly_cost: 42, sort_order: 0 }, { role_key: 'ground', name: 'Ground', loaded_hourly_cost: 28, sort_order: 1 }], equipment: [{ equipment_key: 'lift', name: 'Lift', hourly_cost: 35, sort_order: 0 }], pricing: { target_margin: 0.3, minimum_job_charge: null, disposal_per_load: null }, configured: true },
    isLoading: false, save: vi.fn(), cfg: null,
  }),
  keyFromName: (n: string) => n.toLowerCase(),
}));
vi.mock('@/hooks/useCompanySettings', () => ({ useCompanySettings: () => ({ data: { crm: 'jobber' } }) }));

import ProductionSetup from './ProductionSetup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const ELIGIBLE: ProductionStatus = { ...STATUS_OFF, rollout: true, eligible: true, started: true, owner: OWNER, is_owner: true, operating_model: 'hybrid', can: { price: true, setup: true, dispatch: true, field: false, costs: true } };
const settings = { contractor_id: OWNER, basics: {}, crew_counts: {}, resources: [], cost_viewer_ids: [], send_unit_cost: false, isa_credentials: {}, active_profile: 'normal', profile_schedule: [] };
const withDraft = (definition: unknown) => ({ settings, draft: { id: 'card-1', label: '', branch_key: null, status: 'draft', version: null, effective_from: null, published_at: null, definition, updated_at: '' }, published: [], members: [] });

async function show() {
  await act(async () => root.render(<MemoryRouter><ProductionSetup /></MemoryRouter>));
}
const buttonByText = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement | undefined;
const click = async (b: HTMLElement | undefined) => { await act(async () => { b?.click(); }); };

beforeEach(() => {
  state.status = ELIGIBLE;
  state.data = withDraft(starterDefinition());
  state.fresh = true;
  state.ensure.mockReset();
  state.publish.mockReset().mockResolvedValue({ ok: true, version: 1 });
  state.saveDefinition.mockReset().mockResolvedValue(undefined);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Crews & pricing', () => {
  it('is only for companies that run their own crews', async () => {
    state.status = STATUS_OFF;
    await show();
    expect(host.textContent).toContain('for companies that run their own crews');
    expect(buttonByText('Start setup')).toBeUndefined();
  });

  it('starts the setup on request', async () => {
    state.data = { settings: null, draft: null, published: [], members: [] };
    await show();
    await click(buttonByText('Start setup'));
    expect(state.ensure).toHaveBeenCalledTimes(1);
  });

  it('renders every step without breaking', async () => {
    await show();
    const steps = ['Company and who sees what', 'Services', 'Prices', 'Crews and equipment', 'Pricing method', 'Playbooks', 'Customer text and policies', 'Open items', 'Past jobs check', 'Publish'];
    const expectText = ['Working days', 'Start from your price sheet', 'Try it', 'Crew templates', 'How crew time is priced', 'What happens when work is sold', 'The consultation block', 'open item', 'Check against past jobs', 'Prices apply from'];
    for (let i = 0; i < steps.length; i++) {
      await click(buttonByText(`${i + 1}. ${steps[i]}`));
      expect(host.textContent, steps[i]).toContain(expectText[i]);
    }
  }, 20_000); // Ten full steps take about 5 s, more on a busy machine.

  it('publishing waits until nothing is open', async () => {
    await show();
    await click(buttonByText('10. Publish'));
    const publish = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Publish') as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
  });

  it('publishes a finished card with its start date', async () => {
    const def = priceSheetCard();
    const stump = def.services.find((s) => s.key === 'stump')!;
    if (stump.strategy.kind === 'measurement') stump.strategy.variants![0].range!.rule = 'low';
    def.decisions.push({ key: 'day_vs_rate:removal:full_day_4', choice: 'floor' });
    def.services = def.services.filter((s) => s.key !== 'basal_bark');
    def.validation.skippedReason = 'New company';
    state.data = withDraft(def);
    await show();
    await click(buttonByText('10. Publish'));
    const publish = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Publish') as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    await click(publish);
    expect(state.publish).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'card-1', skipReason: 'New company', effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });
});

describe('Crews & pricing keeps every edit', () => {
  const offeredSwitches = () => [...host.querySelectorAll('button[role=switch]')].filter((b) => b.getAttribute('data-state') === 'checked') as HTMLElement[];
  const savedOffered = (call: unknown[]) => (call[1] as ReturnType<typeof starterDefinition>).services.filter((s) => s.offered !== false).length;
  const wait = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  afterEach(() => { vi.useRealTimers(); });

  it('opened again, it shows the draft from a fresh read, not the copy it loaded the first time', async () => {
    // The cached copy still has the membership; the saved draft no longer does.
    state.fresh = false;
    await show();
    expect(host.textContent).toContain('Loading');
    expect(buttonByText('2. Services')).toBeUndefined();
    const saved = starterDefinition();
    saved.services = saved.services.filter((s) => s.strategy.kind !== 'recurring_plan');
    state.data = withDraft(saved);
    state.fresh = true;
    await show();
    await click(buttonByText('8. Open items'));
    expect(host.textContent).toContain('open item');
    expect(host.textContent).not.toContain('map the initial and monthly payments');
  });

  it('an edit made while a save is running gets saved too', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => {};
    state.saveDefinition.mockReset().mockImplementationOnce(() => new Promise<void>((r) => { finish = r; })).mockResolvedValue(undefined);
    await show();
    await click(buttonByText('2. Services'));
    const total = offeredSwitches().length;
    await click(offeredSwitches()[0]);
    await wait(800);
    expect(state.saveDefinition).toHaveBeenCalledTimes(1);
    await click(offeredSwitches()[0]); // while the first save is still running
    await act(async () => { finish(); });
    await wait(800);
    expect(state.saveDefinition).toHaveBeenCalledTimes(2);
    expect(savedOffered(state.saveDefinition.mock.calls[1])).toBe(total - 2);
  });

  it('leaving the page within the wait still saves the last edit', async () => {
    vi.useFakeTimers();
    await show();
    await click(buttonByText('2. Services'));
    const total = offeredSwitches().length;
    await click(offeredSwitches()[0]);
    expect(state.saveDefinition).not.toHaveBeenCalled();
    act(() => root.unmount());
    root = createRoot(host); // afterEach unmounts again
    expect(state.saveDefinition).toHaveBeenCalledTimes(1);
    expect(savedOffered(state.saveDefinition.mock.calls[0])).toBe(total - 1);
  });
});
