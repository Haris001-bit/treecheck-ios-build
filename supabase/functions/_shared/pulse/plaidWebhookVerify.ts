// Financial Pulse: verification of Plaid webhooks (A6).
//
// Pure module (WebCrypto only; tested in src/lib/pulse/plaidWebhookVerify.test.ts with keys
// generated in the test).
//
// Plaid signs every webhook: the Plaid-Verification header is a JWT signed with ES256. Its header
// names the key (kid); the key comes from /webhook_verification_key/get. Its payload carries iat
// (issued at, seconds) and request_body_sha256 (hex SHA-256 of the exact raw body). A webhook is
// accepted only when the signature checks out with that key, it is at most 5 minutes old, and the
// raw body hashes to the claimed value. Anything else is rejected and nothing is stored.

export const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

export interface PlaidJwk {
  alg?: string;
  crv: string;
  kid: string;
  kty: string;
  use?: string;
  x: string;
  y: string;
  expired_at?: number | null;
}

export interface JwtParts {
  header: { alg?: string; kid?: string; typ?: string };
  payload: { iat?: number; request_body_sha256?: string };
  signingInput: string;
  signature: Uint8Array<ArrayBuffer>;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "malformed" | "bad_alg" | "no_key" | "bad_signature" | "too_old" | "body_mismatch" };

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlJson(s: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(s)));
}

/** Splits a compact JWT. Returns null when it is not a well-formed three-part token. */
export function parseJwt(token: string | null | undefined): JwtParts | null {
  if (!token) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return null;
  try {
    const header = base64UrlJson(parts[0]) as JwtParts["header"];
    const payload = base64UrlJson(parts[1]) as JwtParts["payload"];
    if (typeof header !== "object" || header === null || typeof payload !== "object" || payload === null) return null;
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: base64UrlToBytes(parts[2]) };
  } catch {
    return null;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Verifies a Plaid webhook. `jwk` is the key for the token's kid (the caller fetches and caches it;
 * null when Plaid has no such key). `nowSeconds` is the current Unix time.
 */
export async function verifyPlaidWebhook(
  parts: JwtParts | null,
  jwk: PlaidJwk | null,
  rawBody: string,
  nowSeconds: number,
): Promise<VerifyResult> {
  if (!parts) return { ok: false, reason: "malformed" };
  if (parts.header.alg !== "ES256") return { ok: false, reason: "bad_alg" };
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") return { ok: false, reason: "no_key" };

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, reason: "no_key" };
  }

  // JWS ES256 signatures are the raw 64-byte r || s, which is what WebCrypto expects.
  const valid = parts.signature.length === 64 && await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    parts.signature,
    new TextEncoder().encode(parts.signingInput),
  );
  if (!valid) return { ok: false, reason: "bad_signature" };

  const iat = parts.payload.iat;
  if (typeof iat !== "number" || !Number.isFinite(iat) || nowSeconds - iat > MAX_WEBHOOK_AGE_SECONDS || iat - nowSeconds > 60) {
    return { ok: false, reason: "too_old" };
  }

  const claimed = parts.payload.request_body_sha256;
  if (typeof claimed !== "string" || !timingSafeEqual(claimed.toLowerCase(), await sha256Hex(rawBody))) {
    return { ok: false, reason: "body_mismatch" };
  }
  return { ok: true };
}
