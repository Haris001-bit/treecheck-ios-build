// Financial Pulse: creates a Plaid Link token for the owner's bank window.
//
// POST { mode: "new" }                                   -> link a new bank or card
// POST { mode: "update", item_row_id, account_selection } -> reconnect (login again) or add accounts
// Caller: a company owner with Pulse switched on, whose session finished two-step sign-in (both
// modes open Plaid Link). The environment is the company's (pulse_access).
// A new link is checked against the company's and the team's connection limits first (the real,
// race-proof reservation happens at the exchange). Update mode never uses a connection.

import {
  isPlaidEnv, loadItem, plaidErrorDetail, plaidErrorText, plaidPost, PRODUCTION_SLOT_CAP, redirectUri, tokenKeyReady, webhookUrl,
} from "../_shared/plaid.ts";
import { LINK_ACCOUNT_FILTERS as ACCOUNT_FILTERS } from "../_shared/pulse/plaidMap.ts";
import { hasTwoStep, TWO_STEP_CODE, TWO_STEP_MESSAGE } from "../_shared/pulse/twoStep.ts";
import { adminClient, bodyOf, callerOf, corsHeaders, fail, json } from "../_shared/pulseHttp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const admin = adminClient();
  try {
    const caller = await callerOf(req, admin);
    if (!caller || caller.kind !== "user") return json({ ok: false, error: "Unauthorized" }, 401);
    if (!caller.ownerId) return fail("not_enabled", "Financial Pulse is not switched on for your company.");
    // callerOf verified the token, so its "aal" claim can be trusted.
    if (!hasTwoStep(req.headers.get("Authorization"))) return fail(TWO_STEP_CODE, TWO_STEP_MESSAGE);
    const ownerId = caller.ownerId;
    const body = await bodyOf(req);

    const { data: access, error: aErr } = await admin
      .from("pulse_access").select("plaid_env, max_items").eq("owner_id", ownerId).maybeSingle();
    if (aErr) throw new Error(`pulse_access read failed: ${aErr.message}`);
    if (!access || !isPlaidEnv(access.plaid_env)) return fail("not_enabled", "Financial Pulse is not switched on for your company.");
    const env = access.plaid_env;

    const base: Record<string, unknown> = {
      client_name: "TreeCheck",
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: ownerId },
    };
    const redirect = redirectUri();
    if (redirect) base.redirect_uri = redirect;

    if (body.mode === "update") {
      const itemRowId = typeof body.item_row_id === "string" ? body.item_row_id : "";
      const { data: item } = await admin.from("plaid_items").select("id, owner_id, status").eq("id", itemRowId).maybeSingle();
      if (!item || item.owner_id !== ownerId || item.status === "removed" || item.status === "revoked") {
        return fail("not_found", "That bank connection was not found. Link it again instead.");
      }
      const ctx = await loadItem(admin, itemRowId);
      const req2: Record<string, unknown> = { ...base, access_token: ctx.accessToken };
      if (body.account_selection === true) {
        req2.update = { account_selection_enabled: true };
        req2.account_filters = ACCOUNT_FILTERS;
      }
      const res = await plaidPost(ctx.env, "/link/token/create", req2);
      return json({ ok: true, link_token: res.link_token, expiration: res.expiration });
    }

    // New link: fail early when no connection can be made (the exchange re-checks under a lock),
    // including when the token key is missing (a connection that cannot be stored is never made).
    if (!(await tokenKeyReady(env, admin))) {
      console.error("[plaid-link-token] token key missing or not working for", env);
      return fail("not_configured", "Bank linking is not set up yet. Please contact TreeCheck.");
    }
    const { count: live, error: cErr } = await admin.from("plaid_items")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId).eq("plaid_env", env).neq("status", "removed").is("removed_at", null);
    if (cErr) throw new Error(`plaid_items count failed: ${cErr.message}`);
    if ((live ?? 0) >= access.max_items) {
      return fail("company_limit", "Your company has reached its number of bank connections.");
    }
    if (env === "production" && PRODUCTION_SLOT_CAP !== null) {
      const { data: used, error: uErr } = await admin.rpc("plaid_slots_used", { p_env: "production" });
      if (uErr) throw new Error(`slot count failed: ${uErr.message}`);
      if (Number(used ?? 0) >= PRODUCTION_SLOT_CAP) {
        return fail("team_limit", "TreeCheck's bank connections are full right now. Please contact TreeCheck.");
      }
    }

    const res = await plaidPost(env, "/link/token/create", {
      ...base,
      products: ["transactions"],
      transactions: { days_requested: 730 },
      webhook: webhookUrl(),
      account_filters: ACCOUNT_FILTERS,
    });
    return json({ ok: true, link_token: res.link_token, expiration: res.expiration });
  } catch (e) {
    console.error("[plaid-link-token]", String((e as Error)?.message ?? e));
    return fail(e instanceof Error && e.name === "PlaidNotConfigured" ? "not_configured" : "plaid_error", plaidErrorText(e), plaidErrorDetail(e));
  }
});
