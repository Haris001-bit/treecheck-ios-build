// Financial Pulse: Sandbox test tool (W2-06, W2-11).
// POST { action: "reset_login" | "fire_webhook", item_row_id, webhook_code? }. Caller: a signed-in
// owner with Pulse on. Puts one of the caller's own Sandbox test banks into a state real banks get into
// (Plaid's /sandbox/item/reset_login and /sandbox/item/fire_webhook), so the real Reconnect and Add
// accounts flows can be tested end to end. Plaid then sends its signed webhook to plaid-webhook as it
// would for a real bank. Refuses anything that is not a Sandbox bank of a company on Sandbox
// (_shared/pulse/sandboxTools.ts): it can never touch a real bank. Returns no token, account or amount.

import { loadItem, plaidErrorDetail, plaidErrorText, plaidPost } from "../_shared/plaid.ts";
import { parseSandboxRequest, sandboxRefusal } from "../_shared/pulse/sandboxTools.ts";
import { adminClient, bodyOf, callerOf, corsHeaders, fail, json } from "../_shared/pulseHttp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const admin = adminClient();
  try {
    const caller = await callerOf(req, admin);
    if (!caller || caller.kind !== "user") return json({ ok: false, error: "Unauthorized" }, 401);
    if (!caller.ownerId) return fail("not_enabled", "Financial Pulse is not switched on for your company.");
    const ownerId = caller.ownerId;

    const request = parseSandboxRequest(await bodyOf(req));
    if (!request) return fail("bad_request", "Unknown test action.");

    const [{ data: access, error: aErr }, { data: item, error: iErr }] = await Promise.all([
      admin.from("pulse_access").select("plaid_env").eq("owner_id", ownerId).maybeSingle(),
      admin.from("plaid_items").select("id, owner_id, plaid_env, status, removed_at").eq("id", request.itemRowId).maybeSingle(),
    ]);
    if (aErr) throw new Error(`pulse_access read failed: ${aErr.message}`);
    if (iErr) throw new Error(`plaid_items read failed: ${iErr.message}`);
    const refusal = sandboxRefusal(ownerId, access?.plaid_env, item);
    if (refusal === "sandbox_only") return fail("sandbox_only", "This only works on Sandbox test banks.");
    if (refusal) return fail("not_found", "That bank connection was not found.");

    const ctx = await loadItem(admin, request.itemRowId);
    if (ctx.env !== "sandbox") return fail("sandbox_only", "This only works on Sandbox test banks.");
    if (request.action === "reset_login") {
      await plaidPost("sandbox", "/sandbox/item/reset_login", { access_token: ctx.accessToken });
    } else {
      await plaidPost("sandbox", "/sandbox/item/fire_webhook", {
        access_token: ctx.accessToken,
        webhook_type: request.webhookType,
        webhook_code: request.webhookCode,
      });
    }
    console.log("[pulse-sandbox]", request.action, request.action === "fire_webhook" ? request.webhookCode : "", request.itemRowId);
    return json({ ok: true, action: request.action });
  } catch (e) {
    console.error("[pulse-sandbox]", String((e as Error)?.message ?? e));
    return fail("plaid_error", plaidErrorText(e), plaidErrorDetail(e));
  }
});
