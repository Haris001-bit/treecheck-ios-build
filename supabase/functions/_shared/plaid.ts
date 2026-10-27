// Financial Pulse: the one place edge functions talk to Plaid.
//
// * Environment per company and per item (pulse_access.plaid_env / plaid_items.plaid_env), never
//   one global switch: sandbox testing and Mark's production bank can run side by side.
// * Secrets (Lovable Cloud secrets, names only here): PLAID_CLIENT_ID (one per Plaid team),
//   PLAID_SECRET_SANDBOX, PLAID_SECRET_PRODUCTION, PLAID_TOKEN_KEY_SANDBOX, PLAID_TOKEN_KEY_PRODUCTION
//   (base64 32-byte AES keys; the production key is escrowed in Mark's password manager), optional
//   PLAID_REDIRECT_URI (must also be on the Plaid dashboard's allowed list).
// * Access tokens are decrypted only in memory, never returned, never logged. Plaid data is never
//   sent to any AI service.

import { decryptToken, encryptToken, importTokenKey, keyCanaryOk, type EncryptedToken } from "./pulse/plaidCrypto.ts";

export type PlaidEnv = "sandbox" | "production";

export const PLAID_API_VERSION = "2020-09-14";
/**
 * TreeCheck-wide limit on production bank connections, or null for none. Plaid approved the paid plan on
 * 2026-10-26, which has no connection limit (each connection is billed). On the 10-connection Trial it was 9,
 * so one stayed spare. plaid_reserve_slot skips the check when it is null.
 */
export const PRODUCTION_SLOT_CAP: number | null = null;
/** How long a slot reservation made just before a token exchange stays live. */
export const RESERVATION_MINUTES = 10;

const BASE: Record<PlaidEnv, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export class PlaidNotConfigured extends Error {
  constructor(what: string) {
    super(`Plaid is not configured: ${what} is missing`);
    this.name = "PlaidNotConfigured";
  }
}

/** A Plaid API error. Branch on errorCode (Plaid's messages are not for programs). */
export class PlaidApiError extends Error {
  constructor(
    public status: number,
    public errorType: string | null,
    public errorCode: string | null,
    public displayMessage: string | null,
    public requestId: string | null,
  ) {
    super(`Plaid error ${errorCode ?? status}${requestId ? ` (request ${requestId})` : ""}`);
    this.name = "PlaidApiError";
  }
}

export function isPlaidEnv(v: unknown): v is PlaidEnv {
  return v === "sandbox" || v === "production";
}

function secretFor(env: PlaidEnv): { clientId: string; secret: string } {
  const clientId = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get(env === "sandbox" ? "PLAID_SECRET_SANDBOX" : "PLAID_SECRET_PRODUCTION");
  if (!clientId) throw new PlaidNotConfigured("PLAID_CLIENT_ID");
  if (!secret) throw new PlaidNotConfigured(env === "sandbox" ? "PLAID_SECRET_SANDBOX" : "PLAID_SECRET_PRODUCTION");
  return { clientId, secret };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs to Plaid. Retries rate limits and server errors twice (1 s, then 3 s) unless retry is false
 * (the token exchange: a retry could hide whether Plaid made the connection). Throws PlaidApiError
 * for Plaid errors (status 0 when Plaid could not be reached) and PlaidNotConfigured when the
 * environment's secrets are missing.
 */
export async function plaidPost(
  env: PlaidEnv,
  path: string,
  body: Record<string, unknown>,
  opts: { retry?: boolean } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { clientId, secret } = secretFor(env);
  const maxAttempt = opts.retry === false ? 0 : 2;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE[env]}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
          "Plaid-Version": PLAID_API_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch {
      if (attempt < maxAttempt) {
        await sleep(attempt === 0 ? 1000 : 3000);
        continue;
      }
      throw new PlaidApiError(0, null, "NETWORK_ERROR", null, null);
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxAttempt) {
      await sleep(attempt === 0 ? 1000 : 3000);
      continue;
    }
    throw new PlaidApiError(
      res.status,
      data?.error_type ?? null,
      data?.error_code ?? null,
      data?.display_message ?? null,
      data?.request_id ?? null,
    );
  }
}

const keyCache = new Map<PlaidEnv, Promise<CryptoKey>>();

export function tokenKey(env: PlaidEnv): Promise<CryptoKey> {
  let k = keyCache.get(env);
  if (!k) {
    k = importTokenKey(Deno.env.get(env === "sandbox" ? "PLAID_TOKEN_KEY_SANDBOX" : "PLAID_TOKEN_KEY_PRODUCTION"));
    k.catch(() => keyCache.delete(env));
    keyCache.set(env, k);
  }
  return k;
}

/** True when the environment's token key is set and works. Checked before any exchange. */
/**
 * True when the environment's token key is present and valid and, once a connection is stored for
 * that environment, opens it. A different valid key (for example the other environment's) would
 * otherwise save new connections that can never be read again once the escrowed key is back.
 */
export async function tokenKeyReady(env: PlaidEnv, admin?: Admin): Promise<boolean> {
  try {
    const key = await tokenKey(env);
    if (!(await keyCanaryOk(key))) return false;
    if (!admin) return true;
    const { data: items, error } = await admin.from("plaid_items").select("id")
      .eq("plaid_env", env).neq("status", "removed").limit(20);
    if (error) return false;
    const ids = (items ?? []).map((i: { id: string }) => i.id);
    if (ids.length === 0) return true;
    const { data: sec, error: sErr } = await admin.from("plaid_item_secrets")
      .select("access_token_ct, access_token_iv").in("item_row_id", ids).limit(1);
    if (sErr) return false;
    if (!sec || sec.length === 0) return true;
    await decryptToken(key, sec[0].access_token_ct, sec[0].access_token_iv);
    return true;
  } catch {
    return false;
  }
}

export async function sealToken(env: PlaidEnv, accessToken: string): Promise<EncryptedToken> {
  return await encryptToken(await tokenKey(env), accessToken);
}

export interface ItemContext {
  itemRowId: string;
  ownerId: string;
  env: PlaidEnv;
  itemId: string;
  status: string;
  accessToken: string;
}

/** Loads an item and decrypts its access token (in memory only). */
export async function loadItem(admin: Admin, itemRowId: string): Promise<ItemContext> {
  const { data: item, error } = await admin
    .from("plaid_items").select("id, owner_id, plaid_env, item_id, status").eq("id", itemRowId).maybeSingle();
  if (error) throw new Error(`plaid_items read failed: ${error.message}`);
  if (!item) throw new Error("Plaid item not found");
  const { data: sec, error: sErr } = await admin
    .from("plaid_item_secrets").select("access_token_ct, access_token_iv").eq("item_row_id", itemRowId).maybeSingle();
  if (sErr) throw new Error(`plaid_item_secrets read failed: ${sErr.message}`);
  if (!sec) throw new Error("Plaid item has no stored access token");
  if (!isPlaidEnv(item.plaid_env)) throw new Error("Plaid item has an unknown environment");
  const accessToken = await decryptToken(await tokenKey(item.plaid_env), sec.access_token_ct, sec.access_token_iv);
  return {
    itemRowId: item.id, ownerId: item.owner_id, env: item.plaid_env, itemId: item.item_id,
    status: item.status, accessToken,
  };
}

export function webhookUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1/plaid-webhook`;
}

export function redirectUri(): string | null {
  const v = Deno.env.get("PLAID_REDIRECT_URI");
  return v && v.startsWith("https://") ? v : null;
}

/** Which Pulse secrets exist (names only, never values), for the admin health check. */
export function secretPresence(): Record<string, boolean> {
  const names = [
    "PLAID_CLIENT_ID", "PLAID_SECRET_SANDBOX", "PLAID_SECRET_PRODUCTION",
    "PLAID_TOKEN_KEY_SANDBOX", "PLAID_TOKEN_KEY_PRODUCTION", "PLAID_REDIRECT_URI",
  ];
  return Object.fromEntries(names.map((n) => [n, !!Deno.env.get(n)]));
}

/** Friendly text for Plaid errors the owner can act on. */
/**
 * Plaid's own error code and request id, added to failure replies so support can tell what Plaid
 * said without reading server logs. Neither is secret (no token, account or amount).
 */
export function plaidErrorDetail(e: unknown): { plaid_error_code: string | null; plaid_request_id: string | null } {
  if (e instanceof PlaidApiError) return { plaid_error_code: e.errorCode, plaid_request_id: e.requestId };
  if (e instanceof PlaidNotConfigured) return { plaid_error_code: "NOT_CONFIGURED", plaid_request_id: null };
  return { plaid_error_code: null, plaid_request_id: null };
}

export function plaidErrorText(e: unknown): string {
  if (e instanceof PlaidNotConfigured) return "Bank linking is not set up yet. Please contact TreeCheck.";
  if (e instanceof PlaidApiError) {
    switch (e.errorCode) {
      case "ITEM_LOGIN_REQUIRED": return "Your bank needs you to log in again. Use Reconnect.";
      case "INVALID_PUBLIC_TOKEN": return "The bank connection timed out. Please link again.";
      case "INVALID_LINK_TOKEN": return "The bank window expired. Please try again.";
      case "INSTITUTION_DOWN":
      case "INSTITUTION_NOT_RESPONDING":
      case "INSTITUTION_NOT_AVAILABLE": return "Your bank is not responding right now. Please try again later.";
      case "TRIAL_CONNECTION_LIMIT": return "TreeCheck's bank connections are full right now. Please contact TreeCheck.";
      case "NETWORK_ERROR": return "Plaid could not be reached. Please try again in a moment.";
      default: return "Plaid could not complete that request. Please try again.";
    }
  }
  return "Something went wrong. Please try again.";
}
