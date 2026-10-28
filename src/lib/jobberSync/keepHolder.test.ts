// A refused Jobber connect (the account already belongs to another TreeCheck company) has still traded Jobber's
// code for a new sign-in, which cancels the one that company was using. Timber was disconnected that way on
// 2026-10-27. The callback now saves the new sign-in to the company holding the account.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepHolderConnected } from "../../../supabase/functions/jobber-oauth-callback/keepHolder";

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "neq" | "is", column: string, value: unknown];

/** Just enough of supabase-js for jobber_tokens: select or update with eq, neq, is and limit. */
function fakeAdmin(rows: Row[], opts: { failUpdate?: boolean; throws?: boolean } = {}) {
  const updates: { patch: Row; filters: Filter[] }[] = [];
  const admin = {
    from(table: string) {
      if (opts.throws) throw new Error("connection lost");
      expect(table).toBe("jobber_tokens");
      const filters: Filter[] = [];
      let patch: Row | null = null;
      let max = Infinity;
      const match = (r: Row) => filters.every(([op, c, v]) => (op === "neq" ? r[c] !== v : (r[c] ?? null) === v));
      const q = {
        select: () => q,
        update: (p: Row) => { patch = p; return q; },
        eq: (c: string, v: unknown) => { filters.push(["eq", c, v]); return q; },
        neq: (c: string, v: unknown) => { filters.push(["neq", c, v]); return q; },
        is: (c: string, v: unknown) => { filters.push(["is", c, v]); return q; },
        limit: (n: number) => { max = n; return q; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          if (!patch) {
            const data = rows.filter(match).slice(0, max).map((r) => ({ contractor_id: r.contractor_id }));
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
          updates.push({ patch, filters: [...filters] });
          if (opts.failUpdate) return Promise.resolve({ error: { message: "update refused" } }).then(resolve, reject);
          for (const r of rows.filter(match)) Object.assign(r, patch);
          return Promise.resolve({ error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { admin, updates };
}

const ACCOUNT = "Z2lkOi8vSm9iYmVyL0FjY291bnQvMQ==";
const HOLDER = "11111111-0000-0000-0000-000000000001";
const REFUSED = "22222222-0000-0000-0000-000000000002";
const NOW = Date.parse("2026-10-27T12:55:00Z");
const GRANT = { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 };

const holderRow = (over: Row = {}): Row => ({
  contractor_id: HOLDER, jobber_account_id: ACCOUNT, disconnected_at: null, access_token: "old-access",
  refresh_token: "old-refresh", expires_at: "2026-10-27T13:54:41.000Z", updated_at: "2026-10-27T12:54:41.000Z", account_name: "Timber Tree Service", ...over,
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("a refused connect keeps the company holding the Jobber account connected", () => {
  it("saves the new sign-in to the holding company, and only to it", async () => {
    const other = { contractor_id: "33333333-0000-0000-0000-000000000003", jobber_account_id: "another-account", disconnected_at: null, refresh_token: "theirs" };
    const rows = [holderRow(), other];
    const { admin, updates } = fakeAdmin(rows);
    expect(await keepHolderConnected(admin, ACCOUNT, REFUSED, GRANT, "Timber Tree Service", NOW)).toBe(HOLDER);
    expect(rows[0]).toMatchObject({
      access_token: "new-access", refresh_token: "new-refresh",
      expires_at: "2026-10-27T13:55:00.000Z", updated_at: "2026-10-27T12:55:00.000Z", account_name: "Timber Tree Service",
    });
    expect(rows[1].refresh_token).toBe("theirs");
    // The write is limited to the holder, while it still holds this account and is connected.
    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toEqual([["eq", "contractor_id", HOLDER], ["eq", "jobber_account_id", ACCOUNT], ["is", "disconnected_at", null]]);
  });

  it("does nothing when no other connected company holds the account", async () => {
    for (const rows of [
      [],
      [holderRow({ disconnected_at: "2026-10-26T10:00:00Z" })],
      [holderRow({ contractor_id: REFUSED })],
    ]) {
      const { admin, updates } = fakeAdmin(rows);
      expect(await keepHolderConnected(admin, ACCOUNT, REFUSED, GRANT, null, NOW)).toBeNull();
      expect(updates).toEqual([]);
    }
  });

  it("needs a full sign-in from Jobber, and never throws", async () => {
    const rows = [holderRow()];
    const { admin, updates } = fakeAdmin(rows);
    expect(await keepHolderConnected(admin, ACCOUNT, REFUSED, { access_token: "new-access" }, null, NOW)).toBeNull();
    expect(updates).toEqual([]);
    expect(rows[0].refresh_token).toBe("old-refresh");

    expect(await keepHolderConnected(fakeAdmin([holderRow()], { failUpdate: true }).admin, ACCOUNT, REFUSED, GRANT, null, NOW)).toBeNull();
    expect(await keepHolderConnected(fakeAdmin([holderRow()], { throws: true }).admin, ACCOUNT, REFUSED, GRANT, null, NOW)).toBeNull();
  });
});

describe("jobber-oauth-callback", () => {
  const callback = readFileSync(join(process.cwd(), "supabase", "functions", "jobber-oauth-callback", "index.ts"), "utf8").replace(/\r\n/g, "\n");
  it("keeps the holder connected in both refusals, after the code is traded and before the refusal goes back", () => {
    const exchange = callback.indexOf("await fetch(JOBBER_TOKEN_URL");
    const refusals = [...callback.matchAll(/This Jobber account is already connected to another TreeCheck company/g)].map((m) => m.index!);
    const keeps = [...callback.matchAll(/keepHolderConnected\(admin, accountId, ownerId, tok, accountName\)/g)].map((m) => m.index!);
    expect(refusals).toHaveLength(2);
    expect(keeps).toHaveLength(2);
    // Each refusal has its own call just before it: exchange, keep, refuse, keep, refuse.
    expect(exchange).toBeGreaterThan(-1);
    expect([exchange, keeps[0], refusals[0], keeps[1], refusals[1]]).toEqual([...[exchange, keeps[0], refusals[0], keeps[1], refusals[1]]].sort((a, b) => a - b));
  });
});
