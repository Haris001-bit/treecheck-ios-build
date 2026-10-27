// Jobs > Crew work: crew leaders see their own packets and never a price; the office moves packets along; the actual
// hours go back with the packet's last-read time so two people never overwrite each other. Data hooks are stand-ins.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_OFF, type ProductionStatus } from '@/lib/production/client';
import type { EstimateRow, PacketRow } from '@/hooks/useProductionWork';
import { priceSheetCard } from '@/lib/production/testing/priceSheetFixture';

const LEADER = 'cccccccc-0000-0000-0000-000000000001';
const OWNER = 'aaaaaaaa-0000-0000-0000-000000000001';
const state = vi.hoisted(() => ({
  status: null as unknown as ProductionStatus,
  userId: '',
  packets: [] as unknown[],
  estimates: [] as unknown[],
  jobber: false,
  def: null as unknown,
  settings: null as unknown,
  work: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: state.userId, email: 'someone@example.test' }, effectiveContractorId: OWNER, isTeamMember: state.userId !== OWNER }) }));
vi.mock('@/hooks/useProductionStatus', () => ({ useProductionStatus: () => ({ status: state.status, isLoading: false }) }));
vi.mock('@/hooks/useCompanySettings', () => ({ useCompanySettings: () => ({ data: { sub_usage: 'never' } }), usesSubs: () => false }));
vi.mock('@/components/RequestCrewBidsDialog', () => ({ RequestCrewBidsDialog: () => null }));
vi.mock('@/hooks/useProductionWork', () => ({
  useProductionWork: () => ({
    estimates: { data: state.estimates, isLoading: false },
    packets: { data: state.packets, isLoading: false, refetch: vi.fn() },
    leaders: { data: [{ id: OWNER, email: 'owner@example.test', owner: true }, { id: LEADER, email: 'leader@example.test' }] },
    work: state.work,
  }),
  useProductionCard: () => ({ data: { card: null, def: state.def, settings: state.settings }, isLoading: false, refetch: vi.fn() }),
  productionCall: async (_fn: string, body: { action?: string }) => (body.action === 'jobber' ? { connected: state.jobber } : null),
}));
// The report from the packets on screen (the estimates part is the report engine's own tests).
vi.mock('@/hooks/useProductionReport', async () => {
  const { computeReports } = await import('@/lib/production/reports');
  const { toReportPacket } = await import('@/components/production/jobs/reportRows');
  return {
    useProductionReport: (_s: unknown, _d: unknown, packets: PacketRow[]) => ({
      report: computeReports({ estimates: [], packets: packets.map((x) => toReportPacket(x, {})), targetRate: 125 }), isLoading: false,
    }),
  };
});

import ProductionJobs from './ProductionJobs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const base: ProductionStatus = { ...STATUS_OFF, rollout: true, eligible: true, started: true, published: true, owner: OWNER, operating_model: 'employees' };
const LEADER_STATUS: ProductionStatus = { ...base, can: { price: false, setup: false, dispatch: false, field: true, costs: false } };
const OFFICE_STATUS: ProductionStatus = { ...base, is_owner: true, can: { price: true, setup: true, dispatch: true, field: true, costs: true } };
const SALES_STATUS: ProductionStatus = { ...base, can: { price: true, setup: false, dispatch: false, field: false, costs: false } };

const packet = (over: Partial<PacketRow> = {}): PacketRow => ({
  id: 'dddddddd-0000-0000-0000-000000000001', estimate_id: 'est-1', package_key: 'removal', title: 'Removal', fulfillment: 'internal', estimate_number: 1001,
  scope: [{ workItemId: 'a', tree: 'Front oak', service: 'Tree removal', scope: 'Tree removal: 32 in DBH, rear yard access', hours: 4, equipment: ['lift'], access: 'rear_yard', gate: null, utility: 'LINE_DROP', vendor: null, hazards: null, photos: [] }],
  customer: { name: 'Pat Example', phone: '555-0100', address: '1 Test Lane', gateCode: '1234', accessNotes: 'Dog in the yard' },
  crew: { template: 'crew3', headcount: 3 }, est_hours: 4, est_crew_hours: 4, est_man_hours: 12, resources: [{ key: 'lift', hours: 4 }],
  scheduling_class: 'normal', depends_on: [], status: 'planned', planned_date: '2026-11-02', scheduled_date: null, crew_leader_id: LEADER,
  tasks: [{ key: 'line_drop:1', kind: 'utility_disconnect', title: 'Arrange the utility disconnect', status: 'open', dueAt: null }],
  actuals: null, updated_at: '2026-10-26T15:00:00.123456+00:00', ...over,
});

async function show() {
  await act(async () => root.render(
    <QueryClientProvider client={new QueryClient()}><MemoryRouter><ProductionJobs /></MemoryRouter></QueryClientProvider>,
  ));
}
const page = () => document.body.textContent ?? '';
const button = (t: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(t)) as HTMLButtonElement | undefined;
const click = async (b: HTMLElement | undefined) => { expect(b).toBeDefined(); await act(async () => { b!.click(); }); };
// Radix tabs switch on mouse down.
const openTab = async (name: string) => {
  const t = [...document.body.querySelectorAll('[role="tab"]')].find((x) => x.textContent === name) as HTMLElement | undefined;
  expect(t).toBeDefined();
  await act(async () => { t!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); });
};
const SETTINGS = { contractor_id: OWNER, basics: { workingDays: [1, 2, 3, 4, 5], dayHours: 8 }, crew_counts: { crew3: 1 }, resources: [{ key: 'lift', ownership: 'owned', units: 1, hoursPerDay: 8, leadTimeDays: 0, name: 'Lift' }], cost_viewer_ids: [], send_unit_cost: false, isa_credentials: {}, active_profile: 'normal', profile_schedule: [] };

beforeEach(() => {
  state.userId = LEADER;
  state.status = LEADER_STATUS;
  state.packets = [packet()];
  state.estimates = [];
  state.jobber = false;
  state.def = null;
  state.settings = null;
  state.work.mockReset().mockResolvedValue({ ok: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Crew work', () => {
  it('is closed until the company publishes its rates', async () => {
    state.status = { ...LEADER_STATUS, published: false };
    await show();
    expect(page()).toContain('Crew work opens once your company publishes its rates');
  });

  it('a crew leader sees the job, its tasks and the customer, but no estimates and no price', async () => {
    await show();
    expect(page()).toContain('Removal #1001, Pat Example');
    expect(page()).toContain('crew leader you');
    expect(page()).not.toContain('Estimates');
    await click(button('Removal #1001'));
    expect(page()).toContain('Gate code: 1234');
    expect(page()).toContain('Arrange the utility disconnect (before the job)');
    expect(page()).not.toContain('$');
    await click(document.body.querySelector('[role="checkbox"]') as HTMLElement);
    expect(state.work).toHaveBeenCalledWith({ action: 'task', packetId: packet().id, taskKey: 'line_drop:1', status: 'done' });
  });

  it('starting the job and the actual hours go back with the time the packet was read', async () => {
    await show();
    await click(button('Removal #1001'));
    await click(button('Start the job'));
    expect(state.work).toHaveBeenCalledWith({ action: 'status', packetId: packet().id, status: 'in_progress', expectedUpdatedAt: packet().updated_at });
    await click(button('Finish with actual hours'));
    await click(button('Save and finish the job'));
    expect(state.work).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'actuals', packetId: packet().id, done: true, expectedUpdatedAt: packet().updated_at,
      actuals: expect.objectContaining({ headcount: 3, hours: 4, manHours: 12, equipment: { lift: 4 }, expenses: null, factors: [] }),
    }));
  });

  it("a crew leader can't work someone else's job", async () => {
    state.packets = [packet({ crew_leader_id: 'cccccccc-0000-0000-0000-000000000002' })];
    await show();
    await click(button('Removal #1001'));
    expect(button('Start the job')).toBeUndefined();
    expect(button('Finish with actual hours')).toBeUndefined();
    expect((document.body.querySelector('[role="checkbox"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the office sees who leads each job, what it waits on, and can get sub bids for subcontracted work', async () => {
    state.userId = OWNER;
    state.status = OFFICE_STATUS;
    state.packets = [
      packet({ id: 'dddddddd-0000-0000-0000-000000000002', package_key: 'stump', title: 'Stump grinding', depends_on: ['removal'], fulfillment: 'subcontractor', crew_leader_id: null, status: 'ready', planned_date: null }),
      packet(),
    ];
    await show();
    expect(page()).toContain('crew leader leader@example.test');
    expect(page()).toContain('After removal');
    await click(button('Stump grinding #1001'));
    expect(button('Get sub bids')).toBeDefined();
    expect(button('Cancel this job')).toBeDefined();
  });

  it('with Jobber connected, the office reads the jobs made from the quote and can link an unlinked packet', async () => {
    state.userId = OWNER;
    state.status = OFFICE_STATUS;
    state.jobber = true;
    state.packets = [packet({ jobber_job_id: null })];
    state.work.mockResolvedValue({ ok: true, outcome: 'quote #42 approved, already approved', jobs: [{ id: 'J1', jobNumber: '12' }] });
    await show();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await click(button('Removal #1001'));
    await click(button('Refresh from Jobber'));
    expect(state.work).toHaveBeenCalledWith({ action: 'refresh', packetId: packet().id });
    expect(document.body.querySelector('[aria-label="Link to a Jobber job"]')).not.toBeNull();
  });

  it('a linked packet shows its Jobber job, and crew leaders get no Jobber controls', async () => {
    state.jobber = true;
    state.packets = [packet({ jobber_job_id: 'J1', jobber_job_number: '12' })];
    await show();
    expect(page()).toContain('Jobber job #12');
    await click(button('Removal #1001'));
    expect(button('Refresh from Jobber')).toBeUndefined();
  });

  it('Capacity: the next 14 days of crew hours against what is booked, and a day for each job without one', async () => {
    state.userId = OWNER;
    state.status = OFFICE_STATUS;
    state.def = priceSheetCard();
    state.settings = SETTINGS;
    state.packets = [packet({ planned_date: null, status: 'ready' })];
    await show();
    await openTab('Capacity');
    expect(page()).toContain('Next 14 days');
    expect(page()).toContain('3-person climb crew');
    expect(page()).toContain('4 of 80 hours');
    expect(page()).toContain('Workload profile: Normal');
    await click(button('Plan for'));
    expect(state.work).toHaveBeenCalledWith(expect.objectContaining({ action: 'assign', packetId: packet().id, plannedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expectedUpdatedAt: packet().updated_at }));
  });

  it('Reports: estimated against actual hours from finished jobs', async () => {
    state.userId = OWNER;
    state.status = OFFICE_STATUS;
    state.packets = [packet({ status: 'done', actuals: { headcount: 3, hours: 5, manHours: 15, equipment: { lift: 5 }, factors: ['restricted rear access'] } })];
    await show();
    await openTab('Reports');
    expect(page()).toContain('1 finished job: 12 man-hours estimated, 15 actual (+25%).');
    expect(page()).toContain('Lift hours');
    expect(page()).toContain('No estimate won or lost yet.');
    expect(page()).toContain('No priced work yet.');
    expect(page()).not.toContain('none yet of');
  });

  it('crew leaders get neither Capacity nor Reports', async () => {
    await show();
    expect([...document.body.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Work']);
  });

  it('salespeople land on their estimates', async () => {
    state.userId = 'eeeeeeee-0000-0000-0000-000000000001';
    state.status = SALES_STATUS;
    const e: EstimateRow = { id: 'est-1', number: 1001, status: 'sent', customer: { name: 'Pat Example', address: '1 Test Lane' }, totals: { total: 1500 }, created_at: '2026-10-26T15:00:00Z', sent_at: null, approved_at: null };
    state.estimates = [e, { ...e, id: 'est-0', number: 1000, status: 'archived' }];
    await show();
    expect(page()).toContain('#1001, Pat Example');
    expect(page()).toContain('$1,500');
    expect(page()).not.toContain('#1000');
    expect(page()).toContain('New crew estimate');
  });
});
