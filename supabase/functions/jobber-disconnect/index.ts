// Disconnects the caller's company from Jobber, from the Disconnect Jobber button on the Jobber page.
// Jobber's App Review requires an in-app disconnect that uses its appDisconnect mutation, so Jobber is
// told first (TreeCheck leaves the company's connected apps there), then the stored sign-in is cleared
// exactly as jobber-webhook does for APP_DISCONNECT. Owner only, like jobber-connect. Nothing already
// imported is deleted, and Connect Jobber works again afterwards.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getJobberToken, jobberGraphql, JobberReconnectRequired, PULSE_JOBBER_VERSION } from "../_shared/jobber.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const APP_DISCONNECT = "mutation TC_AppDisconnect { appDisconnect { app { id } userErrors { message } } }";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof, error: pErr } = await admin
      .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
    if (pErr) throw new Error(`profile read failed: ${pErr.message}`);
    if (prof?.parent_contractor_id) {
      // 200 with a code so the page can show the message (the client hides non-2xx bodies).
      return json({ error: "Only the account owner can disconnect Jobber.", code: "owner_only" });
    }
    const ownerId = u.user.id;

    // Tell Jobber. A connection Jobber already dropped, or a sign-in it no longer accepts, has nothing
    // to tell, and a failure here never stops the disconnect on TreeCheck's side.
    let jobberNotified = false;
    try {
      const token = await getJobberToken(admin, ownerId);
      if (token) {
        const d = await jobberGraphql(token, APP_DISCONNECT, {}, PULSE_JOBBER_VERSION);
        const userErrors = d?.appDisconnect?.userErrors ?? [];
        if (userErrors.length) {
          console.error("[jobber-disconnect] appDisconnect userErrors", JSON.stringify(userErrors).slice(0, 300));
        } else {
          jobberNotified = true;
        }
      }
    } catch (e) {
      if (!(e instanceof JobberReconnectRequired)) {
        console.error("[jobber-disconnect] appDisconnect failed", String((e as Error)?.message ?? e).slice(0, 300));
      }
    }

    // Clear the stored sign-in, as jobber-webhook does for APP_DISCONNECT.
    const now = new Date().toISOString();
    const { data: rows, error } = await admin.from("jobber_tokens").update({
      access_token: "",
      refresh_token: "",
      disconnected_at: now,
      updated_at: now,
    }).eq("contractor_id", ownerId).select("contractor_id");
    if (error) throw new Error(`jobber_tokens update failed: ${error.message}`);
    const disconnected = (rows?.length ?? 0) > 0;
    // The Pulse screen must say Jobber is disconnected.
    if (disconnected) await admin.from("pulse_snapshots").update({ dirty: true }).eq("owner_id", ownerId);

    return json({ ok: true, disconnected, jobber_notified: jobberNotified });
  } catch (e) {
    console.error("jobber-disconnect error", String((e as Error)?.message ?? e).slice(0, 300));
    return json({ error: "Could not disconnect Jobber. Please try again in a minute." }, 500);
  }
});
