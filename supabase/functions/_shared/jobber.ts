// Shared Jobber helpers used by every function that talks to Jobber.
//
// getJobberToken() is the ONE place a Jobber access token is refreshed. Jobber rotates refresh
// tokens: the moment one process refreshes, the old refresh token dies. Two functions refreshing
// the same company at once would therefore disconnect that company. A per-company lock
// (jobber_claim_refresh, migration M3) makes the refresh single-file. If M3 is not applied yet the
// helper falls back to an unlocked refresh, which is exactly how every function behaved before.

export const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
export const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
// API version used by the Financial Pulse Jobber code. Older functions keep their own pinned version.
export const PULSE_JOBBER_VERSION = "2026-09-25";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export class JobberReconnectRequired extends Error {
  constructor(message = "Jobber needs to be reconnected. Open Integrations and connect Jobber again.") {
    super(message);
    this.name = "JobberReconnectRequired";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Environment variable lookup that never names the Deno global directly: the web app's tests
// import this file, and the web type check has no Deno types.
function env(key: string): string | undefined {
  return (globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } })
    .Deno?.env.get(key);
}

// Refresh when the token has less than this long left.
const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * Returns a valid Jobber access token for a company (its jobber_tokens row, keyed by the owner's
 * contractor id), refreshing it if needed. Returns null when the company has no live connection.
 */
export async function getJobberToken(admin: Admin, contractorId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row, error } = await admin
      .from("jobber_tokens").select("*").eq("contractor_id", contractorId).maybeSingle();
    if (error) throw new Error(`Jobber token read failed: ${error.message}`);
    if (!row || row.disconnected_at || !row.refresh_token) return null;

    if (new Date(row.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) {
      return row.access_token as string;
    }

    // Take the per-company refresh lock. A missing function (M3 not applied) means no lock.
    const claim = await admin.rpc("jobber_claim_refresh", { p_contractor: contractorId, p_seconds: 30 });
    const lockAvailable = !claim.error;
    if (lockAvailable && claim.data !== true) {
      // Someone else is refreshing this company right now: wait, then read the new token.
      await sleep(1500);
      continue;
    }

    try {
      // Re-read inside the lock: another process may have just refreshed.
      if (lockAvailable) {
        const { data: fresh } = await admin
          .from("jobber_tokens").select("*").eq("contractor_id", contractorId).maybeSingle();
        if (fresh && new Date(fresh.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) {
          return fresh.access_token as string;
        }
        if (fresh) Object.assign(row, fresh);
      }

      const res = await fetch(JOBBER_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env("JOBBER_CLIENT_ID")!,
          client_secret: env("JOBBER_CLIENT_SECRET")!,
          grant_type: "refresh_token",
          refresh_token: row.refresh_token,
        }),
      });
      const t = await res.json().catch(() => ({}));
      if (!res.ok || !t.access_token) {
        if (res.status === 400 || res.status === 401) {
          // Without the lock, another process may have rotated the token a moment ago.
          const { data: latest } = await admin
            .from("jobber_tokens").select("*").eq("contractor_id", contractorId).maybeSingle();
          if (latest && latest.refresh_token !== row.refresh_token &&
              new Date(latest.expires_at).getTime() > Date.now()) {
            return latest.access_token as string;
          }
          throw new JobberReconnectRequired();
        }
        throw new Error(`Jobber token refresh failed (HTTP ${res.status})`);
      }

      // Save the new pair BEFORE anything else uses it; with rotation the old refresh token is dead.
      const { error: saveErr } = await admin.from("jobber_tokens").update({
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? row.refresh_token,
        expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("contractor_id", contractorId);
      if (saveErr) throw new Error(`Jobber token save failed: ${saveErr.message}`);
      return t.access_token as string;
    } finally {
      if (lockAvailable) await admin.rpc("jobber_release_refresh", { p_contractor: contractorId });
    }
  }
  throw new Error("Jobber sign-in refresh is busy. Try again in a moment.");
}

export class JobberGraphqlError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errors: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(errors: any[]) {
    super(`Jobber GraphQL error: ${JSON.stringify(errors).slice(0, 500)}`);
    this.name = "JobberGraphqlError";
    this.errors = errors;
  }
  /** True when Jobber refused because the app lacks a permission (scope) for part of the query. */
  get isPermissionError(): boolean {
    return this.errors.some((e) => {
      const text = `${e?.message ?? ""} ${e?.extensions?.code ?? ""}`.toLowerCase();
      return /scope|permission|not authorized|unauthorized|access denied|forbidden/.test(text);
    });
  }
}

/**
 * Runs a Jobber GraphQL query. Retries throttling, HTTP 429 and 5xx up to 3 times (2 s x attempt).
 * Throws JobberGraphqlError on GraphQL errors and on any userErrors returned by a mutation.
 */
export async function jobberGraphql(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  version: string = PULSE_JOBBER_VERSION,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(JOBBER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-JOBBER-GRAPHQL-VERSION": version,
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => ({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const throttled = res.status === 429 || (body?.errors ?? []).some((e: any) => e?.extensions?.code === "THROTTLED");
    if ((throttled || res.status >= 500) && attempt < 4) {
      await sleep(2000 * attempt);
      continue;
    }
    if (!res.ok && !body?.errors) throw new JobberGraphqlError([{ message: `HTTP ${res.status}` }]);
    if (body?.errors?.length) throw new JobberGraphqlError(body.errors);
    return body.data;
  }
}

/** Constant-time comparison for webhook signatures. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** Base64 HMAC-SHA256 of the raw request body with the app's client secret (Jobber webhook header). */
export async function jobberHmac(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Resolves a user to their company owner id (a team member resolves to their owner). */
export async function ownerIdOf(admin: Admin, userId: string): Promise<string> {
  const { data, error } = await admin
    .from("profiles").select("id, parent_contractor_id").eq("id", userId).maybeSingle();
  if (error) throw new Error(`profile read failed: ${error.message}`);
  return (data?.parent_contractor_id as string | null) ?? userId;
}
