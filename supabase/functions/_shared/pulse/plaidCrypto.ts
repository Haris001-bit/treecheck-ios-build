// Financial Pulse: encryption of Plaid access tokens at rest (AES-256-GCM, WebCrypto).
//
// Pure module (WebCrypto only, available in the edge runtime and in the vitest suite:
// src/lib/pulse/plaidCrypto.test.ts).
//
// A Plaid access token is the key to a company's bank data, so it is stored only encrypted, in the
// sealed table plaid_item_secrets, with a fresh random 12-byte IV per token. The 32-byte key lives
// only in the Lovable secret PLAID_TOKEN_KEY_<ENV> (base64) and in Mark's password manager (escrow):
// losing it would mean every company re-linking its bank. key_version lets a later key rotation
// re-encrypt tokens one by one.

export const TOKEN_KEY_VERSION = 1;

/** Text encrypted with the key and checked by the health check, to prove the key still works. */
export const KEY_CANARY_TEXT = "financial-pulse-key-canary";

export interface EncryptedToken {
  ct: string; // base64 ciphertext (with the GCM tag)
  iv: string; // base64 12-byte IV
  keyVersion: number;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Imports the base64 32-byte key. Throws a message that never contains the key itself. */
export async function importTokenKey(base64Key: string | undefined | null): Promise<CryptoKey> {
  if (!base64Key) throw new Error("Plaid token key is not configured");
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromBase64(base64Key.trim());
  } catch {
    throw new Error("Plaid token key is not valid base64");
  }
  if (raw.length !== 32) throw new Error(`Plaid token key must be 32 bytes, got ${raw.length}`);
  return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(key: CryptoKey, plaintext: string): Promise<EncryptedToken> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { ct: toBase64(new Uint8Array(ct)), iv: toBase64(iv), keyVersion: TOKEN_KEY_VERSION };
}

/** Decrypts a stored token. A wrong key or tampered data throws (GCM authentication). */
export async function decryptToken(key: CryptoKey, ct: string, iv: string): Promise<string> {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(ct));
  } catch {
    throw new Error("Plaid access token could not be decrypted (wrong key or damaged data)");
  }
  return new TextDecoder().decode(plain);
}

/** Round-trips the canary text: true when the key encrypts and decrypts correctly. */
export async function keyCanaryOk(key: CryptoKey): Promise<boolean> {
  const e = await encryptToken(key, KEY_CANARY_TEXT);
  return (await decryptToken(key, e.ct, e.iv)) === KEY_CANARY_TEXT;
}
