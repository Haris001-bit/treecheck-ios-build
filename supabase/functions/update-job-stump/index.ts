import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
import { eligibleRecipients, notifyBidRequest } from "../_shared/crewRecipients.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data: authData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const user = authData.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const requestId = typeof body.bid_request_id === "string" ? body.bid_request_id : "";
    const enabled = body.needs_stump_grinding === true;
    const diameter = body.stump_diameter_inches === null || body.stump_diameter_inches === undefined || body.stump_diameter_inches === ""
      ? null
      : Number(body.stump_diameter_inches);
    if (!requestId) return json({ error: "Job is required" }, 400);
    if (diameter !== null && (!Number.isFinite(diameter) || diameter <= 0 || diameter > 240)) {
      return json({ error: "Enter a valid stump diameter" }, 400);
    }

    const { data: me } = await admin.from("profiles")
      .select("id, parent_contractor_id, role")
      .eq("id", user.id)
      .maybeSingle();
    const ownerId = me?.parent_contractor_id ?? user.id;
    const canManage = me?.role === "admin" || me?.role === "contractor" || Boolean(me?.parent_contractor_id);
    if (!canManage) return json({ error: "Forbidden" }, 403);

    const { data: job } = await admin.from("bid_requests")
      .select("id, owner_contractor_id, title, city, role_needed, needs_stump_grinding, status")
      .eq("id", requestId)
      .maybeSingle();
    if (!job || (me?.role !== "admin" && job.owner_contractor_id !== ownerId)) {
      return json({ error: "Job not found" }, 404);
    }

    const wasEnabled = job.needs_stump_grinding === true;
    const { error: updateError } = await admin.from("bid_requests").update({
      needs_stump_grinding: enabled,
      stump_diameter_inches: enabled ? diameter : null,
    }).eq("id", requestId);
    if (updateError) return json({ error: updateError.message }, 400);

    let notified = 0;
    if (enabled && !wasEnabled && job.status === "open") {
      const recipients = await eligibleRecipients(admin, job.owner_contractor_id, {
        roleNeeded: String(job.role_needed ?? "climber"),
        needsStump: true,
        stumpDiameter: diameter,
        inquiry: true,
      });
      const grinders = recipients.filter((recipient) => recipient.trade === "stump");
      if (grinders.length) {
        const { data: existing } = await admin.from("bid_request_recipients")
          .select("crew_member_id")
          .eq("bid_request_id", requestId)
          .in("crew_member_id", grinders.map((recipient) => recipient.id));
        const existingIds = new Set((existing ?? []).map((row) => row.crew_member_id));
        const newGrinders = grinders.filter((recipient) => !existingIds.has(recipient.id));
        if (newGrinders.length) {
          const { data: owner } = await admin.from("profiles")
            .select("company_name, full_name")
            .eq("id", job.owner_contractor_id)
            .maybeSingle();
          notified = await notifyBidRequest(
            admin,
            job,
            owner?.company_name || owner?.full_name || "A tree company",
            newGrinders,
          );
        }
      }
    }

    return json({ ok: true, notified });
  } catch (error) {
    console.error("update-job-stump error", error);
    return json({ error: error instanceof Error ? error.message : "Could not update stump grinding" }, 500);
  }
});