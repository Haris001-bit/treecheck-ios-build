// Handles the OAuth redirect from Jobber: exchanges code -> tokens, stores them.
// Jobber redirects the browser here with no Supabase sign-in, so config.toml sets verify_jwt = false;
// the one-time state row is what ties the redirect to the TreeCheck owner who started it. A connect
// started from Jobber's App Marketplace has no state and is handed to TreeCheck's Jobber page instead.
import { createClient } from "npm:@supabase/supabase-js@2";
import { JOBBER_TOKEN_URL, jobberGraphql, PULSE_JOBBER_VERSION } from "../_shared/jobber.ts";

const REDIRECT_URI = "https://wsbtxxobbvcdxiovnssi.functions.supabase.co/jobber-oauth-callback";
// Only when the connection did not say where to go back to (TreeCheck's web address since 2026-10-02).
const RETURN_URL = "https://app.treecheck.ai/dashboard/integrations/jobber";
// A connection attempt must finish within this long of pressing Connect.
const STATE_MAX_AGE_MS = 30 * 60_000;

function back(params: Record<string, string>, returnTo?: string | null) {
  const u = new URL(returnTo || RETURN_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: u.toString() } });
}

Deno.serve(async (req) => {
  let returnTo: string | null = null;
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CLIENT_ID = Deno.env.get("JOBBER_CLIENT_ID")!;
    const CLIENT_SECRET = Deno.env.get("JOBBER_CLIENT_SECRET")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    // The state row is single-use: read it and delete it straight away. return_to only exists
    // once M3 is applied, so read everything rather than naming it.
    const { data: stateRow } = state
      ? await admin.from("jobber_oauth_states").select("*").eq("state", state).maybeSingle()
      : { data: null };
    if (stateRow) {
      returnTo = (stateRow.return_to as string | null) ?? null;
      await admin.from("jobber_oauth_states").delete().eq("state", state);
    }

    if (err) {
      console.error("[jobber-oauth] provider error", err);
      return back({ jobber_error: errDesc || err }, returnTo);
    }
    // Connect pressed in Jobber's App Marketplace: Jobber sends no state, so nothing says which TreeCheck
    // company this is for. Send the owner to TreeCheck's Jobber page, which starts the normal connection
    // for whoever is signed in (after signing in, if needed). This code is never exchanged.
    if (code && !state) return back({ from: "jobber" });
    if (!code || !state) return back({ jobber_error: "Jobber did not return an authorization code." }, returnTo);
    if (!stateRow || Date.now() - new Date(stateRow.created_at).getTime() > STATE_MAX_AGE_MS) {
      return back({ jobber_error: "This connection link expired. Please tap Connect Jobber again." }, returnTo);
    }
    const ownerId = stateRow.contractor_id as string;

    const tokenRes = await fetch(JOBBER_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tok.access_token) {
      console.error("[jobber-oauth] token exchange failed", tokenRes.status, tok?.error);
      return back({
        jobber_error: `Jobber rejected the token exchange: ${tok.error_description ?? tok.error ?? `HTTP ${tokenRes.status}`}`,
      }, returnTo);
    }

    // Which Jobber account was just connected. Webhooks carry this id, and it is how every
    // notification is routed to the right TreeCheck company.
    // (jobberGraphql already retries throttling and server errors.)
    let accountId: string | null = null;
    let accountName: string | null = null;
    try {
      const d = await jobberGraphql(tok.access_token, "query { account { id name } }", {}, PULSE_JOBBER_VERSION);
      accountId = d?.account?.id ?? null;
      accountName = d?.account?.name ?? null;
    } catch (e) {
      console.error("[jobber-oauth] account lookup failed", (e as Error).message);
    }

    const { data: existing } = await admin
      .from("jobber_tokens").select("*").eq("contractor_id", ownerId).maybeSingle();
    // jobber_account_id exists only once M3 is applied; without it, connect exactly as before.
    const m3Applied = existing ? "jobber_account_id" in existing : await hasAccountColumn(admin);

    // A connection without its account id would never receive Jobber's notifications, so it is
    // not saved: the owner simply connects again.
    if (m3Applied && !accountId) {
      return back({
        jobber_error: "TreeCheck could not read your Jobber account details. Please tap Connect Jobber again.",
      }, returnTo);
    }

    if (m3Applied && accountId) {
      const { data: taken } = await admin
        .from("jobber_tokens").select("contractor_id")
        .eq("jobber_account_id", accountId).is("disconnected_at", null)
        .neq("contractor_id", ownerId).limit(1);
      if (taken && taken.length > 0) {
        return back({
          jobber_error: "This Jobber account is already connected to another TreeCheck company. " +
            "Each Jobber account can be connected to one TreeCheck company.",
        }, returnTo);
      }
    }

    const row: Record<string, unknown> = {
      contractor_id: ownerId,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (accountName) row.account_name = accountName;
    if (m3Applied) {
      row.disconnected_at = null;
      row.refresh_lock_until = null;
      row.jobber_account_id = accountId;
    }
    const { error: saveErr } = await admin.from("jobber_tokens").upsert(row, { onConflict: "contractor_id" });
    if (saveErr) {
      if (saveErr.code === "23505") {
        return back({
          jobber_error: "This Jobber account is already connected to another TreeCheck company. " +
            "Each Jobber account can be connected to one TreeCheck company.",
        }, returnTo);
      }
      throw new Error(`Could not save the Jobber connection: ${saveErr.message}`);
    }

    // Connected to a different Jobber account than before: the old account's revenue no longer
    // belongs on this company's Pulse screen, and its sync position is meaningless.
    const previousAccount = existing?.jobber_account_id as string | null | undefined;
    if (m3Applied && accountId && previousAccount && previousAccount !== accountId) {
      await admin.from("jobber_visit_revenue").delete().eq("owner_id", ownerId).neq("jobber_account_id", accountId);
      // M6 (W3-10a): the old account's payments too (before M6 the table is missing and this does nothing).
      await admin.from("jobber_payments").delete().eq("owner_id", ownerId).neq("jobber_account_id", accountId);
      await admin.from("jobber_jobs").delete().eq("owner_id", ownerId).neq("jobber_account_id", accountId);
      await admin.from("jobber_sync_state").delete().eq("owner_id", ownerId);
      await admin.from("pulse_snapshots").update({ dirty: true }).eq("owner_id", ownerId);
    } else {
      // A reconnect may grant different permissions: check them again on the next Pulse sync.
      await admin.from("jobber_sync_state").update({ granted_scopes: null, last_error: null }).eq("owner_id", ownerId);
      // A first connect or a reconnect changes what the Pulse screen should say about Jobber.
      await admin.from("pulse_snapshots").update({ dirty: true }).eq("owner_id", ownerId);
    }

    return back({ connected: "1" }, returnTo);
  } catch (e) {
    console.error("jobber-oauth-callback error", (e as Error).message);
    return back({ jobber_error: String((e as Error).message ?? e) }, returnTo);
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hasAccountColumn(admin: any): Promise<boolean> {
  const { error } = await admin.from("jobber_tokens").select("jobber_account_id").limit(1);
  return !error;
}
