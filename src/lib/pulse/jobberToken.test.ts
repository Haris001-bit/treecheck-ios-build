// Financial Pulse: the one locked Jobber sign-in refresh path, and the webhook signature check.
import { createHmac, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getJobberToken,
  jobberHmac,
  JobberReconnectRequired,
  timingSafeEqual,
} from "../../../supabase/functions/_shared/jobber";

interface TokenRow {
  contractor_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  disconnected_at?: string | null;
  refresh_lock_until?: string | null;
}

// Just enough of supabase-js for getJobberToken: one jobber_tokens row plus the M3 lock functions.
function fakeAdmin(row: TokenRow | null, opts: { lockMissing?: boolean } = {}) {
  const state = { row: row ? { ...row } : null, saves: 0 };
  const admin = {
    from(table: string) {
      expect(table).toBe("jobber_tokens");
      return {
        select: () => ({
          eq: (_c: string, id: string) => ({
            maybeSingle: async () => ({
              data: state.row && state.row.contractor_id === id ? { ...state.row } : null,
              error: null,
            }),
          }),
        }),
        update: (patch: Partial<TokenRow>) => ({
          eq: async (_c: string, id: string) => {
            if (state.row && state.row.contractor_id === id) {
              state.row = { ...state.row, ...patch };
              state.saves++;
            }
            return { error: null };
          },
        }),
      };
    },
    async rpc(name: string) {
      if (opts.lockMissing) return { data: null, error: { message: "function does not exist" } };
      if (!state.row) return { data: false, error: null };
      if (name === "jobber_claim_refresh") {
        const held = state.row.refresh_lock_until && Date.parse(state.row.refresh_lock_until) > Date.now();
        if (held) return { data: false, error: null };
        state.row.refresh_lock_until = new Date(Date.now() + 30_000).toISOString();
        return { data: true, error: null };
      }
      state.row.refresh_lock_until = null;
      return { data: null, error: null };
    },
  };
  return { admin, state };
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const row = (over: Partial<TokenRow> = {}): TokenRow => ({
  contractor_id: "owner-1",
  access_token: "old-access",
  refresh_token: "old-refresh",
  expires_at: inMinutes(60),
  disconnected_at: null,
  refresh_lock_until: null,
  ...over,
});

function mockTokenEndpoint(responses: Array<{ status: number; body: unknown; delayMs?: number }>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
    calls.push(init.body.get("refresh_token") ?? "");
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  vi.stubGlobal("Deno", { env: { get: (k: string) => ({ JOBBER_CLIENT_ID: "cid", JOBBER_CLIENT_SECRET: "csecret" })[k] } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getJobberToken", () => {
  it("returns a token that is not close to expiry without refreshing", async () => {
    const calls = mockTokenEndpoint([]);
    const { admin } = fakeAdmin(row());
    expect(await getJobberToken(admin, "owner-1")).toBe("old-access");
    expect(calls).toHaveLength(0);
  });

  it("returns null for a company with no connection, or one Jobber disconnected", async () => {
    mockTokenEndpoint([]);
    expect(await getJobberToken(fakeAdmin(null).admin, "owner-1")).toBeNull();
    expect(await getJobberToken(fakeAdmin(row({ disconnected_at: inMinutes(-5) })).admin, "owner-1")).toBeNull();
    expect(await getJobberToken(fakeAdmin(row({ refresh_token: "" })).admin, "owner-1")).toBeNull();
  });

  it("refreshes near expiry, saves the new pair, and releases the lock", async () => {
    const calls = mockTokenEndpoint([{ status: 200, body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 } }]);
    const { admin, state } = fakeAdmin(row({ expires_at: inMinutes(2) }));
    expect(await getJobberToken(admin, "owner-1")).toBe("new-access");
    expect(calls).toEqual(["old-refresh"]);
    expect(state.row?.refresh_token).toBe("new-refresh");
    expect(state.row?.refresh_lock_until).toBeNull();
  });

  it("two functions refreshing at once use Jobber's refresh token only once", async () => {
    const calls = mockTokenEndpoint([
      { status: 200, body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }, delayMs: 200 },
      { status: 400, body: { error: "invalid_grant" } },
    ]);
    const { admin } = fakeAdmin(row({ expires_at: inMinutes(2) }));
    const [a, b] = await Promise.all([getJobberToken(admin, "owner-1"), getJobberToken(admin, "owner-1")]);
    expect([a, b]).toEqual(["new-access", "new-access"]);
    expect(calls).toEqual(["old-refresh"]);
  });

  it("asks for a reconnect when Jobber refuses the refresh token", async () => {
    mockTokenEndpoint([{ status: 401, body: { error: "invalid_grant" } }]);
    const { admin, state } = fakeAdmin(row({ expires_at: inMinutes(-1) }));
    await expect(getJobberToken(admin, "owner-1")).rejects.toBeInstanceOf(JobberReconnectRequired);
    expect(state.row?.refresh_lock_until).toBeNull();
  });

  it("still works before the lock migration (M3) is applied", async () => {
    const calls = mockTokenEndpoint([{ status: 200, body: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 } }]);
    const { admin } = fakeAdmin(row({ expires_at: inMinutes(1) }), { lockMissing: true });
    expect(await getJobberToken(admin, "owner-1")).toBe("new-access");
    expect(calls).toHaveLength(1);
  });

  it("does not report a server error as a reconnect", async () => {
    mockTokenEndpoint([{ status: 503, body: {} }]);
    const { admin } = fakeAdmin(row({ expires_at: inMinutes(1) }));
    const err = await getJobberToken(admin, "owner-1").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(JobberReconnectRequired);
  });
});

describe("webhook signature", () => {
  beforeEach(() => {
    // The edge runtime has WebCrypto; make sure the test DOM does too.
    if (!globalThis.crypto?.subtle) vi.stubGlobal("crypto", webcrypto);
  });

  it("matches Jobber's base64 HMAC-SHA256 of the raw body", async () => {
    const body = JSON.stringify({ data: { webHookEvent: { topic: "JOB_UPDATE", itemId: "abc", accountId: "acc" } } });
    const expected = createHmac("sha256", "csecret").update(body).digest("base64");
    const got = await jobberHmac(body, "csecret");
    expect(got).toBe(expected);
    expect(timingSafeEqual(got, expected)).toBe(true);
    expect(timingSafeEqual(got, await jobberHmac(body + " ", "csecret"))).toBe(false);
    expect(timingSafeEqual(got, got.slice(0, -1))).toBe(false);
    expect(timingSafeEqual(got, "")).toBe(false);
  });
});
