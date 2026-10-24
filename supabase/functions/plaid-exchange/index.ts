// Financial Pulse: turns a Plaid Link success into a stored bank connection.
//
// POST { public_token, metadata: { institution, accounts, link_session_id }, consent_version }
// Caller: a company owner with Pulse switched on, whose session finished two-step sign-in.
// On Plaid's free Trial every exchanged public token uses one of 10 connections forever, so the
// order is strict (A7):
// 1. The token key must work first: a connection is never made that cannot be stored.
// 2. Refuse duplicate accounts (same mask and name as a live account), before anything is used up.
// 3. Record the owner's consent (A14).
// 4. Reserve under the database lock (plaid_reserve_slot): company limit, team cap, and "this bank
//    is already linked or being linked" (use Reconnect / Add accounts instead).
// 5. Mark the ledger row 'exchanging' (counted, never expires) BEFORE calling Plaid, so an exchange
//    whose outcome is unclear is always counted.
// 6. Exchange ONCE (no automatic retry). A clear refusal from Plaid marks the row 'failed'; anything
//    unclear (network error, Plaid server error) leaves it 'exchanging' for support to resolve.
// 7. Store the item, its encrypted token and the ledger's 'exchanged' state in one transaction
//    (plaid_store_item), retried. If that still fails, the encrypted token is parked on the sealed
//    ledger row so support can finish it. A working connection is never thrown away.
// 8. Save the accounts now and start the first transactions sync after replying (Plaid only sends
//    updates for an item after its first sync).

import {
  isPlaidEnv, PlaidApiError, plaidErrorDetail, plaidErrorText, plaidPost, PRODUCTION_SLOT_CAP, RESERVATION_MINUTES, sealToken,
  tokenKeyReady,
} from "../_shared/plaid.ts";
import { duplicatesExisting } from "../_shared/pulse/plaidMap.ts";
import { saveAccounts, syncItem } from "../_shared/pulse/plaidSync.ts";
import { hasTwoStep, TWO_STEP_CODE, TWO_STEP_MESSAGE } from "../_shared/pulse/twoStep.ts";
import { type Admin, adminClient, afterReply, bodyOf, callerOf, corsHeaders, fail, json } from "../_shared/pulseHttp.ts";

/** Consent texts the setup page may show (bump when the wording changes). */
const CONSENT_VERSIONS = new Set(["pulse-consent-1", "pulse-consent-2"]);

interface LinkAccount { id: string; name: string | null; mask: string | null; type: string | null; subtype: string | null }

function readMetadata(m: unknown): { institutionId: string | null; institutionName: string | null; accounts: LinkAccount[]; linkSessionId: string | null } {
  const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
  const inst = (o.institution && typeof o.institution === "object" ? o.institution : null) as Record<string, unknown> | null;
  const accounts = Array.isArray(o.accounts) ? o.accounts : [];
  const s = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.slice(0, 200) : null);
  return {
    institutionId: inst ? s(inst.institution_id) : null,
    institutionName: inst ? s(inst.name) : null,
    accounts: accounts
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .slice(0, 50)
      .map((a) => ({ id: String(a.id ?? ""), name: s(a.name), mask: s(a.mask), type: s(a.type), subtype: s(a.subtype) })),
    linkSessionId: s(o.link_session_id),
  };
}

async function setLedger(admin: Admin, ledgerId: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("plaid_slot_ledger").update(patch).eq("id", ledgerId);
  if (error) throw new Error(`ledger update failed: ${error.message}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A Plaid refusal that proves no connection was made (the public token was not accepted). */
function definiteRefusal(e: unknown): boolean {
  return e instanceof PlaidApiError && e.status >= 400 && e.status < 500 && e.status !== 429;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const admin = adminClient();
  try {
    const caller = await callerOf(req, admin);
    if (!caller || caller.kind !== "user") return json({ ok: false, error: "Unauthorized" }, 401);
    if (!caller.ownerId) return fail("not_enabled", "Financial Pulse is not switched on for your company.");
    // Before anything is used up. callerOf verified the token, so its "aal" claim can be trusted.
    if (!hasTwoStep(req.headers.get("Authorization"))) return fail(TWO_STEP_CODE, TWO_STEP_MESSAGE);
    const ownerId = caller.ownerId;
    const body = await bodyOf(req);
    const publicToken = typeof body.public_token === "string" ? body.public_token : "";
    if (!publicToken) return fail("bad_request", "The bank connection did not finish. Please try again.");
    if (typeof body.consent_version !== "string" || !CONSENT_VERSIONS.has(body.consent_version)) {
      return fail("bad_request", "Please agree to the bank-linking terms first.");
    }
    const meta = readMetadata(body.metadata);

    const { data: access, error: aErr } = await admin.from("pulse_access").select("plaid_env").eq("owner_id", ownerId).maybeSingle();
    if (aErr) throw new Error(`pulse_access read failed: ${aErr.message}`);
    if (!access || !isPlaidEnv(access.plaid_env)) return fail("not_enabled", "Financial Pulse is not switched on for your company.");
    const env = access.plaid_env;

    // 1. Never make a connection that cannot be stored.
    if (!(await tokenKeyReady(env, admin))) {
      console.error("[plaid-exchange] token key missing or not working for", env);
      return fail("not_configured", "Bank linking is not set up yet. Please contact TreeCheck.");
    }

    // 2. Duplicate accounts (any bank record), before anything is used up.
    const { data: existing, error: eErr } = await admin.from("plaid_accounts")
      .select("mask, name, plaid_items!inner(status, removed_at, plaid_env)").eq("owner_id", ownerId);
    if (eErr) throw new Error(`plaid_accounts read failed: ${eErr.message}`);
    const live = (existing ?? []).filter((a: { plaid_items: { status: string; removed_at: string | null; plaid_env: string } }) =>
      a.plaid_items && a.plaid_items.status !== "removed" && !a.plaid_items.removed_at && a.plaid_items.plaid_env === env);
    if (duplicatesExisting(meta.accounts, live)) {
      return fail("duplicate_accounts", "These accounts are already linked.");
    }

    // 3. Consent.
    const { error: cErr } = await admin.from("plaid_link_consents").insert({
      owner_id: ownerId, user_id: caller.userId, consent_version: body.consent_version,
      link_session_id: meta.linkSessionId, institution_id: meta.institutionId,
    });
    if (cErr) throw new Error(`consent save failed: ${cErr.message}`);

    // 4. Reserve under the lock (limits and same bank).
    const { data: slot, error: rErr } = await admin.rpc("plaid_reserve_slot", {
      p_owner: ownerId, p_env: env, p_team_cap: PRODUCTION_SLOT_CAP, p_minutes: RESERVATION_MINUTES,
      p_institution_id: meta.institutionId,
    });
    if (rErr) throw new Error(`slot reservation failed: ${rErr.message}`);
    if (!slot?.ok) {
      switch (slot?.reason) {
        case "same_institution": return fail("same_institution", "This bank is already linked. Use Reconnect or Add accounts on it in the list above.");
        case "company_limit": return fail("company_limit", "Your company has reached its number of bank connections.");
        case "team_limit": return fail("team_limit", "TreeCheck's bank connections are full right now. Please contact TreeCheck.");
        default: return fail("not_enabled", "Financial Pulse is not switched on for your company.");
      }
    }
    const ledgerId = Number(slot.ledger_id);

    // 5. Counted from here on, whatever happens next.
    await setLedger(admin, ledgerId, { status: "exchanging", expires_at: null, link_session_id: meta.linkSessionId });

    // 6. Exchange once.
    let exchanged: { access_token: string; item_id: string };
    try {
      exchanged = await plaidPost(env, "/item/public_token/exchange", { public_token: publicToken }, { retry: false });
      if (!exchanged?.access_token || !exchanged?.item_id) throw new PlaidApiError(0, null, "EMPTY_RESPONSE", null, null);
    } catch (e) {
      if (definiteRefusal(e)) {
        await setLedger(admin, ledgerId, { status: "failed" });
        return fail("plaid_error", plaidErrorText(e), plaidErrorDetail(e));
      }
      console.error("[plaid-exchange] exchange outcome unclear; ledger row left exchanging", ledgerId);
      return fail("exchange_unclear", "We could not confirm the bank connection. Please contact TreeCheck before trying again.");
    }

    // 7. Store atomically (retried); park the encrypted token if storing keeps failing.
    const sealed = await sealToken(env, exchanged.access_token);
    let itemRowId: string | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !itemRowId; attempt++) {
      const { data, error } = await admin.rpc("plaid_store_item", {
        p_ledger_id: ledgerId, p_owner: ownerId, p_env: env, p_item_id: exchanged.item_id,
        p_institution_id: meta.institutionId, p_institution_name: meta.institutionName, p_linked_by: caller.userId,
        p_ct: sealed.ct, p_iv: sealed.iv, p_key_version: sealed.keyVersion,
      });
      if (!error && typeof data === "string") itemRowId = data;
      else {
        lastError = error?.message ?? "no item id returned";
        await sleep(500 * (attempt + 1));
      }
    }
    if (!itemRowId) {
      // Park the encrypted token on the sealed ledger row so support can finish the save. The row stays
      // 'exchanging' (counted, and shown in pulse-admin health). Nothing is removed at Plaid.
      let parked = false;
      for (let attempt = 0; attempt < 3 && !parked; attempt++) {
        const { data, error } = await admin.from("plaid_slot_ledger")
          .update({ item_id: exchanged.item_id, recovery_ct: sealed.ct, recovery_iv: sealed.iv }).eq("id", ledgerId).select("id");
        if (!error && Array.isArray(data) && data.length === 1) parked = true;
        else await sleep(500 * (attempt + 1));
      }
      if (parked) console.error("[plaid-exchange] store failed after exchange; token parked on ledger", ledgerId, lastError);
      else console.error("[plaid-exchange] store AND park failed after exchange; needs support", ledgerId, exchanged.item_id, lastError);
      return fail("store_failed", "The bank connected but could not be saved. Please contact TreeCheck before trying again.");
    }

    // 8. Accounts now, first transactions sync after replying.
    let accounts = 0;
    try {
      const acc = await plaidPost(env, "/accounts/get", { access_token: exchanged.access_token });
      const ids = await saveAccounts(admin, ownerId, itemRowId, acc.accounts ?? [], new Date().toISOString());
      accounts = ids.size;
    } catch (e) {
      console.error("[plaid-exchange] accounts read failed", String((e as Error)?.message ?? e));
    }
    await afterReply(syncItem(admin, itemRowId, Date.now() + 120_000));
    return json({ ok: true, item_row_id: itemRowId, accounts });
  } catch (e) {
    console.error("[plaid-exchange]", String((e as Error)?.message ?? e));
    return fail("plaid_error", plaidErrorText(e), plaidErrorDetail(e));
  }
});
