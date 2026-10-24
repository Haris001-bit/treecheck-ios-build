// A ground worker claims a spot on a job. First come, first served.
import { createClient } from "npm:@supabase/supabase-js@2";
import { officePhones, sendSms } from "../_shared/crewRecipients.ts";
import { logJobActivity } from "../_shared/jobActivity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: u } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const dispatchId = typeof body.dispatch_id === "string" ? body.dispatch_id : null;
    if (!dispatchId) return json({ error: "dispatch_id required" }, 400);
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null;

    const { data: dispatch } = await admin
      .from("job_dispatches").select("*").eq("id", dispatchId).maybeSingle();
    if (!dispatch) return json({ error: "That job no longer exists." }, 404);
    if (dispatch.status !== "open") return json({ error: "All spots are filled." }, 409);

    const { data: memberships } = await admin
      .from("crew_members").select("id, status, full_name, phone").eq("user_id", u.user.id);
    const active = (memberships ?? []).filter((m: { status: string }) => m.status === "active");
    if (!active.length) return json({ error: "Your crew profile is still waiting for approval." }, 403);

    const { data: invited } = await admin
      .from("job_dispatch_recipients").select("crew_member_id").eq("dispatch_id", dispatchId);
    const invitedIds = new Set((invited ?? []).map((r: { crew_member_id: string }) => r.crew_member_id));
    const member = active.find((m: { id: string }) => invitedIds.has(m.id));
    if (!member) return json({ error: "This job wasn't sent to you." }, 403);

    const { error: insErr } = await admin.from("job_dispatch_responses").insert({
      dispatch_id: dispatchId,
      crew_member_id: member.id,
      response: "claimed",
      status: "confirmed",
      notes,
    });
    if (insErr && !String(insErr.message).includes("duplicate")) {
      return json({ error: insErr.message }, 400);
    }

    const { count } = await admin
      .from("job_dispatch_responses")
      .select("id", { count: "exact", head: true })
      .eq("dispatch_id", dispatchId).eq("response", "claimed");
    const claimed = count ?? 0;
    const full = claimed >= Number(dispatch.slots);
    if (full) {
      await admin.from("job_dispatches")
        .update({ status: "filled", updated_at: new Date().toISOString() }).eq("id", dispatchId);
    }

    const { data: request } = await admin
      .from("bid_requests").select("title, city").eq("id", dispatch.bid_request_id).maybeSingle();

    for (const phone of await officePhones(admin, dispatch.owner_contractor_id)) {
      await sendSms(
        phone,
        `${member.full_name ?? "A ground worker"} claimed a spot on "${request?.title ?? "a job"}"${request?.city ? ` (${request.city})` : ""}` +
          `${dispatch.scheduled_date ? ` for ${dispatch.scheduled_date}` : ""}. ${claimed} of ${dispatch.slots} filled${full ? " — all spots filled." : "."}` +
          `${member.phone ? ` Reach him at ${member.phone}.` : ""}`,
      );
    }
    await logJobActivity(admin, dispatch.bid_request_id, "ground_claimed",
      `${(member.full_name ?? "Ground crew").split(" ")[0]} claimed a ground spot (${claimed}/${dispatch.slots})`, u.user.id);

    return json({
      success: true,
      claimed,
      slots: dispatch.slots,
      full,
      message: "You're on the job. The office will be in touch with the details.",
    });
  } catch (e) {
    console.error("job-dispatch-respond error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
