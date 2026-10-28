import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentReply, gatewayAgent, runTick } from "../../../supabase/functions/_shared/scoutLearningRun";

// An in-memory stand-in for the service-role client, with SL1's claim and finish rules, enough for the run's queries.
type Row = Record<string, unknown>;
const NOW = "2026-10-21T15:00:00Z"; // Wednesday
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const REP = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fakeDb(tables: Record<string, Row[]>, plans: Record<string, string>, now: () => string) {
  let seq = 900;
  const runs = () => tables.scout_learning_runs;
  const rpc = async (name: string, a: Record<string, unknown>) => {
    if (name === "company_plan") return { data: plans[a.p_owner as string] ?? "locked", error: null };
    if (name === "scout_learning_claim") {
      const slot = runs().find((r) => r.company_id === a.p_company && r.surface === a.p_surface && r.kind === a.p_kind &&
        (a.p_kind === "initial" || r.week_start === a.p_week));
      if (slot) {
        const stale = slot.status === "running" && Date.parse(slot.claimed_at as string) < Date.parse(now()) - 15 * 60_000;
        if ((slot.status === "failed" || stale) && (slot.attempts as number) < 3) {
          Object.assign(slot, { status: "running", attempts: (slot.attempts as number) + 1, claimed_at: now() });
          return { data: slot.id, error: null };
        }
        return { data: null, error: null };
      }
      const row = {
        id: id(seq++), company_id: a.p_company, surface: a.p_surface, kind: a.p_kind, week_start: a.p_kind === "weekly" ? a.p_week : null,
        status: "running", attempts: 1, claimed_at: now(), finished_at: null, jobs: [], avg_gap_pct: null, summary: null, changes: [],
        guidance: null, block: null, active: false, undone_at: null, previous_run_id: null,
      };
      runs().push(row);
      return { data: row.id, error: null };
    }
    if (name === "scout_learning_finish") {
      const run = runs().find((r) => r.id === a.p_run);
      if (!run || run.status !== "running") return { data: false, error: null };
      const live = a.p_status === "rewritten" && run.kind !== "preview";
      let prev: Row | undefined;
      if (live) {
        prev = runs().find((r) => r.company_id === run.company_id && r.surface === run.surface && r.active);
        if (prev) prev.active = false;
      }
      const f = a.p_fields as Row;
      Object.assign(run, {
        status: a.p_status, finished_at: now(), jobs: f.jobs ?? [], avg_gap_pct: f.avg_gap_pct ?? null, summary: f.summary ?? null,
        changes: f.changes ?? [], guidance: f.guidance ?? null, error: f.error ?? null,
        block: a.p_status === "rewritten" || run.kind === "preview" ? a.p_block : null,
        active: live, previous_run_id: live ? prev?.id ?? null : null,
      });
      return { data: true, error: null };
    }
    throw new Error(`unknown rpc ${name}`);
  };
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let op = "select";
    let patch: Row = {};
    let wantRows = false;
    let order: [string, boolean] | null = null;
    let lim: number | null = null;
    const matched = () => {
      let rs = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) {
        const [c, asc] = order;
        rs = [...rs].sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      return lim === null ? rs : rs.slice(0, lim);
    };
    const run = () => {
      if (op === "update") {
        const rs = matched();
        for (const r of rs) Object.assign(r, patch);
        return { data: wantRows ? rs : null, error: null };
      }
      return { data: matched(), error: null };
    };
    const q = {
      select() { if (op === "update") wantRows = true; return q; },
      update(p: Row) { op = "update"; patch = p; return q; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return q; },
      not(c: string, o: string, v: unknown) { if (o === "is" && v === null) filters.push((r) => r[c] !== null && r[c] !== undefined); return q; },
      gte(c: string, v: string) { filters.push((r) => String(r[c]) >= v); return q; },
      lt(c: string, v: string) { filters.push((r) => String(r[c]) < v); return q; },
      order(c: string, o: { ascending: boolean }) { order = [c, o.ascending]; return q; },
      limit(n: number) { lim = n; return q; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: (r.data as Row[])?.[0] ?? null, error: null }); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  };
  return { from, rpc };
}

// Timber-like data: a removal Scout priced high, picked by the owner; one by a rep with auto-approve; pruning;
// a Testville job; and a Free preview. Only the first two count.
function seed() {
  return {
    profiles: [
      { id: A, is_sandbox: false, parent_contractor_id: null },
      { id: REP, is_sandbox: false, parent_contractor_id: A },
      { id: B, is_sandbox: false, parent_contractor_id: null },
    ],
    company_settings: [{ contractor_id: A, scout_learning_enabled: true, scout_learning_website: false }],
    bid_requests: [
      { id: id(1), owner_contractor_id: A, capture_id: id(11), lead_id: null, city: "Edmond", created_at: "2026-10-12T15:00:00Z", quote_pick: { amount: 1000, option: "recommended", picked_at: "2026-10-13T15:00:00Z", bid_id: id(31) } },
      { id: id(2), owner_contractor_id: REP, capture_id: id(12), lead_id: null, city: "Yukon", created_at: "2026-10-14T15:00:00Z", quote_pick: { amount: 2000, option: "custom", picked_at: "2026-10-15T15:00:00Z", auto: true } },
      { id: id(3), owner_contractor_id: A, capture_id: id(13), lead_id: null, city: "Edmond", created_at: "2026-10-14T15:00:00Z", quote_pick: { amount: 300, picked_at: "2026-10-15T15:00:00Z" } },
      { id: id(4), owner_contractor_id: A, capture_id: id(14), lead_id: null, city: "Testville", created_at: "2026-10-14T15:00:00Z", quote_pick: { amount: 900, picked_at: "2026-10-15T15:00:00Z" } },
      { id: id(5), owner_contractor_id: B, capture_id: id(15), lead_id: null, city: "Moore", created_at: "2026-10-14T15:00:00Z", quote_pick: { amount: 900, picked_at: "2026-10-15T15:00:00Z" } },
    ],
    scout_captures: [
      { id: id(11), requested_service: "Tree Removal", ai_price_min: 1300, ai_price_max: 1300, ai_notes: "OBSERVATIONS: near 12 Oak Ridge Dr", created_at: "2026-10-12T15:00:00Z", free_preview_locked: false, customer_name: "Jane Doe" },
      { id: id(12), requested_service: "Tree Removal", ai_price_min: 2400, ai_price_max: 2400, ai_notes: "", created_at: "2026-10-14T15:00:00Z", free_preview_locked: false },
      { id: id(13), requested_service: "Pruning/Trimming", ai_price_min: 900, ai_price_max: 900, created_at: "2026-10-14T15:00:00Z" },
      { id: id(14), requested_service: "Tree Removal", ai_price_min: 900, ai_price_max: 900, created_at: "2026-10-14T15:00:00Z" },
      { id: id(15), requested_service: "Tree Removal", ai_price_min: 1200, ai_price_max: 1200, created_at: "2026-10-14T15:00:00Z" },
    ],
    estimate_snapshots: [
      { surface: "scout", ref_id: id(11), price_min: 1300, price_max: 1300, notes: "BREAKDOWN for Jane Doe", sent_at: "2026-10-12T15:00:00Z", inputs: { size_given: false, notes_given: true, notes: "leans over the fence", photos: 1 } },
    ],
    bids: [{ id: id(31), est_hours: 5, crew_size: 1, ground_crew_size: 2, est_disposal_loads: 2, needs_mini_skid: true, equipment: "mini skid" }],
    leads: [],
    scout_learning_runs: [] as Row[],
  } as Record<string, Row[]>;
}

const goodAnswer = {
  decision: "rewrite",
  factors: [{ service: "Tree Removal", size: "not_given", factor: 0.8, jobs: 2 }],
  rules: ["Single removals here usually need one or two disposal loads."],
  summary: "Scout ran about 25 percent high on removals without a measured trunk.",
  changes: ["Removals without a diameter now come out lower."],
};

let clock = NOW;
let calls: { system: string; input: Record<string, unknown> }[] = [];
const agentWith = (reply: AgentReply) => async (system: string, input: unknown) => {
  calls.push({ system, input: input as Record<string, unknown> });
  return reply;
};

beforeEach(() => { clock = NOW; calls = []; });
afterEach(() => { delete (globalThis as { Deno?: unknown }).Deno; });

const tick = (db: ReturnType<typeof fakeDb>, reply: AgentReply = { ok: true, answer: goodAnswer }) =>
  runTick(db, { now: new Date(clock), agent: agentWith(reply) });
const runsOf = (t: Record<string, Row[]>, company = A) => t.scout_learning_runs.filter((r) => r.company_id === company);

describe("the first run after a company turns learning on", () => {
  it("learns from its past picked jobs, then the guidance goes live", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    expect(await tick(db)).toEqual({ ran: ["initial scout"] });
    expect(calls).toHaveLength(1);
    const input = calls[0].input as { new_jobs: Record<string, unknown>[]; run_kind: string; current_guidance: unknown };
    expect(input.run_kind).toBe("initial");
    expect(input.current_guidance).toBeNull();
    // The removal and the rep's auto-picked removal; not pruning, Testville or the other company.
    expect(input.new_jobs.map((j) => [j.id, (j.picked as Row).amount, (j.picked as Row).auto])).toEqual([["J1", 2000, true], ["J2", 1000, false]]);
    expect(JSON.stringify(calls[0].input)).not.toMatch(/Jane|Oak Ridge/);
    expect(calls[0].system).toContain("Never chase a single outlier");
    const [run] = runsOf(t);
    // Gaps: (1300 - 1000) / 1000 = 30 and (2400 - 2000) / 2000 = 20.
    expect(run).toMatchObject({ kind: "initial", status: "rewritten", active: true, avg_gap_pct: 25 });
    expect(run.block).toContain("Tree Removal, no diameter given: x0.80");
    expect((run.jobs as Row[]).map((j) => j.ref)).toEqual([id(12), id(11)]);
  });

  it("a second tick the same week does nothing more", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    clock = "2026-10-21T15:10:00Z";
    expect(await tick(db)).toEqual({ ran: [] });
    expect(calls).toHaveLength(1);
  });

  it("no past jobs: finished as no_jobs without calling the AI", async () => {
    const t = seed();
    t.bid_requests = [];
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    expect(calls).toEqual([]);
    expect(runsOf(t)[0]).toMatchObject({ status: "no_jobs", active: false });
  });
});

describe("the weekly run", () => {
  it("runs from the Monday 07:00 after the first run's week, on the new jobs only", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    // Monday 2026-10-26 06:59 CDT: nothing yet (the first run's own week is never re-run).
    clock = "2026-10-26T11:59:00Z";
    await tick(db);
    clock = "2026-10-26T12:00:00Z";
    await tick(db);
    expect(calls).toHaveLength(1);
    // A new job picked during 2026-10-26 to 11-01; the week's run comes on Monday 11-02 after 07:00 CST (13:00 UTC).
    t.bid_requests.push({ id: id(6), owner_contractor_id: A, capture_id: id(16), lead_id: null, city: "Edmond", created_at: "2026-10-27T15:00:00Z", quote_pick: { amount: 1500, picked_at: "2026-10-28T15:00:00Z" } });
    t.scout_captures.push({ id: id(16), requested_service: "Tree Removal", ai_price_min: 1800, ai_price_max: 1800, created_at: "2026-10-27T15:00:00Z" });
    clock = "2026-11-02T13:05:00Z";
    expect(await tick(db, { ok: true, answer: { ...goodAnswer, factors: [{ service: "Tree Removal", size: "not_given", factor: 0.6, jobs: 3 }] } })).toEqual({ ran: ["weekly scout 2026-10-26"] });
    const input = calls[1].input as { new_jobs: Row[]; current_guidance: { factors: Row[] }; earlier_jobs: Row[] };
    expect(input.new_jobs.map((j) => (j.picked as Row).amount)).toEqual([1500]);
    expect(input.current_guidance.factors[0].factor).toBe(0.8);
    expect(input.earlier_jobs).toHaveLength(2);
    const weekly = runsOf(t).find((r) => r.kind === "weekly")!;
    // A weekly run moves a factor at most 0.15: 0.80 to 0.65, not 0.60.
    expect(weekly).toMatchObject({ status: "rewritten", active: true, week_start: "2026-10-26" });
    expect(weekly.block).toContain("x0.65");
    expect(runsOf(t).find((r) => r.kind === "initial")).toMatchObject({ active: false });
    expect(weekly.previous_run_id).toBe(runsOf(t).find((r) => r.kind === "initial")!.id);
  });

  it("a week with no new picked jobs keeps the guidance and calls no AI", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    clock = "2026-11-02T13:05:00Z";
    await tick(db);
    expect(calls).toHaveLength(1);
    expect(runsOf(t).find((r) => r.kind === "weekly")).toMatchObject({ status: "no_jobs", active: false });
    expect(runsOf(t).find((r) => r.kind === "initial")).toMatchObject({ active: true });
  });
});

describe("when the AI fails or answers badly, the company keeps its guidance", () => {
  it("credits used up: failed, retried by a later tick", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db, { ok: false, status: 402, error: "payment required" });
    expect(runsOf(t)[0]).toMatchObject({ status: "failed", active: false, error: "AI credits are used up" });
    clock = "2026-10-21T15:10:00Z";
    await tick(db);
    expect(runsOf(t)[0]).toMatchObject({ status: "rewritten", active: true, attempts: 2 });
  });

  it("a refused answer fails; keep leaves the guidance unchanged", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db, { ok: true, answer: { ...goodAnswer, summary: "Call 405-555-0100 about it." } });
    expect(runsOf(t)[0]).toMatchObject({ status: "failed", active: false });
    expect(String(runsOf(t)[0].error)).toContain("refused");
    clock = "2026-10-21T15:10:00Z";
    await tick(db, { ok: true, answer: { ...goodAnswer, decision: "keep" } });
    expect(runsOf(t)[0]).toMatchObject({ status: "unchanged", active: false, block: null });
  });
});

describe("who is skipped", () => {
  it("sandbox and Free-plan companies, and nothing at all with the kill switch", async () => {
    const t = seed();
    t.company_settings.push({ contractor_id: B, scout_learning_enabled: true, scout_learning_website: false });
    t.profiles.find((p) => p.id === A)!.is_sandbox = true;
    const db = fakeDb(t, { [A]: "paid", [B]: "free" }, () => clock);
    expect(await tick(db)).toEqual({ ran: [] });
    expect(t.scout_learning_runs).toEqual([]);
    t.profiles.find((p) => p.id === A)!.is_sandbox = false;
    (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === "TC_SCOUT_LEARNING_KILL" ? "1" : undefined) } };
    expect(await tick(db)).toEqual({ ran: [] });
    expect(calls).toEqual([]);
  });

  it("at most one AI call per tick: the second company waits for the next tick", async () => {
    const t = seed();
    t.company_settings.push({ contractor_id: B, scout_learning_enabled: true, scout_learning_website: false });
    const db = fakeDb(t, { [A]: "paid", [B]: "trialing" }, () => clock);
    await tick(db);
    expect(calls).toHaveLength(1);
    clock = "2026-10-21T15:10:00Z";
    await tick(db);
    expect(calls).toHaveLength(2);
    expect(runsOf(t, B)[0]).toMatchObject({ kind: "initial", status: "rewritten" });
  });
});

describe("fixes from the 2026-10-22 review", () => {
  it("a first run that failed all three tries no longer blocks the weekly runs", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    for (const at of ["15:00", "15:10", "15:20"]) {
      clock = `2026-10-21T${at}:00Z`;
      await tick(db, { ok: false, status: 402, error: "payment required" });
    }
    expect(runsOf(t)[0]).toMatchObject({ kind: "initial", status: "failed", attempts: 3 });
    clock = "2026-10-21T15:30:00Z";
    expect(await tick(db)).toEqual({ ran: [] });
    // The next week's run takes over, with the jobs the first run never used.
    clock = "2026-11-02T13:05:00Z";
    expect(await tick(db)).toEqual({ ran: ["weekly scout 2026-10-26"] });
    expect(runsOf(t).find((r) => r.kind === "weekly")).toMatchObject({ status: "rewritten", active: true });
  });

  it("a run that died on its third try is closed, so the card stops waiting for it", async () => {
    const t = seed();
    t.scout_learning_runs.push({ id: id(600), company_id: A, surface: "scout", kind: "initial", status: "running", attempts: 3,
      claimed_at: "2026-10-21T14:00:00Z", jobs: [], changes: [], active: false, undone_at: null, week_start: null });
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    expect(runsOf(t)[0]).toMatchObject({ status: "failed", error: "stopped: no answer after the last try" });
    expect(calls).toEqual([]);
  });

  it("the agent sees the factor already inside each estimate, and the report shows what the new one would have priced", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    const first = runsOf(t)[0];
    // A job Scout priced with the live x0.80 (its snapshot names that version), picked during the next week.
    t.bid_requests.push({ id: id(7), owner_contractor_id: A, capture_id: id(17), lead_id: null, city: "Edmond", created_at: "2026-10-27T15:00:00Z", quote_pick: { amount: 1150, picked_at: "2026-10-28T15:00:00Z" } });
    t.scout_captures.push({ id: id(17), requested_service: "Tree Removal", ai_price_min: 1200, ai_price_max: 1200, created_at: "2026-10-27T15:00:00Z" });
    t.estimate_snapshots.push({ surface: "scout", ref_id: id(17), price_min: 1200, price_max: 1200, service: "Tree Removal", version_id: first.id,
      sent_at: "2026-10-27T15:00:00Z", inputs: { size_given: false, notes_given: false, photos: 1 } });
    clock = "2026-11-02T13:05:00Z";
    await tick(db, { ok: true, answer: { ...goodAnswer, factors: [{ service: "Tree Removal", size: "not_given", factor: 0.7, jobs: 3 }] } });
    const input = calls[1].input as { new_jobs: { estimate: Row }[] };
    expect(input.new_jobs[0].estimate.factor_already_applied).toBe(0.8);
    const weekly = runsOf(t).find((r) => r.kind === "weekly")!;
    // 0.80 to 0.70 is within the step; Scout's 1200 was made with 0.80, so with 0.70 it would have been 1050.
    expect((weekly.jobs as Row[])[0]).toMatchObject({ estimate: 1200, picked: 1150, projected: 1050 });
    expect(weekly.changes).toEqual(["Tree removals with no trunk size given now come out 30% lower (they were 20% lower)."]);
  });

  it("a removal quoted with stump grinding, or a job relabelled in Request Edit, is left out", async () => {
    const t = seed();
    Object.assign(t.bid_requests[0], { awarded_stump_bid_id: id(41), pricing_inputs: { stumpCost: 150 } });
    Object.assign(t.scout_captures[1], { final_service: "Stump Grinding" });
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    expect(calls).toEqual([]);
    expect(runsOf(t)[0]).toMatchObject({ status: "no_jobs" });
  });

  it("when a limit holds part of the change back, the summary says so and What changed is the real change", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    t.bid_requests.push({ id: id(6), owner_contractor_id: A, capture_id: id(16), lead_id: null, city: "Edmond", created_at: "2026-10-27T15:00:00Z", quote_pick: { amount: 1500, picked_at: "2026-10-28T15:00:00Z" } });
    t.scout_captures.push({ id: id(16), requested_service: "Tree Removal", ai_price_min: 1800, ai_price_max: 1800, created_at: "2026-10-27T15:00:00Z" });
    clock = "2026-11-02T13:05:00Z";
    await tick(db, { ok: true, answer: { ...goodAnswer, factors: [{ service: "Tree Removal", size: "not_given", factor: 0.6, jobs: 3 }], changes: ["Removals now 40% lower."] } });
    const weekly = runsOf(t).find((r) => r.kind === "weekly")!;
    expect(String(weekly.summary)).toContain("capped at 15 percent");
    expect(weekly.changes).toEqual(["Tree removals with no trunk size given now come out 35% lower (they were 20% lower)."]);
  });
});

describe("large misses: why each one happened (Mark, 2026-10-27)", () => {
  // In the seed, J1 is the rep's job (2400 on 2000, +20%) and J2 the owner's (1300 on 1000, +30%).
  const why = { job: "J2", direction: "high", gap_pct: 30, likely_reason: "Scout counted two disposal loads, and the crew's offer shows one.", cause_type: "disposal", confidence: "medium" };
  const withWhy = (over: Record<string, unknown> = {}) => ({ ok: true, answer: { ...goodAnswer, large_misses: [why], ...over } });

  it("a run keeps each accepted explanation on its report job, even when the rest of the answer is refused", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db, withWhy());
    const jobs = runsOf(t)[0].jobs as Row[];
    expect(jobs.map((j) => [j.ref, j.large_miss, (j.miss as Row | undefined)?.cause])).toEqual([[id(12), true, undefined], [id(11), true, "disposal"]]);
    const t2 = seed();
    await tick(fakeDb(t2, { [A]: "paid" }, () => clock), withWhy({ summary: "Call 405-555-0100 about the job." }));
    expect(runsOf(t2)[0]).toMatchObject({ status: "failed", active: false });
    expect((runsOf(t2)[0].jobs as Row[])[1].miss).toMatchObject({ reason: why.likely_reason, confidence: "medium" });
  });

  it("a report from before explanations gets them once, on a tick with no other AI call, and its guidance stays", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    const [run] = runsOf(t);
    for (const j of run.jobs as Row[]) delete j.large_miss; // as the reports made before 2026-10-27 read
    const before = { guidance: run.guidance, block: run.block, summary: run.summary, active: run.active };
    clock = "2026-10-21T15:10:00Z";
    expect(await tick(db, withWhy({ decision: "rewrite", factors: [{ service: "Tree Removal", size: "any", factor: 0.6, jobs: 9 }] }))).toEqual({ ran: ["explain scout"] });
    const input = calls[1].input as { new_jobs: Row[]; current_guidance: unknown };
    expect(input.new_jobs.map((j) => [j.id, j.large_miss])).toEqual([["J1", true], ["J2", true]]);
    expect(input.current_guidance).toBeNull();
    expect((run.jobs as Row[]).map((j) => [j.large_miss, !!j.miss])).toEqual([[true, false], [true, true]]);
    expect(runsOf(t)).toHaveLength(1);
    expect({ guidance: run.guidance, block: run.block, summary: run.summary, active: run.active }).toEqual(before);
    clock = "2026-10-21T15:20:00Z";
    expect(await tick(db, withWhy())).toEqual({ ran: [] });
    expect(calls).toHaveLength(2);
  });

  it("a failed explanation is not tried again; a report with no large miss needs no AI call", async () => {
    const t = seed();
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    await tick(db);
    const [run] = runsOf(t);
    for (const j of run.jobs as Row[]) delete j.large_miss;
    clock = "2026-10-21T15:10:00Z";
    await tick(db, { ok: false, status: 429 });
    expect((run.jobs as Row[]).map((j) => [j.large_miss, "miss" in j])).toEqual([[true, false], [true, false]]);
    clock = "2026-10-21T15:20:00Z";
    await tick(db, withWhy());
    expect(calls).toHaveLength(2);
    for (const j of run.jobs as Row[]) { delete j.large_miss; j.gap_pct = 5; }
    clock = "2026-10-21T15:30:00Z";
    await tick(db, withWhy());
    expect(calls).toHaveLength(2);
    expect((run.jobs as Row[]).every((j) => j.large_miss === false)).toBe(true);
  });
});

describe("previews (asked for in the SQL editor)", () => {
  it("are worked out by the next tick, keep their proposed block and never go live, even with learning off", async () => {
    const t = seed();
    t.company_settings = [];
    t.scout_learning_runs.push({ id: id(500), company_id: A, surface: "scout", kind: "preview", status: "running", attempts: 0, claimed_at: "2026-10-21T14:00:00Z", jobs: [], changes: [], active: false, undone_at: null, week_start: null });
    const db = fakeDb(t, { [A]: "paid" }, () => clock);
    expect(await tick(db)).toEqual({ ran: ["preview scout"] });
    expect(runsOf(t)[0]).toMatchObject({ kind: "preview", status: "rewritten", active: false, attempts: 1 });
    expect(runsOf(t)[0].block).toContain("x0.80");
    clock = "2026-10-21T15:10:00Z";
    await tick(db);
    expect(calls).toHaveLength(1);
  });
});

describe("gatewayAgent", () => {
  const sse = (chunks: string[]) => new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); },
  });
  const fetchWith = (res: Response) => (async () => res) as unknown as typeof fetch;

  it("reads the streamed answer, even when events split across chunks", async () => {
    const text = JSON.stringify(goodAnswer);
    const half = Math.floor(text.length / 2);
    const events = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text.slice(0, half) })}\n`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text.slice(half) })}\n`,
      "data: [DONE]\n",
    ].join("");
    const reply = await gatewayAgent("key", fetchWith(new Response(sse([events.slice(0, 40), events.slice(40)]), { status: 200 })))("s", {});
    expect(reply).toEqual({ ok: true, answer: goodAnswer });
  });

  it("reports the status of a refused call and a non-JSON answer", async () => {
    expect(await gatewayAgent("key", fetchWith(new Response("no credits", { status: 402 })))("s", {})).toMatchObject({ ok: false, status: 402 });
    const bad = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "not json" })}\n`;
    expect(await gatewayAgent("key", fetchWith(new Response(sse([bad]), { status: 200 })))("s", {})).toMatchObject({ ok: false, error: "the answer was not JSON" });
  });

  it("sends the strict schema and stores nothing", async () => {
    let sent: Record<string, unknown> = {};
    const capture = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response("x", { status: 500 });
    }) as unknown as typeof fetch;
    await gatewayAgent("key", capture)("system text", { a: 1 });
    expect(sent).toMatchObject({ model: "openai/gpt-6-astra", store: false, text: { format: { type: "json_schema", strict: true } } });
  });
});
