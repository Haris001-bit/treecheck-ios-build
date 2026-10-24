// Financial Pulse: receives Plaid webhooks (A6).
// Plaid calls this with no Supabase login (config.toml: verify_jwt = false); every request must
// carry Plaid's signed Plaid-Verification JWT, checked against the exact raw body before anything
// is stored or done. Plaid waits 10 seconds for a reply and retries for 24 hours, so the reply
// comes first and the sync runs after it (EdgeRuntime.waitUntil, inline when unavailable).

import { isPlaidEnv, PlaidApiError, plaidPost, type PlaidEnv } from "../_shared/plaid.ts";
import { plaidDedupeKey, type PlaidWebhookBody, webhookAction } from "../_shared/pulse/plaidMap.ts";
import { classifyOwner, syncItem } from "../_shared/pulse/plaidSync.ts";
import { parseJwt, type PlaidJwk, verifyPlaidWebhook } from "../_shared/pulse/plaidWebhookVerify.ts";
import { adminClient, afterReply, json } from "../_shared/pulseHttp.ts";

// Verification keys by environment and kid, for the life of this function instance (bounded, so
// random kids sent to this public endpoint cannot grow it without limit).
const keys = new Map<string, PlaidJwk | null>();
const KID_FORMAT = /^[A-Za-z0-9-]{8,64}$/;
const MAX_CACHED_KEYS = 50;

async function keyFor(env: PlaidEnv, kid: string): Promise<PlaidJwk | null> {
  if (!KID_FORMAT.test(kid)) return null;
  const cacheKey = `${env}|${kid}`;
  if (keys.has(cacheKey)) return keys.get(cacheKey) ?? null;
  try {
    const res = await plaidPost(env, "/webhook_verification_key/get", { key_id: kid });
    let key = (res?.key ?? null) as PlaidJwk | null;
    // A key Plaid has expired is never accepted.
    if (key && key.expired_at !== null && key.expired_at !== undefined) key = null;
    if (keys.size >= MAX_CACHED_KEYS) keys.clear();
    keys.set(cacheKey, key);
    return key;
  } catch (e) {
    if (e instanceof PlaidApiError && e.errorCode === "INVALID_WEBHOOK_VERIFICATION_KEY_ID") {
      keys.set(cacheKey, null);
      return null;
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const receivedAt = Date.now();
  const raw = await req.text();

  let body: PlaidWebhookBody;
  try {
    body = JSON.parse(raw) as PlaidWebhookBody;
  } catch {
    return json({ error: "bad body" }, 400);
  }
  const env = body.environment;
  if (!isPlaidEnv(env)) return json({ error: "unknown environment" }, 400);

  const parts = parseJwt(req.headers.get("plaid-verification"));
  let verdict;
  try {
    const kid = parts?.header.kid;
    const jwk = kid ? await keyFor(env, kid) : null;
    verdict = await verifyPlaidWebhook(parts, jwk, raw, Math.floor(receivedAt / 1000));
  } catch (e) {
    // Plaid unreachable while fetching the key: ask Plaid to retry later.
    console.error("[plaid-webhook] key fetch failed", String((e as Error)?.message ?? e));
    return json({ error: "try again" }, 503);
  }
  if (!verdict.ok) {
    console.error("[plaid-webhook] rejected", verdict.reason);
    return json({ error: "invalid signature" }, 401);
  }

  const admin = adminClient();

  // One processing per item, code and 5-minute window (identical daily bodies are expected, and
  // the cursor compare-and-swap makes repeated syncs harmless anyway).
  const dedupeKey = plaidDedupeKey(body, receivedAt);
  const { error: dupErr } = await admin.from("pulse_events").insert({
    source: "plaid",
    external_id: body.item_id ?? null,
    event_type: `${body.webhook_type ?? ""}.${body.webhook_code ?? ""}`,
    dedupe_key: dedupeKey,
    payload: {
      webhook_type: body.webhook_type ?? null,
      webhook_code: body.webhook_code ?? null,
      item_id: body.item_id ?? null,
      error_code: body.error?.error_code ?? null,
      environment: env,
    },
  });
  if (dupErr?.code === "23505") return json({ ok: true, duplicate: true });

  // The item's status is recorded before replying: if that fails, Plaid gets an error and retries.
  let item: { id: string; owner_id: string } | null = null;
  let action = webhookAction(body);
  try {
    if (body.item_id) {
      const { data, error } = await admin.from("plaid_items")
        .select("id, owner_id, plaid_env, status, removed_at").eq("item_id", body.item_id).maybeSingle();
      if (error) throw new Error(`plaid_items read failed: ${error.message}`);
      // Not ours, another environment's, or already removed (a late webhook never brings it back).
      if (data && data.plaid_env === env && data.status !== "removed" && !data.removed_at) item = data;
    }
    if (item) {
      const patch: Record<string, unknown> = { ...action.item, last_webhook_at: new Date(receivedAt).toISOString() };
      if (action.item.status && action.item.status !== "active") patch.error_at = new Date(receivedAt).toISOString();
      const { error: uErr } = await admin.from("plaid_items").update(patch).eq("id", item.id);
      if (uErr) throw new Error(`plaid_items update failed: ${uErr.message}`);
      if (action.revokeAccountId) {
        // The owner stopped sharing this account at the bank: it no longer pays payroll.
        const { error: rErr } = await admin.from("plaid_accounts").update({ status: "revoked", use_for_payroll: false })
          .eq("owner_id", item.owner_id).eq("account_id", action.revokeAccountId);
        if (rErr) throw new Error(`plaid_accounts update failed: ${rErr.message}`);
      }
    } else {
      action = { ...action, sync: false };
    }
  } catch (e) {
    console.error("[plaid-webhook] status update failed", String((e as Error)?.message ?? e));
    if (!dupErr) await admin.from("pulse_events").delete().eq("dedupe_key", dedupeKey);
    return json({ error: "try again" }, 500);
  }

  // Syncing and sorting run after the reply (inline, within Plaid's 10 seconds, when the runtime
  // cannot run work after replying). Companies with Pulse switched off are not synced.
  const target = item;
  const inline = typeof (globalThis as unknown as { EdgeRuntime?: { waitUntil?: unknown } }).EdgeRuntime?.waitUntil !== "function";
  const work = (async () => {
    if (!target) return;
    const { data: access } = await admin.from("pulse_access").select("enabled").eq("owner_id", target.owner_id).maybeSingle();
    if (action.revokeAccountId) await classifyOwner(admin, target.owner_id);
    if (action.sync && access?.enabled) await syncItem(admin, target.id, Date.now() + (inline ? 7_000 : 120_000));
    if (!action.ignored) {
      await admin.from("pulse_snapshots").upsert({ owner_id: target.owner_id, dirty: true }, { onConflict: "owner_id" });
    }
  })().finally(async () => {
    if (!dupErr) {
      await admin.from("pulse_events").update({ processed_at: new Date().toISOString(), attempts: 1 }).eq("dedupe_key", dedupeKey);
    }
  });

  await afterReply(work);
  return json({ ok: true });
});
