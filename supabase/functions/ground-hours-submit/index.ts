// A ground worker enters the hours they worked on a finished job.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function groundPay(hours: number, rate?: number | null, rateType?: string | null, workerRate?: number | null): number {
  if (!(hours > 0)) return 0;
  if (rateType === "day" && rate != null && Number(rate) > 0) return Math.round(Number(rate));
  const r = rate != null && Number(rate) > 0 ? Number(rate) : 25;
  const r2 = Math.max(r, Number(workerRate) > 0 ? Number(workerRate) : 0);
  return Math.round(Math.max(100, Math.max(hours, 4) * r2));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const jobId = typeof body.bid_request_id === "string" ? body.bid_request_id : "";
    const hours = Number(body.hours);
    if (!jobId) return json({ error: "Missing job." }, 400);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return json({ error: "Enter your hours (1 to 24)." }, 400);

    const { data: mine } = await admin.from("crew_members").select("id").eq("user_id", u.user.id);
    const ids = (mine ?? []).map((m: { id: string }) => m.id);
    const { data: row } = await admin.from("job_ground_hours")
      .select("id, crew_member_id").eq("bid_request_id", jobId).in("crew_member_id", ids.length ? ids : ["-"]).maybeSingle();
    if (!row) return json({ error: "We don't have you on this job. Contact the office." }, 403);
    const { data: job } = await admin.from("bid_requests").select("paid_at").eq("id", jobId).maybeSingle();
    if (job?.paid_at) return json({ error: "This job has already been paid. Contact the office to change it." }, 409);

    const { data: d } = await admin.from("job_dispatches").select("pay_per_worker, pay_rate_type")
      .eq("bid_request_id", jobId).eq("role", "ground").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: cm } = await admin.from("crew_members").select("hourly_rate").eq("id", row.crew_member_id).maybeSingle();
    let workerRate = cm?.hourly_rate ?? null;
    if (workerRate == null) {
      const { data: cp } = await admin.from("crew_profiles").select("hourly_rate").eq("user_id", u.user.id).maybeSingle();
      workerRate = cp?.hourly_rate ?? null;
    }
    const pay = groundPay(hours, d?.pay_per_worker, d?.pay_rate_type, workerRate);
    await admin.from("job_ground_hours").update({
      hours, pay, entered_by: u.user.id, entered_at: new Date().toISOString(),
    }).eq("id", row.id);
    return json({ ok: true, hours, pay });
  } catch (e) {
    console.error("ground-hours-submit error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
