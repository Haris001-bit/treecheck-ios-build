// Large-company setup: approving a crew estimate (by hand now, from Jobber in PR4) against a stand-in database. One
// conditional update wins; packets are inserted once per package, never duplicated, and never carry a price.
import { describe, expect, it } from 'vitest';
import { activateEstimate, type Db } from '../../../supabase/functions/_shared/productionActivate';
import { priceSheetCard } from './testing/priceSheetFixture';
import { starterDefinition } from './starter';
import { priceEstimate, type EstimateItemInput } from './estimate';
import type { RateCardDefinition } from './rules';

type Row = Record<string, unknown>;
const OWNER = 'aaaaaaaa-0000-0000-0000-000000000001';
const NOW = new Date('2026-10-26T15:00:00Z');

function card(): RateCardDefinition {
  const def = priceSheetCard();
  def.playbooks = starterDefinition().playbooks;
  return def;
}

function estimateRow(def: RateCardDefinition, items: EstimateItemInput[], over: Row = {}): Row {
  const priced = priceEstimate(def, items, { day: '2026-10-26' });
  return {
    id: 'est-1', contractor_id: OWNER, status: 'draft', number: 1001, rate_card_version: 2, promised_window: { from: '2026-11-02' },
    work_items: priced.items, trees: [{ key: 't1', label: 'Front oak', location: 'Front yard', photos: [`${OWNER}/production/e1/t1/photo-1.jpg`] }],
    customer: { name: 'Pat Example', phone: '555-0100', address: '1 Test Lane', gateCode: '1234', accessNotes: 'Dog in the yard', email: 'pat@example.test' },
    ...over,
  };
}

/** Just enough of supabase-js's query builder for activateEstimate: select, update and upsert with eq/in filters. */
function fakeDb(estimate: Row | null, packets: Row[] = []) {
  const state = { estimate, packets, beforeUpdate: null as null | (() => void) };
  const from = (table: string) => {
    const filters: [kind: 'eq' | 'in', col: string, v: unknown][] = [];
    let op: 'select' | 'update' | 'upsert' = 'select';
    let patch: Row = {};
    let rows: Row[] = [];
    const matches = (r: Row) => filters.every(([kind, col, v]) => (kind === 'eq' ? r[col] === v : (v as unknown[]).includes(r[col])));
    const run = () => {
      if (table === 'production_estimates') {
        if (op === 'update') state.beforeUpdate?.();
        const hit = state.estimate && matches(state.estimate) ? [state.estimate] : [];
        if (op === 'update') hit.forEach((r) => Object.assign(r, patch));
        return { data: op === 'update' ? hit.map((r) => ({ id: r.id })) : hit, error: null };
      }
      const made = rows.filter((r) => !state.packets.some((p) => p.estimate_id === r.estimate_id && p.package_key === r.package_key));
      for (const r of made) state.packets.push({ ...r, id: `pk-${state.packets.length + 1}` });
      return { data: made.map((r) => ({ id: r.package_key })), error: null };
    };
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => { filters.push(['eq', col, v]); return q; },
      in: (col: string, v: unknown[]) => { filters.push(['in', col, v]); return q; },
      update: (p: Row) => { op = 'update'; patch = p; return q; },
      upsert: (r: Row[]) => { op = 'upsert'; rows = r; return q; },
      maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, fail),
    };
    return q;
  };
  return { db: { from } as Db, state };
}

const ITEMS: EstimateItemInput[] = [
  { id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3', hours: 4, utility: 'line_drop', crane: true } },
  { id: 'b', serviceKey: 'stump', treeKey: 't1', kind: 'recommended', answers: { stump_diameter: 30 } },
  { id: 'c', serviceKey: 'dynamic_cable', treeKey: 't1', kind: 'optional', answers: { cables: 2 } },
];
const input = (def: RateCardDefinition, chosen: string[] | null) => ({
  ownerId: OWNER, estimateId: 'est-1', def, via: 'manual' as const, by: OWNER, chosen, salespersonName: 'Sam Seller', backlogWeeks: 3, now: NOW,
});

describe('activateEstimate', () => {
  it('approves once and makes one packet per package, with dependencies and playbook tasks', async () => {
    const def = card();
    const { db, state } = fakeDb(estimateRow(def, ITEMS));
    const r = await activateEstimate(db, input(def, ['b', 'c']));
    expect(r).toEqual({ kind: 'ok', packets: 3 });
    expect(state.estimate).toMatchObject({ status: 'approved', approved_via: 'manual', approved_by: OWNER, backlog_weeks_at_sale: 3 });
    const selected = (state.estimate!.work_items as { id: string; selected?: boolean | null }[]).map((i) => [i.id, i.selected ?? null]);
    expect(selected).toEqual([['a', null], ['b', true], ['c', true]]);

    const byKey = Object.fromEntries(state.packets.map((p) => [p.package_key, p]));
    expect(Object.keys(byKey)).toEqual(['removal', 'stump', 'cabling']);
    expect(byKey.stump.depends_on).toEqual(['removal']);
    expect(byKey.removal).toMatchObject({ estimate_number: 1001, salesperson_name: 'Sam Seller', status: 'ready', promised_window: { from: '2026-11-02' } });
    expect(byKey.removal.customer).toEqual({ name: 'Pat Example', phone: '555-0100', address: '1 Test Lane', gateCode: '1234', accessNotes: 'Dog in the yard' });
    const removalTasks = byKey.removal.tasks as { kind: string; dueAt: string | null }[];
    expect(removalTasks.map((t) => t.kind).sort()).toEqual(['utility_disconnect', 'vendor']);
    expect(removalTasks.every((t) => t.dueAt === null)).toBe(true);
    expect(byKey.cabling.tasks).toMatchObject([{ kind: 'material_check', dueAt: NOW.toISOString() }]);
    expect((byKey.removal.scope as { photos: string[]; tree: string }[])[0]).toMatchObject({ tree: 'Front oak', photos: [`${OWNER}/production/e1/t1/photo-1.jpg`] });
  });

  it('packets never carry a price, so crew leaders can read them', async () => {
    const def = card();
    const { db, state } = fakeDb(estimateRow(def, ITEMS));
    await activateEstimate(db, input(def, ['b', 'c']));
    const text = JSON.stringify(state.packets);
    for (const k of ['"price"', '"engineAmount"', '"sell"', '"total"', '"override"']) expect(text).not.toContain(k);
    expect(text).not.toContain('pat@example.test');
  });

  it('with no choice given, keeps recommended work and drops optional work', async () => {
    const def = card();
    const { db, state } = fakeDb(estimateRow(def, ITEMS));
    expect(await activateEstimate(db, input(def, null))).toEqual({ kind: 'ok', packets: 2 });
    expect(state.packets.map((p) => p.package_key)).toEqual(['removal', 'stump']);
  });

  it('a second approval, or one that loses a race, changes nothing', async () => {
    const def = card();
    const { db, state } = fakeDb(estimateRow(def, ITEMS));
    await activateEstimate(db, input(def, null));
    expect(await activateEstimate(db, input(def, null))).toEqual({ kind: 'already', status: 'approved' });
    expect(state.packets).toHaveLength(2);

    const race = fakeDb(estimateRow(def, ITEMS));
    race.state.beforeUpdate = () => { race.state.estimate!.status = 'approved'; };
    expect(await activateEstimate(race.db, input(def, null))).toEqual({ kind: 'already', status: 'approved' });
    expect(race.state.packets).toHaveLength(0);
  });

  it('packets that already exist (a Jobber event delivered twice) are not made again', async () => {
    const def = card();
    const { db, state } = fakeDb(estimateRow(def, ITEMS), [{ id: 'old', estimate_id: 'est-1', package_key: 'removal' }]);
    expect(await activateEstimate(db, input(def, null))).toEqual({ kind: 'ok', packets: 1 });
    expect(state.packets.map((p) => p.package_key)).toEqual(['removal', 'stump']);
  });

  it('only priced items become work, and unknown or lost estimates are refused', async () => {
    const def = card();
    const unfinished = fakeDb(estimateRow(def, [{ id: 'a', serviceKey: 'removal', treeKey: 't1', kind: 'required', answers: { crew: 'crew3' } }]));
    expect(await activateEstimate(unfinished.db, input(def, null))).toEqual({ kind: 'ok', packets: 0 });
    expect((await activateEstimate(fakeDb(null).db, input(def, null))).kind).toBe('not_found');
    expect(await activateEstimate(fakeDb(estimateRow(def, ITEMS, { status: 'lost' })).db, input(def, null))).toEqual({ kind: 'already', status: 'lost' });
  });
});
