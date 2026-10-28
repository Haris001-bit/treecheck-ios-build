// Large-company setup, PR4: crew estimates in Jobber (productionJobber.ts) against a small in-memory database, with
// Jobber stubbed by operation name as in the Jobber milestone's tests. Plus static checks on jobber-webhook's new
// branch and on production-jobber, the function it calls.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyQuoteEvent, checkEstimate, productionJobberOn, refreshJob, refreshVisit, sendEstimate, UNCERTAIN_TEXT,
} from '../../../supabase/functions/_shared/productionJobber';
import { SWITCHES_OFF } from '../../../supabase/functions/_shared/jobberSwitches';
import { extrasSwitchOn, jobberActuals, listRequests, probeExtras, saveServices, setupQuoteFields } from '../../../supabase/functions/_shared/productionJobberExtras';
import { priceSheetCard } from './testing/priceSheetFixture';
import { priceEstimate, type EstimateItemInput } from './estimate';

type Row = Record<string, unknown>;
const OWNER = 'aaaaaaaa-0000-0000-0000-000000000001';
const NOW = Date.parse('2026-10-26T15:00:00Z');
const ROOT = join(__dirname, '..', '..', '..');

// ---------------------------------------------------------------- a small supabase-js stand-in
function fakeDb(tables: Record<string, Row[]>) {
  let seq = 0;
  const parseList = (v: string) => v.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim());
  // PostgREST's or(): terms split on top-level commas; supports is.null, in.(..), eq, lt and and(...).
  const orMatch = (row: Row, expr: string): boolean => {
    const terms: string[] = [];
    let depth = 0, cur = '';
    for (const ch of expr) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { terms.push(cur); cur = ''; } else cur += ch;
    }
    if (cur) terms.push(cur);
    const one = (t: string): boolean => {
      if (t.startsWith('and(')) return splitAnd(t.slice(4, -1)).every(one);
      const [col, op, ...rest] = t.split('.');
      const v = rest.join('.');
      if (op === 'is') return v === 'null' ? row[col] == null : row[col] === v;
      if (op === 'in') return parseList(v).includes(String(row[col]));
      if (op === 'eq') return String(row[col]) === v;
      if (op === 'lt') return String(row[col] ?? '') < v;
      throw new Error(`or op ${op}`);
    };
    const splitAnd = (s: string) => {
      const out: string[] = []; let d = 0, c = '';
      for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(c); c = ''; } else c += ch; }
      if (c) out.push(c);
      return out;
    };
    return terms.some(one);
  };
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'update' | 'upsert' = 'select';
    let patch: Row = {};
    let upserts: Row[] = [];
    let limit = Infinity;
    const run = () => {
      if (op === 'upsert') {
        const made: Row[] = [];
        for (const r of upserts) {
          if (rows.some((x) => x.estimate_id === r.estimate_id && x.package_key === r.package_key)) continue;
          const row = { id: `pk-${++seq}`, ...r };
          rows.push(row);
          made.push(row);
        }
        return { data: made, error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
      if (op === 'update') hit.forEach((r) => Object.assign(r, patch));
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      order: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return q; },
      not: (c: string, o: string, v: unknown) => {
        filters.push((r) => (o === 'is' ? r[c] != null : !parseList(String(v)).includes(String(r[c]))));
        return q;
      },
      or: (expr: string) => { filters.push((r) => orMatch(r, expr)); return q; },
      limit: (n: number) => { limit = n; return q; },
      update: (p: Row) => { op = 'update'; patch = p; return q; },
      upsert: (r: Row[]) => { op = 'upsert'; upserts = r; return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, fail),
    };
    return q;
  };
  return { from };
}

// ---------------------------------------------------------------- Jobber stubbed by operation name
type Handler = (vars: Record<string, unknown>) => { status?: number; body: unknown };
function stubJobber(handlers: Record<string, Handler | Handler[]>) {
  const calls: { op: string; vars: Record<string, unknown> }[] = [];
  const used: Record<string, number> = {};
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body));
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? '?';
    calls.push({ op, vars: variables });
    const h = handlers[op];
    if (!h) throw new Error(`no stub for ${op}`);
    const handler = Array.isArray(h) ? h[Math.min(used[op] = (used[op] ?? -1) + 1, h.length - 1)] : h;
    const { status = 200, body } = handler(variables);
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}
const ok = (data: unknown) => ({ body: { data } });

// ---------------------------------------------------------------- fixtures
const ITEMS: EstimateItemInput[] = [
  { id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3', hours: 4 } },
  { id: 'b', serviceKey: 'stump', treeKey: 't1', kind: 'recommended', answers: { stump_diameter: 30 } },
];
const deps = { token: async () => 'tok', switches: async () => ({ ...SWITCHES_OFF, defaultProvince: 'OK', timezone: 'America/Chicago' }), now: () => NOW, budgetMs: 5_000 };

function world(over: Row = {}, items: EstimateItemInput[] = ITEMS) {
  const def = priceSheetCard();
  const priced = priceEstimate(def, items, { day: '2026-10-26' });
  const estimate: Row = {
    id: 'est-1', contractor_id: OWNER, status: 'draft', number: 1001,
    customer: { name: 'Pat Example', email: 'pat@example.test', phone: '405-555-0100', address: '1 Test Lane, Edmond, OK 73034' },
    trees: [{ key: 't1', label: 'Front oak', photos: [] }], work_items: priced.items, totals: { ...priced.totals, discountKey: null, paymentPlanKey: null },
    promised_window: null, rate_card_id: 'card-2', salesperson_id: null, jobber_client_id: null, jobber_property_id: null,
    jobber_quote_id: null, jobber_quote_number: null, quote_state: null, quote_claimed_at: null, sent_snapshot: null, ...over,
  };
  const tables: Record<string, Row[]> = {
    production_estimates: [estimate],
    production_rate_cards: [{ id: 'card-2', definition: def }],
    production_settings: [{ contractor_id: OWNER, send_unit_cost: false, isa_credentials: {}, crew_counts: {}, resources: [], basics: {} }],
    production_estimate_costs: [],
    production_packets: [],
    profiles: [],
    production_rollout: [{ id: 1, live: false, test_owner_ids: [OWNER] }],
    company_settings: [{ contractor_id: OWNER, operating_model: 'hybrid' }],
  };
  return { db: fakeDb(tables), tables, estimate: () => tables.production_estimates[0] };
}
const newClient = {
  TC_ClientSearch: () => ok({ clients: { nodes: [] } }),
  TC_ClientCreate: () => ok({ clientCreate: { client: { id: 'C1', clientProperties: { nodes: [{ id: 'P1' }] } }, userErrors: [] } }),
};
const quoteLines = (names: string[]) => names.map((name, i) => ({ id: `L${i}`, name, sortOrder: i + 1, optional: i > 0, recommended: i > 0 }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendEstimate', () => {
  it('makes one draft quote with a line per item, stores each line, and marks the estimate sent', async () => {
    const w = world();
    const calls = stubJobber({
      ...newClient,
      TC_QuoteCreate: () => ok({ quoteCreate: { quote: { id: 'Q1', quoteNumber: 42 }, userErrors: [] } }),
      TC_ProductionQuote: () => ok({ quote: { id: 'Q1', lineItems: { nodes: quoteLines(['Front oak: Tree removal', 'Front oak: Stump grinding']) } } }),
    });
    expect(await sendEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).toEqual({ state: 'sent', quoteId: 'Q1', quoteNumber: '42' });
    const attrs = calls.find((c) => c.op === 'TC_QuoteCreate')!.vars.attributes as { lineItems: Row[]; title: string };
    expect(attrs).toMatchObject({ clientId: 'C1', propertyId: 'P1', title: 'Tree removal and stump grinding' });
    expect(attrs).not.toHaveProperty('transitionQuoteTo');
    expect(attrs.lineItems.map((l) => [l.name, l.unitPrice, l.optional, l.recommended])).toEqual([
      ['Front oak: Tree removal', 1500, false, false], ['Front oak: Stump grinding', 450, true, true],
    ]);
    expect(w.estimate()).toMatchObject({
      status: 'sent', jobber_quote_id: 'Q1', jobber_quote_number: '42', jobber_client_id: 'C1', jobber_property_id: 'P1', quote_state: 'pending',
      sent_at: new Date(NOW).toISOString(),
    });
    expect((w.estimate().work_items as Row[]).map((i) => i.jobberLineId)).toEqual(['L0', 'L1']);
  });

  it('sends text-only lines once more as $0 lines when Jobber definitely refuses them', async () => {
    const w = world({ totals: { discountKey: null, paymentPlanKey: 'deposit_25' } });
    const calls = stubJobber({
      ...newClient,
      TC_QuoteCreate: [
        () => ok({ quoteCreate: { quote: null, userErrors: [{ message: 'Text only line items are not supported', path: ['lineItems'] }] } }),
        () => ok({ quoteCreate: { quote: { id: 'Q2', quoteNumber: 43 }, userErrors: [] } }),
      ],
      TC_ProductionQuote: () => ok({ quote: { id: 'Q2', lineItems: { nodes: [] } } }),
    });
    expect((await sendEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).state).toBe('sent');
    const creates = calls.filter((c) => c.op === 'TC_QuoteCreate').map((c) => (c.vars.attributes as { lineItems: Row[]; deposit?: Row }));
    expect(creates).toHaveLength(2);
    expect(creates[0].lineItems.some((l) => l.textOnly === true)).toBe(true);
    expect(creates[1].lineItems.some((l) => l.textOnly === true)).toBe(false);
    expect(creates[1].deposit).toEqual({ rate: 25, type: 'Percent' });
  });

  it('with the approval extras on, adds the Jobber items, salesperson, request and fields, and drops them once if Jobber refuses', async () => {
    const w = world({ salesperson_id: 'u-sam', customer: { name: 'Pat Example', address: '1 Test Lane, Edmond, OK 73034', jobberRequestId: 'R1' } });
    w.tables.production_rollout[0].jobber_extras = true;
    w.tables.production_settings[0].jobber = { productIds: { removal: 'PS1' }, userIds: { 'u-sam': 'J2' }, fieldIds: { link: 'F1', priority: 'F5' } };
    const calls = stubJobber({
      TC_ExtrasRequest: () => ok({ request: { id: 'R1', requestStatus: 'new', client: { id: 'C7' }, property: { id: 'P7' } } }),
      TC_ClientProperties: () => ok({ client: { id: 'C7', clientProperties: { nodes: [{ id: 'P7', address: { street1: '1 Test Lane', street2: '', city: 'Edmond', province: 'OK', postalCode: '73034' } }] } } }),
      TC_QuoteCreate: [
        () => ok({ quoteCreate: { quote: null, userErrors: [{ message: 'Salesperson not found', path: ['salespersonId'] }] } }),
        () => ok({ quoteCreate: { quote: { id: 'Q3', quoteNumber: 45 }, userErrors: [] } }),
      ],
      TC_ProductionQuote: () => ok({ quote: { id: 'Q3', lineItems: { nodes: [] } } }),
    });
    expect((await sendEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).state).toBe('sent');
    const [first, second] = calls.filter((c) => c.op === 'TC_QuoteCreate').map((c) => c.vars.attributes as Row & { lineItems: Row[] });
    expect(first).toMatchObject({ clientId: 'C7', propertyId: 'P7', requestId: 'R1', salespersonId: 'J2' });
    expect(first.lineItems.map((l) => l.productOrServiceId)).toEqual(['PS1', undefined]);
    expect(first.customFields).toEqual([
      { customFieldConfigurationId: 'F1', valueLink: { text: 'Estimate #1001', url: 'https://app.treecheck.ai/dashboard/instant-estimator/crew/est-1' } },
      { customFieldConfigurationId: 'F5', valueText: 'Normal' },
    ]);
    for (const k of ['requestId', 'salespersonId', 'customFields']) expect(second).not.toHaveProperty(k);
    expect(second.lineItems.some((l) => 'productOrServiceId' in l)).toBe(false);
  });

  it('with the approval extras off, reads no request and adds nothing, even for an estimate started from one', async () => {
    const w = world({ customer: { name: 'Pat Example', address: '1 Test Lane, Edmond, OK 73034', jobberRequestId: 'R1' } });
    w.tables.production_settings[0].jobber = { productIds: { removal: 'PS1' } };
    const calls = stubJobber({
      ...newClient,
      TC_QuoteCreate: () => ok({ quoteCreate: { quote: { id: 'Q4', quoteNumber: 46 }, userErrors: [] } }),
      TC_ProductionQuote: () => ok({ quote: { id: 'Q4', lineItems: { nodes: [] } } }),
    });
    expect((await sendEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).state).toBe('sent');
    expect(calls.map((c) => c.op)).not.toContain('TC_ExtrasRequest');
    const attrs = calls.find((c) => c.op === 'TC_QuoteCreate')!.vars.attributes as Row & { lineItems: Row[] };
    expect(attrs).not.toHaveProperty('requestId');
    expect(attrs.lineItems.some((l) => 'productOrServiceId' in l)).toBe(false);
  });

  it('never sends again by itself after an unconfirmed quote, and Check Jobber adopts the quote it finds', async () => {
    const w = world();
    stubJobber({ ...newClient, TC_QuoteCreate: () => ({ status: 502, body: {} }) });
    expect(await sendEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).toEqual({ state: 'uncertain', error: UNCERTAIN_TEXT });
    expect(w.estimate()).toMatchObject({ status: 'draft', quote_state: 'uncertain', jobber_client_id: 'C1', jobber_quote_id: null });

    const again = stubJobber({});
    expect((await sendEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).state).toBe('uncertain');
    expect(again).toHaveLength(0);

    const title = (w.estimate().sent_snapshot as { title: string }).title;
    const check = stubJobber({
      TC_ProductionClientQuotes: () => ok({ quotes: { nodes: [{ id: 'QX', quoteNumber: 7, title: 'Something else' }, { id: 'Q9', quoteNumber: 44, title }] } }),
      TC_ProductionQuote: () => ok({ quote: { id: 'Q9', lineItems: { nodes: quoteLines(['Front oak: Tree removal', 'Front oak: Stump grinding']) } } }),
    });
    expect(await checkEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).toEqual({ state: 'sent', quoteId: 'Q9', quoteNumber: '44' });
    expect(check[0].vars).toMatchObject({ clientId: 'C1' });
    expect(w.estimate()).toMatchObject({ status: 'sent', jobber_quote_id: 'Q9', quote_state: 'pending' });
  });

  it('Check Jobber frees the estimate to send again when Jobber holds no such quote', async () => {
    const w = world({ quote_state: 'uncertain', jobber_client_id: 'C1', quote_claimed_at: new Date(NOW - 60_000).toISOString(), sent_snapshot: { title: 'Tree removal and stump grinding', plan: { refs: [], lineItems: [] } } });
    stubJobber({ TC_ProductionClientQuotes: () => ok({ quotes: { nodes: [] } }) });
    expect(await checkEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).toEqual({ state: 'not_found' });
    expect(w.estimate().quote_state).toBe('not_created');
  });

  it('backs off while another send holds the estimate, and refuses unfinished or address-less estimates before Jobber', async () => {
    const busy = world({ quote_state: 'creating', quote_claimed_at: new Date(NOW - 60_000).toISOString() });
    const calls = stubJobber({});
    expect(await sendEstimate(busy.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).toEqual({ state: 'busy' });

    const unfinished = world({}, [{ id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3' } }]);
    expect(await sendEstimate(unfinished.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).toMatchObject({ state: 'invalid', error: expect.stringContaining('Finish this first: Tree removal') });

    const noStreet = world({ customer: { name: 'Pat Example', address: 'Edmond' } });
    expect(await sendEstimate(noStreet.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).toEqual({ state: 'invalid', error: "Add the customer's street address first." });
    expect(calls).toHaveLength(0);

    const notConnected = world();
    expect(await sendEstimate(notConnected.db, { ownerId: OWNER, estimateId: 'est-1' }, { ...deps, token: async () => null })).toEqual({ state: 'not_connected' });
    expect(notConnected.estimate().quote_state).toBe('not_created');
  });
});

describe('Jobber events', () => {
  const sent = () => {
    const w = world({ status: 'sent', jobber_quote_id: 'Q1', jobber_quote_number: '42', quote_state: 'pending' });
    (w.estimate().work_items as Row[]).forEach((i, n) => { i.jobberLineId = `L${n}`; });
    return w;
  };

  it('an approval in Jobber makes the packets with the options the customer took; a second event changes nothing', async () => {
    const w = sent();
    const quote = (status: string) => ok({ quote: { id: 'Q1', quoteNumber: 42, quoteStatus: status, lineItems: { nodes: quoteLines(['x', 'y']) }, approvedLines: { nodes: [{ id: 'L0' }] }, jobs: { nodes: [] } } });
    stubJobber({ TC_ProductionQuote: () => quote('approved') });
    expect(await applyQuoteEvent(w.db, OWNER, 'Q1', deps)).toBe('approved in Jobber (quote #42), 1 packet made');
    expect(w.estimate()).toMatchObject({ status: 'approved', approved_via: 'jobber', approved_by: null });
    expect(w.tables.production_packets.map((p) => p.package_key)).toEqual(['removal']);
    expect(await applyQuoteEvent(w.db, OWNER, 'Q1', deps)).toBe('quote #42 approved, already approved');
    expect(w.tables.production_packets).toHaveLength(1);
  });

  it('changes requested and archive follow the quote; a quote that is not a crew estimate is left alone without reading Jobber', async () => {
    const w = sent();
    stubJobber({ TC_ProductionQuote: () => ok({ quote: { id: 'Q1', quoteNumber: 42, quoteStatus: 'changes_requested' } }) });
    expect(await applyQuoteEvent(w.db, OWNER, 'Q1', deps)).toBe('changes requested on quote #42');
    expect(w.estimate().status).toBe('changes_requested');
    stubJobber({ TC_ProductionQuote: () => ok({ quote: { id: 'Q1', quoteNumber: 42, quoteStatus: 'archived' } }) });
    expect(await applyQuoteEvent(w.db, OWNER, 'Q1', deps)).toBe('quote #42 archived in Jobber, marked lost');
    expect(w.estimate()).toMatchObject({ status: 'lost', lost_reason: 'Archived in Jobber' });

    const calls = stubJobber({});
    expect(await applyQuoteEvent(w.db, OWNER, 'Q-OTHER', deps)).toBe('not a crew estimate');
    expect(await applyQuoteEvent(w.db, 'bbbbbbbb-0000-0000-0000-000000000009', 'Q1', deps)).toBe('not a crew estimate');
    expect(calls).toHaveLength(0);
  });

  it('a job made from the quote links the packets, brings back the visit day, and marks them done when Jobber closes it', async () => {
    const w = sent();
    w.estimate().status = 'approved';
    w.tables.production_packets.push(
      { id: 'p1', contractor_id: OWNER, estimate_id: 'est-1', package_key: 'removal', status: 'ready', jobber_job_id: null, scope: [{ tree: 'Front oak', service: 'Tree removal' }] },
      { id: 'p2', contractor_id: OWNER, estimate_id: 'est-1', package_key: 'stump', status: 'planned', jobber_job_id: null, scope: [{ tree: 'Front oak', service: 'Stump grinding' }] },
    );
    const job = (over: Row) => ok({ job: { id: 'J1', jobNumber: 12, jobStatus: 'active', completedAt: null, quote: { id: 'Q1', jobs: { nodes: [{ id: 'J1' }] } }, visitsInfo: { incompleteTotal: 1 }, visits: { nodes: [{ id: 'V1', startAt: '2026-11-03T14:00:00-06:00', isComplete: false }] }, lineItems: { nodes: [] }, ...over } });
    stubJobber({ TC_ProductionJob: () => job({}) });
    expect(await refreshJob(w.db, OWNER, 'J1', deps)).toBe('job #12: 2 packets linked, scheduled 2026-11-03');
    expect(w.tables.production_packets.map((p) => [p.jobber_job_id, p.jobber_job_number, p.scheduled_date, p.status])).toEqual([
      ['J1', '12', '2026-11-03', 'scheduled'], ['J1', '12', '2026-11-03', 'scheduled'],
    ]);

    stubJobber({ TC_ProductionJob: () => job({ jobStatus: 'requires_invoicing', completedAt: '2026-11-03T22:00:00Z', visitsInfo: { incompleteTotal: 0 }, visits: { nodes: [{ id: 'V1', startAt: '2026-11-03T14:00:00-06:00', isComplete: true }] } }) });
    expect(await refreshJob(w.db, OWNER, 'J1', deps)).toBe('job #12: 2 packets linked, scheduled 2026-11-03, 2 done (actual hours still to enter)');
    expect(w.tables.production_packets.map((p) => [p.status, p.completed_at])).toEqual([['done', '2026-11-03T22:00:00Z'], ['done', '2026-11-03T22:00:00Z']]);

    stubJobber({ TC_ProductionVisit: () => ok({ visit: { id: 'V1', job: { id: 'J1' } } }), TC_ProductionJob: () => job({}) });
    expect(await refreshVisit(w.db, OWNER, 'V1', deps)).toContain('job #12');

    stubJobber({ TC_ProductionJob: () => ok({ job: null }) });
    expect(await refreshJob(w.db, OWNER, 'J1', deps)).toBe('job deleted in Jobber, 2 packets unlinked');
    expect(w.tables.production_packets.every((p) => p.jobber_job_id === null)).toBe(true);
  });

  it("with the approval extras on, Jobber's time sheets become the suggested hours when it closes the job, never over saved ones", async () => {
    const w = sent();
    w.estimate().status = 'approved';
    w.tables.production_packets.push(
      { id: 'p1', contractor_id: OWNER, estimate_id: 'est-1', package_key: 'removal', status: 'scheduled', jobber_job_id: 'J1', est_man_hours: 12, actuals: null, scope: [{ tree: 'Front oak', service: 'Tree removal' }] },
      { id: 'p2', contractor_id: OWNER, estimate_id: 'est-1', package_key: 'stump', status: 'scheduled', jobber_job_id: 'J1', est_man_hours: 4, actuals: { headcount: 2, hours: 2.5, manHours: 5 }, scope: [{ tree: 'Front oak', service: 'Stump grinding' }] },
    );
    const closed = () => ok({ job: { id: 'J1', jobNumber: 12, jobStatus: 'requires_invoicing', completedAt: '2026-11-03T22:00:00Z', quote: { id: 'Q1', jobs: { nodes: [{ id: 'J1' }] } }, visitsInfo: { incompleteTotal: 0 }, visits: { nodes: [{ id: 'V1', startAt: '2026-11-03T14:00:00-06:00', isComplete: true }] }, lineItems: { nodes: [] } } });
    const time = () => ok({ job: {
      id: 'J1', jobNumber: 12,
      timeSheetEntries: { totalCount: 4, nodes: [
        { id: 't1', finalDuration: 4 * 3600, ticking: false, user: { id: 'U1' } }, { id: 't2', finalDuration: 4 * 3600, ticking: false, user: { id: 'U2' } },
        { id: 't3', finalDuration: 4 * 3600, ticking: false, user: { id: 'U3' } }, { id: 't4', finalDuration: 600, ticking: true, user: { id: 'U1' } },
      ] },
      expenses: { totalCount: 1, nodes: [{ id: 'x1', total: 80 }] },
    } });

    // Off: Jobber's time sheets aren't read.
    const off = stubJobber({ TC_ProductionJob: closed, TC_ExtrasJobTime: time });
    expect(await refreshJob(w.db, OWNER, 'J1', deps)).toBe('job #12: 2 packets linked, scheduled 2026-11-03, 2 done (actual hours still to enter)');
    expect(off.map((c) => c.op)).not.toContain('TC_ExtrasJobTime');
    expect(w.tables.production_packets[0].actuals).toBeNull();

    w.tables.production_rollout[0].jobber_extras = true;
    stubJobber({ TC_ProductionJob: closed, TC_ExtrasJobTime: time });
    expect(await refreshJob(w.db, OWNER, 'J1', deps)).toBe("job #12: 2 packets linked, scheduled 2026-11-03, hours from Jobber's time sheets on 1 to check");
    // p1 is 12 of the 16 estimated man-hours: 75% of 12 logged hours and of the $80 expense; the running timer is left out.
    expect((w.tables.production_packets[0].actuals as Row).fromJobber).toEqual({
      headcount: 3, hours: 3, manHours: 9, expenses: 60, entries: 3, people: 3, running: 1, share: 0.75, partial: false, jobNumber: '12', readAt: new Date(NOW).toISOString(),
    });
    expect((w.tables.production_packets[0].actuals as Row).manHours).toBeUndefined();
    expect(w.tables.production_packets[1].actuals).toEqual({ headcount: 2, hours: 2.5, manHours: 5 });

    // Read on request (Fill from Jobber), nothing saved; a job with no crew job linked, or gone from Jobber.
    stubJobber({ TC_ExtrasJobTime: time });
    const read = await jobberActuals(w.db, OWNER, 'J1', { token: async () => 'tok' }, NOW);
    expect(read.ok && Object.keys(read.byPacket).sort()).toEqual(['p1', 'p2']);
    expect(read.ok && read.byPacket.p2).toMatchObject({ manHours: 3, headcount: 3, hours: 1, expenses: 20, share: 0.25 });
    expect(await jobberActuals(w.db, OWNER, 'J-OTHER', { token: async () => 'tok' }, NOW)).toEqual({ ok: true, byPacket: {} });
    stubJobber({ TC_ExtrasJobTime: () => ok({ job: null }) });
    expect(await jobberActuals(w.db, OWNER, 'J1', { token: async () => 'tok' }, NOW)).toEqual({ ok: false, error: 'That job is no longer in Jobber.' });
  });

  it('a converted quote whose job arrives first is approved before its packets are linked', async () => {
    const w = sent();
    stubJobber({
      TC_ProductionJob: () => ok({ job: { id: 'J1', jobNumber: 12, jobStatus: 'active', quote: { id: 'Q1', jobs: { nodes: [{ id: 'J1' }] } }, visitsInfo: { incompleteTotal: 0 }, visits: { nodes: [] }, lineItems: { nodes: [] } } }),
      TC_ProductionQuote: () => ok({ quote: { id: 'Q1', quoteNumber: 42, quoteStatus: 'converted', lineItems: { nodes: quoteLines(['x', 'y']) }, approvedLines: { nodes: [{ id: 'L0' }, { id: 'L1' }] }, jobs: { nodes: [{ id: 'J1' }] } } }),
    });
    expect(await refreshJob(w.db, OWNER, 'J1', deps)).toBe('job #12: 2 packets linked');
    expect(w.estimate().status).toBe('approved');
    expect(w.tables.production_packets.map((p) => p.jobber_job_id)).toEqual(['J1', 'J1']);
  });

  it('only companies in the rollout that run their own crews, and never with the production kill switch', async () => {
    const w = world();
    expect(await productionJobberOn(w.db, OWNER)).toBe(true);
    expect(await productionJobberOn(w.db, 'bbbbbbbb-0000-0000-0000-000000000009')).toBe(false);
    w.tables.company_settings[0].operating_model = 'subcontractors';
    expect(await productionJobberOn(w.db, OWNER)).toBe(false);
    w.tables.company_settings[0].operating_model = 'employees';
    vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'TC_PRODUCTION_KILL' ? '1' : undefined) } });
    expect(await productionJobberOn(w.db, OWNER)).toBe(false);
    expect(await sendEstimate(w.db, { ownerId: OWNER, estimateId: 'est-1' }, deps)).toEqual({ state: 'off' });
  });
});

describe('the hand-off from jobber-webhook', () => {
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  it("runs after the Pulse part in its own try, and only adds to the logged outcome", () => {
    const text = read('supabase/functions/jobber-webhook/index.ts');
    const body = text.slice(text.indexOf('async function processEvent('));
    const pulse = body.indexOf('processPulse(admin, ownerId, topic, itemId)');
    const branch = body.indexOf('production = await productionEvent(');
    expect(pulse).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(pulse);
    const block = body.slice(body.lastIndexOf('try {', branch), body.indexOf('}', body.indexOf('catch (e)', branch)) + 1);
    expect(block).not.toContain('errors.push');
    expect(body.indexOf('processed: errors.length === 0')).toBeGreaterThan(branch);
  });

  it('asks production-jobber only after finding a crew estimate in Jobber for the company, with the service key', () => {
    const text = read('supabase/functions/jobber-webhook/index.ts');
    const fn = text.slice(text.indexOf('async function productionEvent('), text.indexOf('async function routeOwner('));
    expect(fn.indexOf('from("production_estimates")')).toBeGreaterThan(0);
    expect(fn.indexOf('if (error || !data?.length) return null;')).toBeLessThan(fn.indexOf('/functions/v1/production-jobber'));
    expect(fn).toContain('Authorization: `Bearer ${SERVICE}`');
  });

  it("leaves the webhook's import graph without any production file", () => {
    const manifest = JSON.parse(read('docs/jobber-sync/import-graph.json'));
    const webhook = (manifest.functions ?? manifest)['jobber-webhook'] as string[];
    expect(webhook.some((f) => /production/i.test(f))).toBe(false);
  });

  it('production-jobber refuses anyone but the service key before any work, and honours both kill switches', () => {
    const text = read('supabase/functions/production-jobber/index.ts');
    const refuse = text.indexOf('if (!SERVICE || bearer !== SERVICE) return json(');
    const kill = text.indexOf('if (killSwitchOn() || productionKillOn())');
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(kill);
    expect(kill).toBeLessThan(text.indexOf('createClient(SUPABASE_URL, SERVICE'));
    expect(text.indexOf('productionJobberOn(admin, ownerId)')).toBeLessThan(text.indexOf('applyQuoteEvent(admin'));
  });
});

describe('the approval extras in setup (productionJobberExtras.ts)', () => {
  const extrasDeps = { token: async () => 'tok' };
  const denied = () => ({ body: { errors: [{ message: 'Access denied: missing scope' }] } });

  it('says which permissions the connection has, and saves it', async () => {
    const w = world();
    stubJobber({
      TC_ExtrasProbeUsers: () => ok({ users: { nodes: [{ id: 'J1' }] } }),
      TC_ExtrasProbeRequests: denied,
      TC_ExtrasProbeProducts: () => ok({ products: { nodes: [] } }),
      TC_ExtrasProbeFields: () => ({ status: 503, body: {} }),
      TC_ExtrasProbeTimeSheets: () => ok({ timeSheetEntries: { nodes: [] } }),
      TC_ExtrasProbeExpenses: denied,
    });
    const probe = await probeExtras(w.db, OWNER, extrasDeps, NOW);
    expect(probe).toEqual({
      connected: true, users: true, requests: false, products: true, customFields: null, timeSheets: true, expenses: false, checkedAt: new Date(NOW).toISOString(),
    });
    expect((w.tables.production_settings[0].jobber as Row).probe).toEqual(probe);
    expect(await probeExtras(w.db, OWNER, { token: async () => null }, NOW)).toMatchObject({ connected: false, users: null });
  });

  it('adds the five quote fields once: reuses its own, brings back an archived one, makes the rest transferable and read-only', async () => {
    const w = world();
    const calls = stubJobber({
      TC_ExtrasQuoteFields: () => ok({ customFieldConfigurations: { nodes: [
        { id: 'F1', name: 'TreeCheck link', archived: false, valueType: 'LINK' },
        { id: 'F5', name: 'Priority', archived: true, valueType: 'TEXT' },
      ] } }),
      TC_ExtrasFieldUnarchive: () => ok({ customFieldConfigurationUnarchive: { customFieldConfigurations: [{ __typename: 'CustomFieldConfigurationText' }], userErrors: [] } }),
      TC_ExtrasFieldCreateText: (v) => ok({ customFieldConfigurationCreateText: { customFieldConfiguration: { id: `N-${(v.input as Row).name}` }, userErrors: [] } }),
    });
    expect(await setupQuoteFields(w.db, OWNER, extrasDeps)).toEqual({ ok: true, created: 3, reused: 2 });
    expect(calls.find((c) => c.op === 'TC_ExtrasFieldUnarchive')!.vars).toEqual({ ids: ['F5'] });
    expect(calls.filter((c) => c.op === 'TC_ExtrasFieldCreateText').map((c) => c.vars.input)).toEqual(
      ['Production class', 'Required resources', 'Operational flags'].map((name) => ({ appliesTo: 'ALL_QUOTES', name, transferable: true, readOnly: true })),
    );
    expect((w.tables.production_settings[0].jobber as Row).fieldIds).toEqual({
      link: 'F1', production_class: 'N-Production class', resources: 'N-Required resources', flags: 'N-Operational flags', priority: 'F5',
    });
  });

  it('keeps only real services and real Jobber items when saving, and only open requests when listing', async () => {
    const w = world();
    stubJobber({
      TC_ExtrasProducts: () => ok({ products: { nodes: [{ id: 'PS1', name: 'Tree removal' }], pageInfo: { hasNextPage: false, endCursor: null } } }),
      TC_ExtrasRequests: () => ok({ requests: { nodes: [
        { id: 'R1', requestStatus: 'new', createdAt: '2026-10-25T10:00:00Z', title: 'Big oak' },
        { id: 'R2', requestStatus: 'converted', createdAt: '2026-10-26T10:00:00Z', title: 'Done' },
      ] } }),
    });
    expect(await saveServices(w.db, OWNER, priceSheetCard(), { removal: 'PS1', stump: 'MADE-UP', nonsense: 'PS1' }, extrasDeps)).toEqual({ ok: true, saved: 1 });
    expect((w.tables.production_settings[0].jobber as Row).productIds).toEqual({ removal: 'PS1' });
    const listed = await listRequests(w.db, OWNER, extrasDeps, NOW);
    expect(listed.ok && listed.requests.map((r) => r.id)).toEqual(['R1']);
  });

  it('stays off until the rollout switches it on', async () => {
    const w = world();
    expect(await extrasSwitchOn(w.db)).toBe(false);
    w.tables.production_rollout[0].jobber_extras = true;
    expect(await extrasSwitchOn(w.db)).toBe(true);
  });
});
