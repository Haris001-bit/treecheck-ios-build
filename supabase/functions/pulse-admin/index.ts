// Financial Pulse: Mark's switch and health page backend (A5).
// Caller: an admin (profiles.role = 'admin') or the service role. Returns NO money fields and no
// transaction data, ever: counts, statuses and names only.
//
// POST { action: "list" }       -> companies with Pulse access, their bank connection counts and states
// POST { action: "set_access", owner_id, enabled, plaid_env?, max_items?, note? }
//                                -> switch a company on or off (only company owners; only the fields
//                                   sent change; never mixes sandbox and production connections;
//                                   seeds categories and settings the first time)
// POST { action: "find", email } -> the company whose owner logs in with that email (team members and
//                                   non-company logins are refused), with its current Pulse access
// POST { action: "health" }     -> which secrets exist (names only), whether each token key works,
//                                   production connections used and the cap

import {
  isPlaidEnv, loadItem, PRODUCTION_SLOT_CAP, secretPresence, tokenKey, type PlaidEnv,
} from "../_shared/plaid.ts";
import { keyCanaryOk } from "../_shared/pulse/plaidCrypto.ts";
import { adminClient, bodyOf, callerOf, corsHeaders, fail, json } from "../_shared/pulseHttp.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const admin = adminClient();
  try {
    const caller = await callerOf(req, admin);
    if (!caller || (caller.kind === "user" && !caller.isAdmin)) return json({ ok: false, error: "Forbidden" }, 403);
    const actor = caller.kind === "user" ? caller.userId : null;
    const body = await bodyOf(req);

    if (body.action === "list") {
      const { data: access, error } = await admin.from("pulse_access")
        .select("owner_id, enabled, plaid_env, max_items, enabled_at, disabled_at, note").order("enabled_at", { ascending: false });
      if (error) throw new Error(`pulse_access read failed: ${error.message}`);
      const owners = (access ?? []).map((a: { owner_id: string }) => a.owner_id);
      const { data: profiles } = owners.length
        ? await admin.from("profiles").select("id, company_name, full_name, email").in("id", owners)
        : { data: [] };
      const { data: items } = owners.length
        ? await admin.from("plaid_items").select("owner_id, plaid_env, institution_name, status, last_successful_update").in("owner_id", owners)
        : { data: [] };
      const byId = new Map((profiles ?? []).map((p: { id: string }) => [p.id, p]));
      const companies = (access ?? []).map((a: { owner_id: string }) => ({
        ...a,
        company: byId.get(a.owner_id) ?? null,
        banks: (items ?? []).filter((i: { owner_id: string }) => i.owner_id === a.owner_id)
          .map(({ owner_id: _o, ...rest }: { owner_id: string }) => rest),
      }));
      return json({ ok: true, companies });
    }

    if (body.action === "set_access") {
      // Only the fields sent are changed (switching off never resets a company's environment or limit).
      const ownerId = typeof body.owner_id === "string" && UUID.test(body.owner_id) ? body.owner_id : null;
      if (!ownerId || typeof body.enabled !== "boolean") return fail("bad_request", "owner_id and enabled are required");
      if ("plaid_env" in body && !isPlaidEnv(body.plaid_env)) return fail("bad_request", "plaid_env must be sandbox or production");
      if ("max_items" in body && !(Number.isInteger(body.max_items) && (body.max_items as number) >= 0 && (body.max_items as number) <= 10)) {
        return fail("bad_request", "max_items must be 0 to 10");
      }

      const { data: prof } = await admin.from("profiles").select("id, parent_contractor_id, account_type").eq("id", ownerId).maybeSingle();
      if (!prof) return fail("not_found", "Company not found.");
      if (prof.parent_contractor_id) return fail("not_owner", "That login is a team member. Switch Pulse on for the company owner.");
      if ((prof.account_type ?? "company") !== "company") return fail("not_owner", "That login is not a company account.");

      const { data: existing, error: xErr } = await admin.from("pulse_access").select("owner_id, enabled, plaid_env").eq("owner_id", ownerId).maybeSingle();
      if (xErr) throw new Error(`pulse_access read failed: ${xErr.message}`);
      const env: PlaidEnv = isPlaidEnv(body.plaid_env) ? body.plaid_env : (existing?.plaid_env ?? "sandbox");

      // Test (sandbox) and real (production) bank data must never mix in one company's numbers.
      if (existing && existing.plaid_env !== env) {
        const { count, error: cErr } = await admin.from("plaid_items").select("id", { count: "exact", head: true })
          .eq("owner_id", ownerId).eq("plaid_env", existing.plaid_env).neq("status", "removed").is("removed_at", null);
        if (cErr) throw new Error(`plaid_items count failed: ${cErr.message}`);
        // Also connections being made right now, or parked for support after a failed save.
        const { count: inFlight, error: fErr } = await admin.from("plaid_slot_ledger").select("id", { count: "exact", head: true })
          .eq("owner_id", ownerId).eq("plaid_env", existing.plaid_env).or("status.eq.exchanging,recovery_ct.not.is.null");
        if (fErr) throw new Error(`plaid_slot_ledger count failed: ${fErr.message}`);
        const { count: reserved, error: rErr } = await admin.from("plaid_slot_ledger").select("id", { count: "exact", head: true })
          .eq("owner_id", ownerId).eq("plaid_env", existing.plaid_env).eq("status", "reserved").gt("expires_at", new Date().toISOString());
        if (rErr) throw new Error(`plaid_slot_ledger count failed: ${rErr.message}`);
        if ((count ?? 0) + (inFlight ?? 0) + (reserved ?? 0) > 0) {
          return fail("env_in_use", `This company still has ${existing.plaid_env} bank connections. Remove them before switching to ${env}.`);
        }
      }

      const now = new Date().toISOString();
      const row: Record<string, unknown> = { owner_id: ownerId, enabled: body.enabled, plaid_env: env };
      if ("max_items" in body) row.max_items = body.max_items;
      if ("note" in body) row.note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
      if (body.enabled && !existing?.enabled) { row.enabled_at = now; row.enabled_by = actor; row.disabled_at = null; }
      if (!body.enabled && existing?.enabled) row.disabled_at = now;
      const { error } = existing
        ? await admin.from("pulse_access").update(row).eq("owner_id", ownerId)
        : await admin.from("pulse_access").insert(row);
      if (error) throw new Error(`pulse_access save failed: ${error.message}`);
      if (body.enabled) {
        const seed = await admin.rpc("pulse_seed_categories", { p_owner: ownerId });
        if (seed.error) throw new Error(`category seed failed: ${seed.error.message}`);
        const { error: sErr } = await admin.from("pulse_settings").upsert({ owner_id: ownerId }, { onConflict: "owner_id", ignoreDuplicates: true });
        if (sErr) throw new Error(`settings seed failed: ${sErr.message}`);
      }
      return json({ ok: true });
    }

    if (body.action === "find") {
      // Look a company up by its owner's login email, so Mark can switch Pulse on without ids.
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email || email.length > 254 || /[*%\\]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return fail("bad_request", "Type the owner's login email.");
      }
      // Case-insensitive lookup ("_" escaped so it is not a wildcard), then an exact compare: never a
      // pattern match, never a guess between two accounts.
      const { data: found, error: fErr } = await admin.from("profiles")
        .select("id, company_name, full_name, email, parent_contractor_id, account_type")
        .ilike("email", email.replace(/_/g, "\\_")).limit(5);
      if (fErr) throw new Error(`profiles read failed: ${fErr.message}`);
      const exact = (found ?? []).filter((p: { email: string | null }) => (p.email ?? "").trim().toLowerCase() === email);
      if (exact.length === 0) return fail("not_found", "No TreeCheck account uses that email.");
      if (exact.length > 1) return fail("ambiguous", "More than one TreeCheck account uses that email. Ask Haris to check it.");
      const prof = exact[0];
      if (prof.parent_contractor_id) return fail("not_owner", "That email belongs to a team member. Use the company owner's email.");
      if ((prof.account_type ?? "company") !== "company") return fail("not_owner", "That login isn't a company account.");
      const { data: acc, error: aErr } = await admin.from("pulse_access")
        .select("enabled, plaid_env, max_items").eq("owner_id", prof.id).maybeSingle();
      if (aErr) throw new Error(`pulse_access read failed: ${aErr.message}`);
      return json({
        ok: true,
        company: { owner_id: prof.id, company_name: prof.company_name, full_name: prof.full_name, email: prof.email, access: acc ?? null },
      });
    }

    if (body.action === "health") {
      const keys: Record<string, { configured: boolean; works: boolean; stored_token_readable: boolean | null }> = {};
      for (const env of ["sandbox", "production"] as PlaidEnv[]) {
        let works = false;
        let configured = false;
        try {
          const key = await tokenKey(env);
          configured = true;
          works = await keyCanaryOk(key);
        } catch { /* not configured or invalid */ }
        let readable: boolean | null = null;
        const { data: one } = await admin.from("plaid_items").select("id").eq("plaid_env", env).neq("status", "removed").limit(1);
        if (one && one.length > 0) {
          try { await loadItem(admin, one[0].id); readable = true; } catch { readable = false; }
        }
        keys[env] = { configured, works, stored_token_readable: readable };
      }
      const { data: used } = await admin.rpc("plaid_slots_used", { p_env: "production" });
      // Connections needing support: exchange outcome unclear, or a token parked after a failed save.
      const { count: stuck } = await admin.from("plaid_slot_ledger").select("id", { count: "exact", head: true })
        .or("status.eq.exchanging,recovery_ct.not.is.null");
      return json({
        ok: true,
        secrets: secretPresence(),
        token_keys: keys,
        production_connections: { used: Number(used ?? 0), cap: PRODUCTION_SLOT_CAP, trial_limit: PRODUCTION_SLOT_CAP === null ? null : 10 },
        connections_needing_support: stuck ?? 0,
        redirect_uri_set: !!Deno.env.get("PLAID_REDIRECT_URI"),
      });
    }

    return fail("bad_request", "Unknown action");
  } catch (e) {
    console.error("[pulse-admin]", String((e as Error)?.message ?? e));
    return fail("server_error", "Something went wrong. Please try again.");
  }
});
