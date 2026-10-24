// Financial Pulse: the owner's "Personal, not business" button and its undo (A10 "Personal or
// owner-draw keys", plan task W2-04).
// Caller: a company owner with Pulse switched on; the owner id comes from pulse_owner_id(). Every
// read and write is scoped to that owner, and replies carry only ids and counts.
//
// POST { action: "mark_personal", transaction_id, scope: "one" | "merchant" }
//   Adds an active exclude_personal rule (source owner_tap, created_by the caller, every account).
//   "one": this transaction only (by transaction_id, which also follows a pending row to its posted
//   row). "merchant": every charge from the same merchant or payee (personalRule.ts); when that key
//   would be generic or empty, the rule is for this transaction only. An identical active rule is
//   reused. Then the company is sorted again.
//   Reply { ok: true, rule_id, scope_applied: "one" | "merchant" }.
// POST { action: "undo", rule_id }
//   Switches off one of the owner's own "personal" taps (exclude_personal, owner_tap), then sorts
//   again. Safe to repeat. Reply { ok: true }.
// POST { action: "count_as_business", transaction_id }
//   Switches off every active "personal" tap that matches this transaction: its own rule and the
//   merchant or payee rule (so every charge from that merchant counts again). Then sorts again.
//   Reply { ok: true, deactivated }. Refused with not_personal when no owner tap matches, and with
//   set_by_support when only a TreeCheck support rule does.
// Expected failures: HTTP 200 { ok: false, code, error }, codes not_enabled, bad_request,
// not_found, not_personal, set_by_support, server_error.

import { personalRuleFor, personalRulesMatching } from "../_shared/pulse/personalRule.ts";
import { classifyOwnerResult, markDirty } from "../_shared/pulse/plaidSync.ts";
import type { SorterRule, SorterTxn } from "../_shared/pulse/types.ts";
import { adminClient, bodyOf, callerOf, corsHeaders, fail, json, type Admin } from "../_shared/pulseHttp.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Plaid transaction ids are letters and digits (about 37 characters).
const TXN_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SCOPES = new Set(["one", "merchant"]);
const MAX_BODY_BYTES = 2048;
const MAX_RULES = 5000;

const TXN_COLS = "transaction_id, account_row_id, pending, pending_transaction_id, txn_date, authorized_date, amount, name, " +
  "merchant_name, merchant_entity_id, counterparty_name, counterparty_type, payment_channel, pfc_primary, pfc_detailed, " +
  "pfc_confidence, rule_id";
const RULE_COLS = "id, rule_type, match_kind, match_value, account_row_id, category_key, source";

type StoredTxn = SorterTxn & { rule_id: string | null };
type StoredRule = SorterRule & { source: string };

const NOT_FOUND_TXN = "We couldn't find that payment. Refresh the page and try again.";

/** The owner's transaction, or null when there is no such transaction for this owner. */
async function loadTxn(admin: Admin, ownerId: string, transactionId: string): Promise<StoredTxn | null> {
  const { data, error } = await admin.from("plaid_transactions").select(TXN_COLS)
    .eq("owner_id", ownerId).eq("transaction_id", transactionId).maybeSingle();
  if (error) throw new Error(`plaid_transactions read failed: ${error.message}`);
  return data ? { ...(data as StoredTxn), amount: Number(data.amount) } : null;
}

async function findActiveRule(admin: Admin, ownerId: string, kind: SorterRule["match_kind"], value: string): Promise<string | null> {
  const { data, error } = await admin.from("pulse_rules").select("id")
    .eq("owner_id", ownerId).eq("rule_type", "exclude_personal").eq("match_kind", kind).eq("match_value", value)
    .is("account_row_id", null).eq("source", "owner_tap").eq("active", true).maybeSingle();
  if (error) throw new Error(`pulse_rules read failed: ${error.message}`);
  return typeof data?.id === "string" ? data.id : null;
}

/** The active personal rule for this key (every account), created when there is none yet. */
async function ensureRule(
  admin: Admin,
  ownerId: string,
  userId: string,
  kind: SorterRule["match_kind"],
  value: string,
): Promise<string> {
  const existing = await findActiveRule(admin, ownerId, kind, value);
  if (existing) return existing;
  const { data, error } = await admin.from("pulse_rules").insert({
    owner_id: ownerId,
    rule_type: "exclude_personal",
    match_kind: kind,
    match_value: value,
    account_row_id: null,
    category_key: null,
    source: "owner_tap",
    created_by: userId,
    active: true,
  }).select("id").single();
  if (!error && typeof data?.id === "string") return data.id;
  // Two taps at once: the unique index on active rules let only one in, so use that one.
  if (error?.code === "23505") {
    const again = await findActiveRule(admin, ownerId, kind, value);
    if (again) return again;
  }
  throw new Error(`pulse_rules insert failed: ${error?.message ?? "no id returned"}`);
}

/** The owner's active personal rules (owner taps and support rules). */
async function activePersonalRules(admin: Admin, ownerId: string): Promise<StoredRule[]> {
  const { data, error } = await admin.from("pulse_rules").select(RULE_COLS)
    .eq("owner_id", ownerId).eq("rule_type", "exclude_personal").eq("active", true).limit(MAX_RULES);
  if (error) throw new Error(`pulse_rules read failed: ${error.message}`);
  return (data ?? []) as StoredRule[];
}

/**
 * Sorts the company again and marks the numbers stale. When another sort holds the lock (a bank sync),
 * waits for it briefly; if it is still busy, that sort runs once more with the change, and the reply
 * says pending so the page checks again a little later. Returns pending.
 */
async function resort(admin: Admin, ownerId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await classifyOwnerResult(admin, ownerId);
    // A sort that ran has already marked the numbers changed when any row moved.
    if (!r.deferred) return false;
    await new Promise((res) => setTimeout(res, 1500));
  }
  await markDirty(admin, ownerId);
  return true;
}

function transactionIdOf(body: Record<string, unknown>): string | null {
  return typeof body.transaction_id === "string" && TXN_ID.test(body.transaction_id) ? body.transaction_id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const admin = adminClient();
  try {
    const caller = await callerOf(req, admin);
    if (!caller || caller.kind !== "user") return json({ ok: false, error: "Unauthorized" }, 401);
    if (!caller.ownerId) return fail("not_enabled", "Financial Pulse is not switched on for your company.");
    const ownerId = caller.ownerId;
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return fail("bad_request", "Request too large.");
    const body = await bodyOf(req);

    if (body.action === "mark_personal") {
      const transactionId = transactionIdOf(body);
      if (!transactionId) return fail("bad_request", "That payment is not valid.");
      if (typeof body.scope !== "string" || !SCOPES.has(body.scope)) return fail("bad_request", "Choose this payment only or every charge from this merchant.");
      const txn = await loadTxn(admin, ownerId, transactionId);
      if (!txn) return fail("not_found", NOT_FOUND_TXN);
      const merchant = body.scope === "merchant" ? personalRuleFor(txn).merchant : null;
      const ruleId = merchant
        ? await ensureRule(admin, ownerId, caller.userId, merchant.match_kind, merchant.match_value)
        : await ensureRule(admin, ownerId, caller.userId, "transaction_id", txn.transaction_id);
      const pending = await resort(admin, ownerId);
      return json({ ok: true, rule_id: ruleId, scope_applied: merchant ? "merchant" : "one", pending });
    }

    if (body.action === "undo") {
      const ruleId = typeof body.rule_id === "string" && UUID.test(body.rule_id) ? body.rule_id : null;
      if (!ruleId) return fail("bad_request", "That change is not valid.");
      const { data: rule, error } = await admin.from("pulse_rules").select("id, active")
        .eq("id", ruleId).eq("owner_id", ownerId).eq("rule_type", "exclude_personal").eq("source", "owner_tap").maybeSingle();
      if (error) throw new Error(`pulse_rules read failed: ${error.message}`);
      if (!rule) return fail("not_found", "We couldn't find that change to undo. Refresh the page and check the payment.");
      if (rule.active) {
        const { error: uErr } = await admin.from("pulse_rules").update({ active: false })
          .eq("id", ruleId).eq("owner_id", ownerId).eq("source", "owner_tap");
        if (uErr) throw new Error(`pulse_rules update failed: ${uErr.message}`);
      }
      const pending = await resort(admin, ownerId);
      return json({ ok: true, pending });
    }

    if (body.action === "count_as_business") {
      const transactionId = transactionIdOf(body);
      if (!transactionId) return fail("bad_request", "That payment is not valid.");
      const txn = await loadTxn(admin, ownerId, transactionId);
      if (!txn) return fail("not_found", NOT_FOUND_TXN);
      const rules = await activePersonalRules(admin, ownerId);
      const taps = rules.filter((r) => r.source === "owner_tap");
      const matched = new Set(personalRulesMatching(txn, taps));
      // The rule the last sort recorded on the row, if it is still an active owner tap.
      if (txn.rule_id && taps.some((r) => r.id === txn.rule_id)) matched.add(txn.rule_id);
      if (matched.size === 0) {
        const support = rules.filter((r) => r.source !== "owner_tap");
        if (personalRulesMatching(txn, support).length > 0) {
          return fail("set_by_support", "TreeCheck support marked this payment as personal. Please contact TreeCheck if it should count as business.");
        }
        return fail("not_personal", "This payment isn't marked as personal, so there's nothing to change.");
      }
      const ids = [...matched];
      const { error } = await admin.from("pulse_rules").update({ active: false })
        .eq("owner_id", ownerId).eq("rule_type", "exclude_personal").eq("source", "owner_tap").in("id", ids);
      if (error) throw new Error(`pulse_rules update failed: ${error.message}`);
      const pending = await resort(admin, ownerId);
      // A support rule can still keep it personal: say so instead of "counted as business".
      const support = rules.filter((r) => r.source !== "owner_tap");
      if (personalRulesMatching(txn, support).length > 0) {
        return fail("set_by_support", "TreeCheck support marked this payment as personal. Please contact TreeCheck if it should count as business.");
      }
      return json({ ok: true, deactivated: ids.length, pending });
    }

    return fail("bad_request", "Unknown action");
  } catch (e) {
    console.error("[pulse-transaction-action]", String((e as Error)?.message ?? e));
    return fail("server_error", "Something went wrong. Please try again.");
  }
});
