import { afterEach, describe, expect, it } from "vitest";
import {
  activeGuidance,
  learningKillSwitchOn,
  NO_GUIDANCE,
  recordScoutResult,
  recordScoutSent,
  recordWebsiteEstimate,
} from "../../../supabase/functions/_shared/scoutLearning";
import { scoutInputs } from "../../../supabase/functions/_shared/scoutLearningCore";

const COMPANY = "705cecc2-5926-48c1-a728-b3ebd6b920a2";
const CAPTURE = "11111111-2222-4333-8444-555555555555";
const RUN = "99999999-8888-4777-8666-555555555555";
const REP = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

type Reply = { data: unknown; error: unknown };
interface Query { table: string; op: string; payload?: unknown; opts?: unknown; filters: unknown[][]; returning?: string }

// A stand-in for the service-role client: each table answers from a function of the query; every query is kept.
function fakeAdmin(answer: (q: Query) => Reply | undefined) {
  const queries: Query[] = [];
  const reply = (q: Query, fallback: Reply) => Promise.resolve(answer(q) ?? fallback);
  const from = (table: string) => {
    const q: Query = { table, op: "select", filters: [] };
    const b = {
      select(cols: string) { if (q.op === "select") q.filters.push(["select", cols]); else q.returning = cols; return b; },
      update(p: unknown) { q.op = "update"; q.payload = p; return b; },
      upsert(p: unknown, opts: unknown) { q.op = "upsert"; q.payload = p; q.opts = opts; queries.push(q); return reply(q, { data: null, error: null }); },
      eq(c: string, v: unknown) { q.filters.push(["eq", c, v]); return b; },
      or(s: string) { q.filters.push(["or", s]); return b; },
      maybeSingle() { queries.push(q); return reply(q, { data: null, error: null }); },
      then(res: (r: Reply) => unknown, rej: (e: unknown) => unknown) { queries.push(q); return reply(q, { data: [], error: null }).then(res, rej); },
    };
    return b;
  };
  return { from, queries };
}

const settings = (enabled: boolean, website = false) => (q: Query) =>
  q.table === "company_settings" ? { data: { scout_learning_enabled: enabled, scout_learning_website: website }, error: null } : undefined;

afterEach(() => {
  delete (globalThis as { Deno?: unknown }).Deno;
});

describe("activeGuidance", () => {
  it("gives the active block when the owner turned learning on", async () => {
    const admin = fakeAdmin((q) => settings(true)(q) ??
      (q.table === "scout_learning_runs" ? { data: { id: RUN, block: "  COMPANY GUIDANCE  " }, error: null } : undefined));
    expect(await activeGuidance(admin, COMPANY, "scout")).toEqual({ version_id: RUN, block: "COMPANY GUIDANCE" });
  });

  it("gives none when learning is off, without reading any guidance", async () => {
    const admin = fakeAdmin(settings(false));
    expect(await activeGuidance(admin, COMPANY, "scout")).toEqual(NO_GUIDANCE);
    expect(admin.queries.map((q) => q.table)).toEqual(["company_settings"]);
  });

  it("gives the website none until Haris switches the website side on", async () => {
    const admin = fakeAdmin((q) => settings(true, false)(q) ??
      (q.table === "scout_learning_runs" ? { data: { id: RUN, block: "B" }, error: null } : undefined));
    expect(await activeGuidance(admin, COMPANY, "website")).toEqual(NO_GUIDANCE);
  });

  it("gives none when there is no active guidance, an empty block, or a read error", async () => {
    for (const run of [{ data: null, error: null }, { data: { id: RUN, block: "  " }, error: null }, { data: null, error: { message: "no table" } }]) {
      const admin = fakeAdmin((q) => settings(true)(q) ?? (q.table === "scout_learning_runs" ? run : undefined));
      expect(await activeGuidance(admin, COMPANY, "scout")).toEqual(NO_GUIDANCE);
    }
  });

  it("gives none for a bad company id or when the client throws, and never throws itself", async () => {
    const throwing = { from: () => { throw new Error("down"); } };
    expect(await activeGuidance(throwing, COMPANY, "scout")).toEqual(NO_GUIDANCE);
    expect(await activeGuidance(fakeAdmin(settings(true)), "not-a-uuid", "scout")).toEqual(NO_GUIDANCE);
  });

  it("the kill switch gives none without touching the database", async () => {
    (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === "TC_SCOUT_LEARNING_KILL" ? "1" : undefined) } };
    expect(learningKillSwitchOn()).toBe(true);
    const admin = fakeAdmin(settings(true));
    expect(await activeGuidance(admin, COMPANY, "scout")).toEqual(NO_GUIDANCE);
    expect(admin.queries).toEqual([]);
  });
});

describe("recordScoutSent", () => {
  it("upserts one snapshot per capture with the version used", async () => {
    const admin = fakeAdmin(() => undefined);
    await recordScoutSent(admin, { captureId: CAPTURE, companyId: COMPANY, versionId: RUN, inputs: scoutInputs({ diameterInches: 20 }) });
    expect(admin.queries).toHaveLength(1);
    expect(admin.queries[0]).toMatchObject({
      table: "estimate_snapshots", op: "upsert", opts: { onConflict: "surface,ref_id" },
      payload: { surface: "scout", ref_id: CAPTURE, company_id: COMPANY, version_id: RUN, inputs: { size_given: true } },
    });
  });

  it("skips bad ids and never throws", async () => {
    const admin = fakeAdmin(() => undefined);
    await recordScoutSent(admin, { captureId: "x", companyId: COMPANY, versionId: null, inputs: scoutInputs({}) });
    expect(admin.queries).toEqual([]);
    await expect(recordScoutSent({ from: () => { throw new Error("down"); } }, {
      captureId: CAPTURE, companyId: COMPANY, versionId: null, inputs: scoutInputs({}),
    })).resolves.toBeUndefined();
  });
});

describe("recordScoutResult: Scout's first real answer", () => {
  const result = { captureId: CAPTURE, ownerId: REP, price: "1450", difficulty: "Moderate", risk: "Low", service: "Tree Removal", notes: "OBSERVATIONS: ..." };

  it("fills an empty snapshot, or one whose first answer had no price", async () => {
    const admin = fakeAdmin((q) => (q.op === "update" ? { data: [{ ref_id: CAPTURE }], error: null } : undefined));
    await recordScoutResult(admin, result);
    const update = admin.queries[0];
    expect(update).toMatchObject({ op: "update", payload: { price_min: 1450, price_max: 1450, difficulty: "Moderate", service: "Tree Removal" } });
    expect(update.filters).toContainEqual(["or", "result_at.is.null,price_max.is.null,price_max.lte.0"]);
    expect(admin.queries).toHaveLength(1);
  });

  it("leaves an existing real answer alone", async () => {
    const admin = fakeAdmin((q) => (q.op === "update" ? { data: [], error: null }
      : q.table === "estimate_snapshots" ? { data: { ref_id: CAPTURE }, error: null } : undefined));
    await recordScoutResult(admin, result);
    expect(admin.queries.filter((q) => q.op === "upsert")).toEqual([]);
  });

  it("saves the answer with the rep's company when the snapshot at submit was lost", async () => {
    const admin = fakeAdmin((q) => (q.op === "update" ? { data: [], error: null }
      : q.table === "profiles" ? { data: { parent_contractor_id: COMPANY }, error: null } : undefined));
    await recordScoutResult(admin, result);
    const insert = admin.queries.find((q) => q.op === "upsert");
    expect(insert).toMatchObject({ payload: { surface: "scout", ref_id: CAPTURE, company_id: COMPANY, price_max: 1450 }, opts: { ignoreDuplicates: true } });
  });

  it("keeps a price of 0 as 0 (so a retry can replace it) and junk as no price", async () => {
    for (const [price, saved] of [[0, 0], ["0", 0], ["n/a", null], [null, null]] as const) {
      const admin = fakeAdmin((q) => (q.op === "update" ? { data: [{}], error: null } : undefined));
      await recordScoutResult(admin, { ...result, price });
      expect((admin.queries[0].payload as { price_max: unknown }).price_max).toBe(saved);
    }
  });
});

describe("recordWebsiteEstimate", () => {
  it("keeps the range, the AI's text and the form inputs once per lead", async () => {
    const admin = fakeAdmin(() => undefined);
    await recordWebsiteEstimate(admin, {
      leadId: CAPTURE, companyId: COMPANY, priceMin: 650, priceMax: 900, notes: "Estimate text",
      formInputs: { trunk_diameter: 18 }, versionId: "not-a-uuid",
    });
    expect(admin.queries[0]).toMatchObject({
      op: "upsert", opts: { onConflict: "surface,ref_id", ignoreDuplicates: true },
      payload: { surface: "website", ref_id: CAPTURE, company_id: COMPANY, version_id: null, price_min: 650, price_max: 900, notes: "Estimate text", inputs: { trunk_diameter: 18 } },
    });
  });
});
