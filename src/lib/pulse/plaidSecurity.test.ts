// Financial Pulse: token encryption and Plaid webhook verification (synthetic keys only).
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  decryptToken,
  encryptToken,
  importTokenKey,
  keyCanaryOk,
} from "../../../supabase/functions/_shared/pulse/plaidCrypto";
import {
  MAX_WEBHOOK_AGE_SECONDS,
  parseJwt,
  type PlaidJwk,
  sha256Hex,
  verifyPlaidWebhook,
} from "../../../supabase/functions/_shared/pulse/plaidWebhookVerify";

beforeAll(() => {
  // The edge runtime has WebCrypto; make sure the test DOM does too.
  if (!globalThis.crypto?.subtle) vi.stubGlobal("crypto", webcrypto);
});

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === "string" ? Buffer.from(bytes) : bytes).toString("base64url");

describe("access token encryption", () => {
  const keyB64 = b64(new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256));

  it("round-trips a token, with a fresh IV every time", async () => {
    const key = await importTokenKey(keyB64);
    const a = await encryptToken(key, "access-sandbox-123");
    const b = await encryptToken(key, "access-sandbox-123");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(a.ct).not.toContain("access-sandbox");
    expect(await decryptToken(key, a.ct, a.iv)).toBe("access-sandbox-123");
    expect(a.keyVersion).toBe(1);
  });

  it("refuses a wrong key or damaged data, without leaking anything", async () => {
    const key = await importTokenKey(keyB64);
    const other = await importTokenKey(b64(new Uint8Array(32).fill(9)));
    const e = await encryptToken(key, "access-sandbox-123");
    await expect(decryptToken(other, e.ct, e.iv)).rejects.toThrow(/could not be decrypted/);
    const damaged = e.ct.slice(0, -4) + (e.ct.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decryptToken(key, damaged, e.iv)).rejects.toThrow(/could not be decrypted/);
  });

  it("rejects a missing, malformed or short key with a message that never contains the key", async () => {
    await expect(importTokenKey(undefined)).rejects.toThrow(/not configured/);
    await expect(importTokenKey("")).rejects.toThrow(/not configured/);
    await expect(importTokenKey("%%%not-base64%%%")).rejects.toThrow(/base64|32 bytes/);
    const short = b64(new Uint8Array(16));
    await expect(importTokenKey(short)).rejects.toThrow(/32 bytes, got 16/);
  });

  it("passes the canary check with a good key", async () => {
    expect(await keyCanaryOk(await importTokenKey(keyB64))).toBe(true);
  });
});

describe("Plaid webhook verification", () => {
  let jwk: PlaidJwk;
  let privateKey: CryptoKey;
  const now = 1_790_000_000;

  beforeAll(async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    privateKey = pair.privateKey;
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
    jwk = { alg: "ES256", crv: "P-256", kid: "kid-1", kty: "EC", use: "sig", x: pub.x as string, y: pub.y as string };
  });

  async function sign(body: string, over: { alg?: string; iat?: number; hash?: string; key?: CryptoKey } = {}) {
    const header = b64url(JSON.stringify({ alg: over.alg ?? "ES256", kid: "kid-1", typ: "JWT" }));
    const payload = b64url(JSON.stringify({ iat: over.iat ?? now - 10, request_body_sha256: over.hash ?? await sha256Hex(body) }));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, over.key ?? privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
  }

  const body = JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1" }, null, 2);

  it("accepts a correctly signed, fresh webhook whose body matches", async () => {
    expect(await verifyPlaidWebhook(parseJwt(await sign(body)), jwk, body, now)).toEqual({ ok: true });
  });

  it("hashes the exact raw bytes: reformatted JSON does not match", async () => {
    const token = await sign(body);
    const reformatted = JSON.stringify(JSON.parse(body));
    expect(await verifyPlaidWebhook(parseJwt(token), jwk, reformatted, now)).toEqual({ ok: false, reason: "body_mismatch" });
  });

  it("rejects a wrong algorithm, a missing or wrong key, a forged signature", async () => {
    expect(await verifyPlaidWebhook(parseJwt(await sign(body, { alg: "HS256" })), jwk, body, now)).toEqual({ ok: false, reason: "bad_alg" });
    expect(await verifyPlaidWebhook(parseJwt(await sign(body)), null, body, now)).toEqual({ ok: false, reason: "no_key" });
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    expect(await verifyPlaidWebhook(parseJwt(await sign(body, { key: other.privateKey })), jwk, body, now))
      .toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a webhook older than 5 minutes (and one from the future)", async () => {
    const edge = await sign(body, { iat: now - MAX_WEBHOOK_AGE_SECONDS });
    expect(await verifyPlaidWebhook(parseJwt(edge), jwk, body, now)).toEqual({ ok: true });
    const old = await sign(body, { iat: now - MAX_WEBHOOK_AGE_SECONDS - 1 });
    expect(await verifyPlaidWebhook(parseJwt(old), jwk, body, now)).toEqual({ ok: false, reason: "too_old" });
    const future = await sign(body, { iat: now + 120 });
    expect(await verifyPlaidWebhook(parseJwt(future), jwk, body, now)).toEqual({ ok: false, reason: "too_old" });
  });

  it("rejects a tampered body or a claimed hash that does not match", async () => {
    const token = await sign(body);
    expect(await verifyPlaidWebhook(parseJwt(token), jwk, body.replace("item-1", "item-2"), now))
      .toEqual({ ok: false, reason: "body_mismatch" });
    const wrongHash = await sign(body, { hash: "0".repeat(64) });
    expect(await verifyPlaidWebhook(parseJwt(wrongHash), jwk, body, now)).toEqual({ ok: false, reason: "body_mismatch" });
  });

  it("treats missing or malformed tokens as malformed", async () => {
    for (const t of [null, "", "abc", "a.b", "a..c", "!!.??.**"]) {
      expect(await verifyPlaidWebhook(parseJwt(t), jwk, body, now)).toEqual({ ok: false, reason: "malformed" });
    }
  });
});
