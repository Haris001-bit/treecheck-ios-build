// Large-company setup: the Jobber parts that wait on Jobber's approval (services, team, requests, quote fields).
import { describe, expect, it } from 'vitest';
import { priceSheetCard } from './testing/priceSheetFixture';
import { priceEstimate, type EstimateItemInput } from './estimate';
import { quoteCreateAttributes, quotePlan } from './quoteLines';
import {
  actualsFromJobber, actualsFromJobberNote, jobShares, matchServices, matchTeam, openRequests, quoteFieldValues, requestCustomer, withQuoteExtras,
  type JobberRequestNode,
} from './jobberExtras';
import type { RateCardDefinition } from './rules';

const DAY = '2026-10-26';
const ITEMS: EstimateItemInput[] = [
  { id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3', hours: 4, access: 'rear_yard' } },
  { id: 'b', serviceKey: 'stump', treeKey: 't1', kind: 'recommended', answers: { stump_diameter: 30 } },
  { id: 'c', serviceKey: 'planting', treeKey: null, kind: 'optional', answers: { type: 'shade', size: '3in' } },
];
const priced = (def: RateCardDefinition, items = ITEMS) => priceEstimate(def, items, { day: DAY }).items;

describe('matchServices', () => {
  it('matches by name, ignoring case, "&" and plurals; keeps the first visible of twins; lists what no service uses', () => {
    const def = priceSheetCard();
    const r = matchServices(def, [
      { id: 'p1', name: 'TREE REMOVAL' },
      { id: 'p2', name: 'Stump Grindings', visible: false },
      { id: 'p3', name: 'stump grinding' },
      { id: 'p4', name: 'Gutter cleaning' },
    ]);
    const by = Object.fromEntries(r.matches.map((m) => [m.serviceKey, m]));
    expect(by.removal).toMatchObject({ productId: 'p1', how: 'name' });
    expect(by.stump).toMatchObject({ productId: 'p3', how: 'name' });
    expect(by.planting).toMatchObject({ productId: null, how: 'none' });
    expect(r.duplicates).toEqual([{ name: 'stump grinding', keptId: 'p3', otherIds: ['p2'] }]);
    expect(r.unused.map((p) => p.id)).toEqual(['p4']);
  });

  it('keeps a saved choice while that Jobber item exists', () => {
    const def = priceSheetCard();
    const products = [{ id: 'p1', name: 'Tree removal' }, { id: 'p9', name: 'Removal, large' }];
    expect(matchServices(def, products, { removal: 'p9' }).matches.find((m) => m.serviceKey === 'removal')).toMatchObject({ productId: 'p9', how: 'saved' });
    expect(matchServices(def, products, { removal: 'gone' }).matches.find((m) => m.serviceKey === 'removal')).toMatchObject({ productId: 'p1', how: 'name' });
  });
});

describe('matchTeam', () => {
  it('matches a saved choice, then the same email, then one exact name, and lists who is only on one side', () => {
    const r = matchTeam(
      [
        { id: 'u1', name: 'Owner Olive', email: 'olive@example.test' },
        { id: 'u2', name: 'Sam Seller', email: 'SAM@example.test' },
        { id: 'u3', name: 'Cora Crew', email: null },
        { id: 'u4', name: 'Pat Same', email: null },
      ],
      [
        { id: 'j1', name: 'Olive O.', email: 'other@example.test' },
        { id: 'j2', name: 'Samuel Seller', email: 'sam@example.test' },
        { id: 'j3', name: 'cora  crew', email: 'cora@example.test' },
        { id: 'j4', name: 'Pat Same', email: 'p1@example.test' },
        { id: 'j5', name: 'Pat Same', email: 'p2@example.test' },
      ],
      { u1: 'j1' },
    );
    expect(r.matched.map((m) => [m.userId, m.jobberUserId, m.how])).toEqual([['u1', 'j1', 'saved'], ['u2', 'j2', 'email'], ['u3', 'j3', 'name']]);
    expect(r.onlyInTreeCheck.map((m) => m.id)).toEqual(['u4']);
    expect(r.onlyInJobber.map((u) => u.id)).toEqual(['j4', 'j5']);
  });
});

describe('requests', () => {
  const node = (id: string, status: string, createdAt: string, extra: Partial<JobberRequestNode> = {}): JobberRequestNode => ({
    id, requestStatus: status, createdAt, title: `Request ${id}`,
    client: { id: `c${id}`, name: 'Client Name', emails: [{ address: 'client@example.test' }], phones: [{ number: '555-0100' }] },
    property: { id: `p${id}`, address: { street1: '1 Oak St', street2: '', city: 'Edmond', province: 'OK', postalCode: '73034' } },
    ...extra,
  });

  it("starts the estimate's customer from the request's own contact, then its client's", () => {
    expect(requestCustomer(node('1', 'new', '2026-10-20T10:00:00Z', { contactName: 'Rae Request', phone: '555-0199' }))).toEqual({
      name: 'Rae Request', phone: '555-0199', email: 'client@example.test', address: '1 Oak St, Edmond, OK 73034', jobberRequestId: '1',
    });
  });

  it('lists only requests still waiting on an estimate, newest first', () => {
    const rows = openRequests([
      node('1', 'new', '2026-10-20T10:00:00Z'), node('2', 'converted', '2026-10-25T10:00:00Z'),
      node('3', 'OVERDUE', '2026-10-22T10:00:00Z'), node('4', 'archived', '2026-10-26T10:00:00Z'), node('5', 'assessment_completed', '2026-10-21T10:00:00Z'),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['3', '5', '1']);
    expect(rows[0]).toMatchObject({ title: 'Request 3', status: 'overdue' });
  });
});

describe('the quote fields', () => {
  it("writes the link, the crews and their hours, the equipment, the flags and the playbooks' priority", () => {
    const def = priceSheetCard();
    def.playbooks.push({
      key: 'rear', name: 'Rear yard', when: { flag: { name: 'access', value: 'REAR' } },
      actions: [{ kind: 'scheduling', class: 'priority' }, { kind: 'resource', resource: 'mini_skid', mode: 'rent' }],
    });
    const v = quoteFieldValues(def, priced(def), { estimateUrl: 'https://app.treecheck.ai/x', estimateNumber: 7, equipmentNames: { stump_grinder: 'Stump grinder' } });
    expect(v).toEqual({
      link: { link: { text: 'Estimate #7', url: 'https://app.treecheck.ai/x' } },
      production_class: { text: '3-person climb crew, 4 h; 2-person production, 1.5 h' },
      resources: { text: 'Stump grinder, mini skid (rent)' },
      flags: { text: 'access: rear' },
      priority: { text: 'Priority' },
    });
  });

  it('says None when there is nothing to list', () => {
    const def = priceSheetCard();
    const v = quoteFieldValues(def, priced(def, [ITEMS[2]]), { estimateUrl: 'u', estimateNumber: 1 });
    expect(v.production_class).toEqual({ text: 'No crew time' });
    expect(v.resources).toEqual({ text: 'None' });
    expect(v.flags).toEqual({ text: 'None' });
    expect(v.priority).toEqual({ text: 'Normal' });
  });
});

describe('withQuoteExtras', () => {
  it("adds each work line's Jobber item, the salesperson, the request and the five fields", () => {
    const def = priceSheetCard();
    def.policies.consultation = { showSalesperson: true, showIsa: true, showWorkWindow: true, showNextSteps: true, text: 'Consultation.', nextStepsText: '' };
    const items = priced(def);
    const plan = quotePlan(def, { items, trees: [{ key: 't1', label: 'Front oak' }] });
    const base = quoteCreateAttributes(plan, 'client-1', 'prop-1');
    const values = quoteFieldValues(def, items, { estimateUrl: 'https://app.treecheck.ai/x', estimateNumber: 7 });
    const out = withQuoteExtras(base, plan, items, {
      productIds: { removal: 'p1', planting: 'p3' }, salespersonId: 'j2', requestId: 'r1',
      fieldIds: { link: 'f1', priority: 'f5' }, fieldValues: values,
    });
    const lines = out.lineItems as Record<string, unknown>[];
    expect(lines.map((l) => [l.name, l.productOrServiceId])).toEqual([
      ['Consultation', undefined], ['Front oak: Tree removal', 'p1'], ['Front oak: Stump grinding', undefined], ['Planting', 'p3'],
    ]);
    expect(out).toMatchObject({ clientId: 'client-1', propertyId: 'prop-1', salespersonId: 'j2', requestId: 'r1' });
    expect(out.customFields).toEqual([
      { customFieldConfigurationId: 'f1', valueLink: { text: 'Estimate #7', url: 'https://app.treecheck.ai/x' } },
      { customFieldConfigurationId: 'f5', valueText: 'Normal' },
    ]);
    expect(base.lineItems).toBe(plan.lineItems);
  });

  it('adds nothing it has no value for', () => {
    const def = priceSheetCard();
    const items = priced(def);
    const plan = quotePlan(def, { items, trees: [] });
    const base = quoteCreateAttributes(plan, 'c', 'p');
    const out = withQuoteExtras(base, plan, items, { productIds: {}, salespersonId: null, requestId: null, fieldIds: {}, fieldValues: null });
    expect(Object.keys(out).sort()).toEqual(Object.keys(base).sort());
    expect((out.lineItems as Record<string, unknown>[]).some((l) => 'productOrServiceId' in l)).toBe(false);
  });
});

describe("actual hours from Jobber's time sheets", () => {
  const READ = '2026-11-03T23:00:00.000Z';
  const entry = (id: string, user: string | null, hours: number, ticking = false) => ({ id, finalDuration: Math.round(hours * 3600), ticking, user: user ? { id: user } : null });

  it('counts finished time only: man-hours, the people who logged it, hours on site per person and the expenses', () => {
    const a = actualsFromJobber(
      [entry('a', 'U1', 5.1), entry('b', 'U2', 5), entry('c', 'U1', 0.9), entry('d', 'U3', 2, true), entry('e', 'U4', 0)],
      [{ id: 'x', total: 45.5 }, { id: 'y', total: null }, { id: 'z', total: 0 }],
      { readAt: READ, jobNumber: '7' },
    );
    expect(a).toEqual({ headcount: 2, hours: 5.5, manHours: 11, expenses: 45.5, entries: 3, people: 2, running: 1, share: 1, partial: false, jobNumber: '7', readAt: READ });
  });

  it("splits a Jobber job's time between its crew jobs by estimated man-hours, equally when none has an estimate", () => {
    expect(jobShares([{ id: 'r', estManHours: 12 }, { id: 's', estManHours: 4 }])).toEqual({ r: 0.75, s: 0.25 });
    expect(jobShares([{ id: 'r', estManHours: 0 }, { id: 's', estManHours: null }])).toEqual({ r: 0.5, s: 0.5 });
    const part = actualsFromJobber([entry('a', 'U1', 8), entry('b', 'U2', 8)], [{ id: 'x', total: 100 }], { share: 0.25, readAt: READ });
    expect(part).toMatchObject({ manHours: 4, headcount: 2, hours: 2, expenses: 25, share: 0.25 });
  });

  it('gives nothing when Jobber has no finished time and no expense, and counts time with no person as one', () => {
    expect(actualsFromJobber([entry('a', 'U1', 3, true)], [], { readAt: READ })).toBeNull();
    expect(actualsFromJobber([entry('a', null, 3)], [], { readAt: READ })).toMatchObject({ headcount: 1, hours: 3, people: 0, expenses: null });
    expect(actualsFromJobber([], [{ id: 'x', total: 30 }], { readAt: READ })).toMatchObject({ headcount: 0, hours: 0, manHours: 0, expenses: 30 });
  });

  it('says where the hours came from', () => {
    const a = actualsFromJobber([entry('a', 'U1', 4), entry('b', 'U1', 1, true)], [], { share: 0.5, partial: true, jobNumber: '12', readAt: READ })!;
    expect(actualsFromJobberNote(a)).toBe(
      "From Jobber's time sheets on job #12: 1 time entry by 1 person; this crew job's part (50%) of that Jobber job, split by the estimated hours; 1 timer is still running and left out; Jobber had more entries than TreeCheck read. Check them and save.",
    );
  });
});
