// Financial Pulse: the owner's setup choices (A5, A7, A15).
// Caller: a company owner with Pulse switched on; the owner id comes from pulse_owner_id().
//
// POST { action: "set_accounts", accounts: [{ id, is_business, include_from, use_for_payroll, count_from_chosen? }] }
//   Business accounts, each card's count-from date, and which bank accounts pay payroll. Accounts
//   must belong to the owner. "Pays payroll" only on business bank accounts. An account switched
//   to business after setup was completed has its bank's history pulled again (its rows were not
//   kept while it was personal). Then everything is sorted again.
// POST { action: "save_settings", settings: {...} }
//   timezone, profit_target_monthly, cash_reserve, pay_frequency, pay_anchor_date,
//   payroll_amount_override (0 or blank means not set), setup_step.
// POST { action: "complete" }
//   Marks setup complete and deletes the stored rows of accounts that are not business (D14).

import { classifyOwner, markDirty, purgePersonalRows } from "../_shared/pulse/plaidSync.ts";
import { adminClient, bodyOf, callerOf, corsHeaders, fail, json } from "../_shared/pulseHttp.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FREQUENCIES = new Set(["weekly", "biweekly", "semimonthly", "monthly"]);

function validDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function validTimezone(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

function money(v: unknown, allowNull: boolean): number | null | undefined {
  if (v === null || v === "" || v === undefined) return allowNull ? null : undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e10) return undefined;
  return Math.round(n * 100) / 100;
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
    const body = await bodyOf(req);
    // Every company in setup has the default categories, however Pulse was switched on (safe to repeat).
    const seed = await admin.rpc("pulse_seed_categories", { p_owner: ownerId });
    if (seed.error) throw new Error(`category seed failed: ${seed.error.message}`);

    if (body.action === "set_accounts") {
      if (!Array.isArray(body.accounts) || body.accounts.length === 0 || body.accounts.length > 50) {
        return fail("bad_request", "No accounts to save.");
      }
      const { data: mine, error } = await admin.from("plaid_accounts")
        .select("id, item_row_id, type, is_business").eq("owner_id", ownerId);
      if (error) throw new Error(`plaid_accounts read failed: ${error.message}`);
      const byId = new Map((mine ?? []).map((a: { id: string }) => [a.id, a]));
      const { data: settings } = await admin.from("pulse_settings").select("setup_completed_at").eq("owner_id", ownerId).maybeSingle();

      const now = new Date().toISOString();
      const itemsToRepull = new Set<string>();
      for (const raw of body.accounts as unknown[]) {
        const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const current = typeof a.id === "string" ? byId.get(a.id) as { id: string; item_row_id: string; type: string | null; is_business: boolean } | undefined : undefined;
        if (!current) return fail("bad_request", "One of those accounts was not found.");
        if (typeof a.is_business !== "boolean") return fail("bad_request", "Choose business or not for every account.");
        if (a.include_from !== null && a.include_from !== undefined && !validDate(a.include_from)) {
          return fail("bad_request", "A count-from date is not a valid date.");
        }
        const isCredit = (current.type ?? "").toLowerCase() === "credit";
        const patch: Record<string, unknown> = {
          is_business: a.is_business,
          include_from: a.include_from ?? null,
          use_for_payroll: a.is_business && !isCredit && a.use_for_payroll === true,
        };
        // Only an explicit choice for a business card counts as confirmed (A7).
        if (isCredit && a.is_business && a.count_from_chosen === true) patch.count_from_confirmed_at = now;
        const { error: uErr } = await admin.from("plaid_accounts").update(patch).eq("id", current.id).eq("owner_id", ownerId);
        if (uErr) throw new Error(`plaid_accounts update failed: ${uErr.message}`);
        if (settings?.setup_completed_at && a.is_business && !current.is_business) itemsToRepull.add(current.item_row_id);
      }
      for (const itemRowId of itemsToRepull) {
        // The rows of an account that was personal were not kept: pull the bank's history again.
        const { error: cErr } = await admin.from("plaid_item_secrets").update({ sync_cursor: null }).eq("item_row_id", itemRowId);
        if (cErr) throw new Error(`cursor reset failed: ${cErr.message}`);
      }
      // After setup, an account switched to personal loses its stored rows (data minimisation).
      if (settings?.setup_completed_at) await purgePersonalRows(admin, ownerId);
      const changed = await classifyOwner(admin, ownerId);
      // Payroll accounts and count-from dates change the numbers even when no row sorts differently.
      await markDirty(admin, ownerId);
      return json({ ok: true, sorted: changed, history_repull: itemsToRepull.size > 0 });
    }

    if (body.action === "save_settings") {
      const s = (body.settings && typeof body.settings === "object" ? body.settings : {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = { owner_id: ownerId };
      if ("timezone" in s) {
        if (!validTimezone(s.timezone)) return fail("bad_request", "That time zone is not recognised.");
        patch.timezone = s.timezone;
      }
      if ("profit_target_monthly" in s) {
        const v = money(s.profit_target_monthly, true);
        if (v === undefined) return fail("bad_request", "The monthly profit target must be a positive amount.");
        patch.profit_target_monthly = v;
      }
      if ("cash_reserve" in s) {
        const v = money(s.cash_reserve, false);
        if (v === undefined || v === null) return fail("bad_request", "The cash reserve must be 0 or more.");
        patch.cash_reserve = v;
      }
      if ("pay_frequency" in s) {
        if (s.pay_frequency !== null && !FREQUENCIES.has(String(s.pay_frequency))) return fail("bad_request", "Choose how often you run payroll.");
        patch.pay_frequency = s.pay_frequency;
      }
      if ("pay_anchor_date" in s) {
        if (s.pay_anchor_date !== null && !validDate(s.pay_anchor_date)) return fail("bad_request", "The payday is not a valid date.");
        patch.pay_anchor_date = s.pay_anchor_date;
      }
      if ("payroll_amount_override" in s) {
        const v = money(s.payroll_amount_override, true);
        if (v === undefined) return fail("bad_request", "The typical payroll must be a positive amount.");
        patch.payroll_amount_override = v === 0 ? null : v;
      }
      if ("setup_step" in s) {
        if (s.setup_step !== null && (typeof s.setup_step !== "string" || s.setup_step.length > 40)) return fail("bad_request", "Bad setup step.");
        patch.setup_step = s.setup_step;
      }
      const { error } = await admin.from("pulse_settings").upsert(patch, { onConflict: "owner_id" });
      if (error) throw new Error(`pulse_settings save failed: ${error.message}`);
      await admin.from("pulse_snapshots").upsert({ owner_id: ownerId, dirty: true }, { onConflict: "owner_id" });
      return json({ ok: true });
    }

    if (body.action === "complete") {
      // Mark setup complete first, then remove the stored rows of every non-business account.
      const { error } = await admin.from("pulse_settings")
        .upsert({ owner_id: ownerId, setup_completed_at: new Date().toISOString(), setup_step: "done" }, { onConflict: "owner_id" });
      if (error) throw new Error(`pulse_settings save failed: ${error.message}`);
      const removedFrom = await purgePersonalRows(admin, ownerId);
      await classifyOwner(admin, ownerId);
      await markDirty(admin, ownerId);
      return json({ ok: true, personal_rows_removed_from: removedFrom });
    }

    return fail("bad_request", "Unknown action");
  } catch (e) {
    console.error("[pulse-setup]", String((e as Error)?.message ?? e));
    return fail("server_error", "Something went wrong. Please try again.");
  }
});
