// Scout > Crew estimate: who sees it, live prices from the published card, AI pre-fill that only fills answers, saving,
// and approving (which saves the draft first). Rendered with React's own renderer; the data layer is a stand-in.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { priceSheetCard } from '@/lib/production/testing/priceSheetFixture';
import { priceEstimate } from '@/lib/production/estimate';
import { STATUS_OFF, type ProductionStatus } from '@/lib/production/client';
import type { RateCardDefinition } from '@/lib/production/rules';

const OWNER = 'aaaaaaaa-0000-0000-0000-000000000001';
const state = vi.hoisted(() => ({
  status: null as unknown as ProductionStatus,
  def: null as unknown,
  row: null as unknown,
  jobber: false,
  call: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'production_estimates' ? state.row : null, error: null }) };
      return q;
    },
  },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: OWNER, email: 'owner@example.test' }, effectiveContractorId: OWNER, isTeamMember: false }) }));
vi.mock('@/hooks/useProductionStatus', () => ({ useProductionStatus: () => ({ status: state.status, isLoading: false }) }));
vi.mock('@/hooks/useProductionWork', () => ({
  useProductionCard: () => ({ data: { card: { id: 'card-2', version: 2, label: '' }, def: state.def, settings: null }, isLoading: false }),
  // Whether Jobber is connected is asked separately, so the calls tests look at are only the actions they make.
  productionCall: (fn: string, body: Record<string, unknown>) => (body.action === 'jobber' ? Promise.resolve({ connected: state.jobber }) : state.call(fn, body)),
}));

import ProductionEstimate from './ProductionEstimate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const PUBLISHED: ProductionStatus = {
  ...STATUS_OFF, rollout: true, eligible: true, started: true, published: true, owner: OWNER, is_owner: true, operating_model: 'hybrid',
  can: { price: true, setup: true, dispatch: true, field: false, costs: true },
};

async function show(path = '/dashboard/instant-estimator/crew') {
  await act(async () => root.render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/instant-estimator/crew" element={<ProductionEstimate />} />
          <Route path="/dashboard/instant-estimator/crew/:id" element={<ProductionEstimate />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
}
const page = () => document.body.textContent ?? '';
const button = (t: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === t || b.textContent?.includes(t)) as HTMLButtonElement | undefined;
const click = async (b: HTMLElement | undefined) => { expect(b).toBeDefined(); await act(async () => { b!.click(); }); };
const type = async (el: HTMLTextAreaElement | HTMLInputElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const flush = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(() => {
  state.status = PUBLISHED;
  state.def = priceSheetCard();
  state.row = null;
  state.jobber = false;
  state.call.mockReset();
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Crew estimate', () => {
  it('stays closed until the company publishes its rates, and for people who do not price work', async () => {
    state.status = { ...PUBLISHED, published: false };
    await show();
    expect(page()).toContain('Crew estimates open once your company publishes its rates');
    act(() => root.unmount());
    root = createRoot(host);
    state.status = { ...PUBLISHED, can: { ...PUBLISHED.can, price: false } };
    await show();
    expect(page()).toContain('Crew estimates open once your company publishes its rates');
  });

  it('prices crew work live from the card, and saves what is on the screen', async () => {
    state.call.mockResolvedValue({ ok: true, estimate: { id: 'bbbbbbbb-0000-0000-0000-000000000001', number: 1001 }, problems: [] });
    await show();
    await click(button('Add work for this tree'));
    await click(button('3-person'));
    await click(button('4 hr'));
    expect(page()).toContain('$1,500');
    expect(page()).toContain('3-person crew, 4 hr, 12 man-hours');
    await click(button('Save'));
    expect(state.call).toHaveBeenCalledWith('production-estimate', expect.objectContaining({
      action: 'save', estimateId: undefined,
      items: [expect.objectContaining({ serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: expect.objectContaining({ crew: 'crew3', hours: 4 }) })],
    }));
    const sent = state.call.mock.calls[0][1] as { items: Record<string, unknown>[] };
    expect(sent.items[0]).not.toHaveProperty('uncertain');
    // The crew and hours picked are offered first next time.
    expect(JSON.parse(localStorage.getItem('tc-crew-estimate-last') ?? '{}').removal).toEqual({ crew: 'crew3', hours: 4 });
  });

  it('the AI fills in answers (outlining the unsure ones) but the price comes from the card', async () => {
    state.call.mockResolvedValue({
      ok: true, photoPaths: [], voicePath: null, transcript: '',
      trees: [{ label: 'Oak', services: ['removal'], observations: '', facts: { crew_size: { value: 3, confidence: 0.9 }, duration_hours: { value: 4, confidence: 0.4 } } }],
    });
    await show();
    await type(document.body.querySelector('textarea[aria-label="Notes"]') as HTMLTextAreaElement, 'big oak, three guys half a day');
    await click(button('Fill in with AI'));
    await flush();
    expect(state.call).toHaveBeenCalledWith('production-ai', expect.objectContaining({ action: 'analyze_tree', treeKey: 't1', notes: 'big oak, three guys half a day' }));
    expect(page()).toContain('$1,500');
    expect(page()).toContain('Time on site (hr) · check');
  });

  it('a big price change needs a reason before it counts', async () => {
    await show();
    await click(button('Add work for this tree'));
    await click(button('3-person'));
    await click(button('4 hr'));
    await type(document.body.querySelector('input[placeholder="None"]') as HTMLInputElement, '1200');
    expect(page()).toContain('Pick why the price is lower.');
    await click(button('Competitive situation') ?? button('Other'));
    expect(page()).not.toContain('Pick why the price is lower.');
    expect(page()).toContain('$1,200');
  });

  it('approving a draft saves it first, then approves with the options the customer took', async () => {
    const def = state.def as RateCardDefinition;
    const items = [
      { id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required' as const, answers: { crew: 'crew3', hours: 4 } },
      { id: 'b', serviceKey: 'stump', treeKey: 't1', kind: 'recommended' as const, answers: { stump_diameter: 30 } },
    ];
    const priced = priceEstimate(def, items, { day: '2026-10-26' });
    state.row = {
      id: 'bbbbbbbb-0000-0000-0000-000000000001', number: 1001, status: 'draft', customer: { name: 'Pat Example' }, promised_window: null,
      trees: [{ key: 't1', label: 'Front oak', photos: [], voice: null }], work_items: priced.items, totals: { ...priced.totals, discountKey: null, paymentPlanKey: null },
    };
    state.call.mockImplementation(async (_fn: string, body: { action: string }) => (body.action === 'approve' ? { ok: true, packets: 2 } : { ok: true, estimate: { id: 'x', number: 1001 }, problems: [] }));
    await show('/dashboard/instant-estimator/crew/bbbbbbbb-0000-0000-0000-000000000001');
    await flush();
    expect(page()).toContain('Crew estimate #1001');
    await click(button('Mark approved'));
    expect(page()).toContain('Tick the options the customer chose.');
    await click([...document.body.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Approve') as HTMLButtonElement);
    await flush();
    expect(state.call.mock.calls.map((c) => (c[1] as { action: string }).action)).toEqual(['save', 'approve']);
    expect(state.call.mock.calls[1][1]).toMatchObject({ action: 'approve', estimateId: 'bbbbbbbb-0000-0000-0000-000000000001', chosen: ['b'] });
  });

  it('sends a saved draft to Jobber (saving it first) when Jobber is connected, and shows the quote number after', async () => {
    const def = state.def as RateCardDefinition;
    const priced = priceEstimate(def, [{ id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3', hours: 4 } }], { day: '2026-10-26' });
    const draft = {
      id: 'bbbbbbbb-0000-0000-0000-000000000003', number: 1003, status: 'draft', customer: { name: 'Pat Example', address: '1 Test Lane, Edmond, OK' }, promised_window: null,
      trees: [{ key: 't1', label: 'Tree 1', photos: [], voice: null }], work_items: priced.items, totals: { ...priced.totals, discountKey: null, paymentPlanKey: null },
      jobber_quote_id: null, jobber_quote_number: null, quote_state: null,
    };
    state.row = draft;
    state.jobber = true;
    state.call.mockImplementation(async (_fn: string, body: { action: string }) => {
      if (body.action === 'send') {
        state.row = { ...draft, status: 'sent', jobber_quote_id: 'Q1', jobber_quote_number: '42', quote_state: 'pending' };
        return { ok: true, state: 'sent', quoteNumber: '42', message: 'Draft quote #42 is in Jobber, ready for the office to check and send.' };
      }
      return { ok: true, estimate: { id: draft.id, number: 1003 }, problems: [] };
    });
    await show('/dashboard/instant-estimator/crew/bbbbbbbb-0000-0000-0000-000000000003');
    await flush();
    await click(button('Send to Jobber'));
    await flush();
    expect(state.call.mock.calls.map((c) => (c[1] as { action: string }).action)).toEqual(['save', 'send']);
    expect(page()).toContain('In Jobber as quote #42.');
    expect(button('Send to Jobber')).toBeUndefined();
  });

  it('offers no Jobber send when Jobber is not connected, and Check Jobber after an unconfirmed send', async () => {
    const def = state.def as RateCardDefinition;
    const priced = priceEstimate(def, [{ id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3', hours: 4 } }], { day: '2026-10-26' });
    state.row = {
      id: 'bbbbbbbb-0000-0000-0000-000000000004', number: 1004, status: 'draft', customer: {}, promised_window: null,
      trees: [{ key: 't1', label: 'Tree 1', photos: [], voice: null }], work_items: priced.items, totals: { ...priced.totals, discountKey: null, paymentPlanKey: null },
      jobber_quote_id: null, quote_state: 'uncertain',
    };
    await show('/dashboard/instant-estimator/crew/bbbbbbbb-0000-0000-0000-000000000004');
    await flush();
    expect(button('Send to Jobber')).toBeUndefined();
    expect(page()).toContain('Jobber may have made the quote without confirming it.');
    state.call.mockResolvedValue({ ok: true, state: 'not_found', message: 'Jobber has no quote for it, so you can send it again.' });
    await click(button('Check Jobber'));
    await flush();
    expect(state.call).toHaveBeenCalledWith('production-estimate', { action: 'check', estimateId: 'bbbbbbbb-0000-0000-0000-000000000004' });
  });

  it('a sent estimate is read-only and keeps the prices it was sent with', async () => {
    const def = state.def as RateCardDefinition;
    const priced = priceEstimate(def, [{ id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3', hours: 4 } }], { day: '2026-10-26' });
    state.row = {
      id: 'bbbbbbbb-0000-0000-0000-000000000002', number: 1002, status: 'sent', customer: {}, promised_window: null,
      trees: [{ key: 't1', label: 'Tree 1', photos: [], voice: null }], work_items: priced.items, totals: { ...priced.totals, discountKey: null, paymentPlanKey: null },
    };
    // The company raised its rate since this was sent.
    (state.def as RateCardDefinition).pricing.manHourRate = 150;
    await show('/dashboard/instant-estimator/crew/bbbbbbbb-0000-0000-0000-000000000002');
    await flush();
    expect(page()).toContain('This estimate has been sent. Revise it to change anything.');
    expect(page()).toContain('$1,500');
    expect(page()).not.toContain('$1,800');
    expect(button('Save')).toBeUndefined();
    expect(button('Revise')).toBeDefined();
  });
});
