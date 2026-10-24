// Financial Pulse: removes a bank connection (support action, A7).
// POST { item_row_id, force? }. Caller: the service role or an admin. There is no owner-facing remove
// button in V1 (D13): on Plaid's Trial a removed connection is never given back.
// Plaid /item/remove first (stops the connection and its billing), then the stored token is
// deleted, the accounts and their transactions are deleted, and the item row stays as "removed".
// The slot ledger keeps the connection (it still counts).

import { loadItem, PlaidApiError, plaidErrorDetail, plaidErrorText, plaidPost } from "../_shared/plaid.ts";
import { classifyOwner } from "../_shared/pulse/plaidSync.ts";
import { adminClient, bodyOf, callerOf, corsHeaders, fail, json } from "../_shared/pulseHttp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const admin = adminClient();
  try {
    const caller = await callerOf(req, admin);
    if (!caller || (caller.kind === "user" && !caller.isAdmin)) return json({ ok: false, error: "Forbidden" }, 403);
    const body = await bodyOf(req);
    const itemRowId = typeof body.item_row_id === "string" ? body.item_row_id : "";
    const { data: item } = await admin.from("plaid_items").select("id, owner_id, item_id, status").eq("id", itemRowId).maybeSingle();
    if (!item) return fail("not_found", "Bank connection not found.");
    if (item.status === "removed") return json({ ok: true, already_removed: true });

    try {
      const ctx = await loadItem(admin, itemRowId);
      await plaidPost(ctx.env, "/item/remove", { access_token: ctx.accessToken, reason_code: "OTHER" });
    } catch (e) {
      const gone = e instanceof PlaidApiError && (e.errorCode === "ITEM_NOT_FOUND" || e.errorCode === "INVALID_ACCESS_TOKEN");
      const unreadable = e instanceof Error && /no stored access token|could not be decrypted/.test(e.message);
      // An unreadable token usually means the wrong key is deployed: deleting it now would leave the
      // connection running at Plaid for good. Only go ahead when asked to explicitly.
      if (unreadable && body.force !== true) {
        return fail("token_unreadable", "The stored bank token cannot be read (check the token key). Nothing was removed.");
      }
      if (!gone && !unreadable) throw e;
    }

    const now = new Date().toISOString();
    const steps: Array<[string, { error: { message: string } | null }]> = [
      ["secret", await admin.from("plaid_item_secrets").delete().eq("item_row_id", itemRowId)],
      ["accounts", await admin.from("plaid_accounts").delete().eq("item_row_id", itemRowId)],
      ["item", await admin.from("plaid_items").update({ status: "removed", removed_at: now }).eq("id", itemRowId)],
      ["ledger", await admin.from("plaid_slot_ledger").update({ removed_at: now }).eq("item_id", item.item_id)],
    ];
    for (const [what, r] of steps) if (r.error) throw new Error(`${what} cleanup failed: ${r.error.message}`);
    // Transfers and card payments paired with the removed accounts are sorted again.
    await classifyOwner(admin, item.owner_id);
    await admin.from("pulse_snapshots").upsert({ owner_id: item.owner_id, dirty: true }, { onConflict: "owner_id" });
    return json({ ok: true });
  } catch (e) {
    console.error("[plaid-item-remove]", String((e as Error)?.message ?? e));
    return fail("plaid_error", plaidErrorText(e), plaidErrorDetail(e));
  }
});
