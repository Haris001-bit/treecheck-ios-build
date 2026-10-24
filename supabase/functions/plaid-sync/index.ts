// Financial Pulse: syncs a company's linked banks on demand.
// POST { item_row_id?, after_update?, account_selection? }. Caller: the service role (any item;
// item_row_id required), or a company owner with Pulse on (their own items only; all of them when
// item_row_id is left out).
// after_update: true right after the owner finished Reconnect / Add accounts in Plaid Link for that
// item: the login problem is fixed, so the item is marked active and the numbers are marked changed
// (Plaid sends no webhook for a fix made in our own update mode). "New accounts available" is cleared
// only when account_selection is true too, i.e. the owner was shown Plaid's account picker.
// One bank failing never stops the others.

import { plaidErrorDetail, plaidErrorText } from "../_shared/plaid.ts";
import { markDirty, syncItem } from "../_shared/pulse/plaidSync.ts";
import { adminClient, bodyOf, callerOf, corsHeaders, fail, json } from "../_shared/pulseHttp.ts";

const BUDGET_MS = 100_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const admin = adminClient();
  try {
    const caller = await callerOf(req, admin);
    if (!caller) return json({ ok: false, error: "Unauthorized" }, 401);
    const body = await bodyOf(req);
    const one = typeof body.item_row_id === "string" && body.item_row_id ? body.item_row_id : null;

    let ids: string[];
    if (caller.kind === "service") {
      if (!one) return fail("bad_request", "item_row_id required");
      ids = [one];
    } else {
      if (!caller.ownerId) return fail("not_enabled", "Financial Pulse is not switched on for your company.");
      let q = admin.from("plaid_items").select("id").eq("owner_id", caller.ownerId).not("status", "in", "(removed,revoked)");
      if (one) q = q.eq("id", one);
      const { data, error } = await q;
      if (error) throw new Error(`plaid_items read failed: ${error.message}`);
      ids = (data ?? []).map((r: { id: string }) => r.id);
      if (one && ids.length === 0) return fail("not_found", "That bank connection was not found.");
    }

    if (one && body.after_update === true && caller.kind === "user") {
      const fixed: Record<string, unknown> = { status: "active", error_code: null };
      if (body.account_selection === true) fixed.new_accounts_available = false;
      const { error: aErr } = await admin.from("plaid_items")
        .update(fixed)
        .eq("id", one).eq("owner_id", caller.ownerId)
        .in("status", ["active", "login_required", "pending_expiration", "pending_disconnect", "error"]);
      if (aErr) throw new Error(`plaid_items update failed: ${aErr.message}`);
      await markDirty(admin, caller.ownerId!);
    }

    const deadline = Date.now() + BUDGET_MS;
    const totals = { items: 0, added: 0, modified: 0, removed: 0 };
    const problems: string[] = [];
    for (const id of ids) {
      if (Date.now() > deadline) break;
      try {
        const r = await syncItem(admin, id, deadline);
        totals.items += 1;
        totals.added += r.added;
        totals.modified += r.modified;
        totals.removed += r.removed;
        if (r.error) problems.push(r.error);
      } catch (e) {
        console.error("[plaid-sync] item failed", id, String((e as Error)?.message ?? e));
        problems.push("error");
      }
    }
    return json({ ok: true, ...totals, problems });
  } catch (e) {
    console.error("[plaid-sync]", String((e as Error)?.message ?? e));
    return fail("plaid_error", plaidErrorText(e), plaidErrorDetail(e));
  }
});
