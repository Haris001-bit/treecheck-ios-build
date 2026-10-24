const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
import { reportIncident } from "../_shared/reportIncident.ts";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.sandbox === true) return json({ ok: true, suppressed: true });
    const journey = typeof body.journey === "string" ? body.journey : "app";
    const action = typeof body.action === "string" ? body.action : "unknown action";
    const summary = typeof body.summary === "string" ? body.summary : "Unexpected app error";
    if (journey.length > 60 || action.length > 100 || summary.length > 500) return json({ error: "Invalid report" }, 400);
    return json({ ok: true, ...(await reportIncident({ journey, action, summary, email: typeof body.email === "string" ? body.email : null, fingerprint: typeof body.fingerprint === "string" ? body.fingerprint : undefined })) });
  } catch (error) {
    console.error("report-serious-error failed", error);
    return json({ error: "Could not record incident" }, 500);
  }
});
