// Financial Pulse: brings a company's Jobber jobs and visits into jobber_jobs / jobber_visit_revenue.
//
//
// POST { mode, owner_id?, job_id?, restart?, full? }
//   backfill     full history, resumable: call again while done=false (the setup wizard does, from
//                the moment Jobber connects; pulse-get's background refresh does too)
//   incremental  jobs updated since the last run
//   job          one job (job_id)
//   scheduled    this month's scheduled visits, for the forecast
//   payments     money in recorded in Jobber (W3-10a): the whole history the first time and weekly
//                (resumable, like backfill), else this month and the two before; full: true forces the whole
//                history. backfill also reads the payments history once the jobs are in.
//   probe_scopes re-check which parts of Jobber the app may read
//   account_ids  (service only) fill the Jobber account id on connections saved without one
//
// Callers: the service role (owner_id required), or a signed-in owner with Pulse switched on
// (always their own company; any owner_id in the body is ignored).
import { createClient } from "npm:@supabase/supabase-js@2";
import { getJobberToken, JobberGraphqlError, JobberReconnectRequired } from "../_shared/jobber.ts";
import {
  fillAccountId,
  grantedScopes,
  markDirty,
  openConnection,
  refreshScheduled,
  runBackfill,
  runIncremental,
  runPaymentsImport,
  PAYMENTS_FULL_EVERY_MS,
  type PaymentsResult,
  failureText,
  getState,
  needsReconnect,
  saveState,
  syncOneJob,
} from "../_shared/pulse/jobberSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Stop starting new Jobber pages after this long; the caller calls again to continue.
const TIME_BUDGET_MS = 45_000;
const MODES = new Set(["backfill", "incremental", "job", "scheduled", "payments", "probe_scopes", "account_ids"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE);

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? "");
  if (!MODES.has(mode)) return json({ ok: false, error: "unknown mode" }, 400);

  // Who is calling, and for which company.
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isService = bearer !== "" && bearer === SERVICE;
  let ownerId: string | null = null;
  if (isService) {
    if (mode !== "account_ids") {
      if (typeof body?.owner_id !== "string" || !UUID.test(body.owner_id)) {
        return json({ ok: false, error: "owner_id required" }, 400);
      }
      ownerId = body.owner_id;
    }
  } else {
    if (!bearer || mode === "account_ids") return json({ ok: false, error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ ok: false, error: "Unauthorized" }, 401);
    const { data: pulseOwner, error } = await userClient.rpc("pulse_owner_id");
    if (error || !pulseOwner) return json({ ok: false, error: "Financial Pulse is not available for this login" }, 403);
    ownerId = pulseOwner as string;
  }

  // A payments problem is logged and reported, not counted as a failed job import; a refused sign-in
  // still goes to the handler below (the owner must reconnect).
  const readPayments = async (conn: { ownerId: string; accountId: string; token: string }, deadline: number, full: boolean) => {
    try {
      return await runPaymentsImport(admin, conn, deadline, full);
    } catch (e) {
      if (e instanceof JobberReconnectRequired) throw e;
      console.error("[jobber-revenue-sync] payments", String((e as Error)?.message ?? e).slice(0, 300));
      return { error: "payments_failed" };
    }
  };

  try {
    if (mode === "account_ids") {
      // Connections saved before account ids were recorded (one-time job before routing goes live).
      const { data: rows, error } = await admin.from("jobber_tokens").select("contractor_id")
        .is("jobber_account_id", null).is("disconnected_at", null);
      if (error) throw new Error(`jobber_tokens read failed: ${error.message}`);
      const results: Array<{ owner_id: string; ok: boolean; error?: string }> = [];
      for (const r of rows ?? []) {
        try {
          const token = await getJobberToken(admin, r.contractor_id);
          if (!token) {
            results.push({ owner_id: r.contractor_id, ok: false, error: "not connected" });
            continue;
          }
          await fillAccountId(admin, r.contractor_id, token);
          results.push({ owner_id: r.contractor_id, ok: true });
        } catch (e) {
          results.push({ owner_id: r.contractor_id, ok: false, error: String((e as Error).message).slice(0, 200) });
        }
      }
      return json({ ok: true, results });
    }

    const conn = await openConnection(admin, ownerId!);
    if (!conn) return json({ ok: false, code: "jobber_not_connected", error: "Jobber is not connected" });
    const deadline = Date.now() + TIME_BUDGET_MS;

    if (mode === "probe_scopes") {
      const scopes = await grantedScopes(admin, conn, true);
      return json({ ok: true, scopes });
    }

    const scopes = await grantedScopes(admin, conn);

    if (mode === "job") {
      if (typeof body?.job_id !== "string" || !body.job_id) return json({ ok: false, error: "job_id required" }, 400);
      const counts = await syncOneJob(admin, conn, scopes, body.job_id);
      await markDirty(admin, conn.ownerId);
      return json({ ok: true, ...counts });
    }

    if (mode === "scheduled") {
      const status = await refreshScheduled(admin, conn, scopes);
      await markDirty(admin, conn.ownerId);
      return json({ ok: true, scheduled_status: status });
    }

    if (mode === "payments") {
      const state = await getState(admin, conn.ownerId);
      const done = state.payments_backfill_completed_at as string | null | undefined;
      const full = body?.full === true || !done || Date.now() - Date.parse(done) > PAYMENTS_FULL_EVERY_MS;
      const r = await readPayments(conn, deadline, full);
      if ("error" in r) return json({ ok: false, code: "payments_failed", error: "Reading payments from Jobber failed. Try again in a moment." });
      // Another payments read is running: it reads once more when it finishes.
      if (r.deferred) return json({ ok: true, full, ...r });
      if (r.saved > 0 || r.removed > 0 || r.done) await markDirty(admin, conn.ownerId);
      return json({ ok: true, full, ...r });
    }

    const result = mode === "backfill"
      ? await runBackfill(admin, conn, scopes, deadline, body?.restart === true)
      : await runIncremental(admin, conn, scopes, deadline);
    // Once the jobs are in, the first import also reads the payments history while time allows (the
    // rest continues on the next screen open).
    let payments: PaymentsResult | { error: string } | null = null;
    if (mode === "backfill" && result.done && Date.now() < deadline - 10_000) {
      const state = await getState(admin, conn.ownerId);
      if (!state.payments_backfill_completed_at) payments = await readPayments(conn, deadline, true);
    }
    const paymentsChanged = !!payments && !("error" in payments) && (payments.saved > 0 || payments.removed > 0 || payments.done);
    if (result.jobs > 0 || result.done || paymentsChanged) await markDirty(admin, conn.ownerId);
    return json({ ok: true, scopes, ...result, ...(payments ? { payments } : {}) });
  } catch (e) {
    const message = String((e as Error).message ?? e);
    console.error("[jobber-revenue-sync]", mode, message.slice(0, 300));
    if (ownerId) {
      // Counted (tries in a row), and a refused sign-in marked, so pulse-get can tell the owner what to do.
      const previous = await getState(admin, ownerId).catch(() => null);
      const lastError = failureText(previous, e instanceof JobberReconnectRequired, message);
      await saveState(admin, ownerId, { last_error: lastError }).catch(() => {});
      // The numbers show Jobber as needing a reconnect: work them out again when that changes.
      if (needsReconnect({ last_error: lastError }) !== needsReconnect(previous)) await markDirty(admin, ownerId).catch(() => {});
    }
    if (e instanceof JobberReconnectRequired) {
      return json({ ok: false, code: "jobber_reconnect", error: message });
    }
    if (e instanceof JobberGraphqlError && e.isPermissionError) {
      // Permissions changed since they were last checked: re-check on the next run.
      if (ownerId) await saveState(admin, ownerId, { granted_scopes: null }).catch(() => {});
      return json({ ok: false, code: "jobber_permission", error: "Jobber refused part of the request. Try again." });
    }
    return json({ ok: false, code: "sync_failed", error: "Jobber sync failed. Try again in a moment." }, 500);
  }
});
