// Opens the owner's recent website leads for crew bidding (the ones that came in
// before the crew network existed, or before auto-broadcast was switched on).
// Creates one bid request per lead via bid-request-create, skipping any lead that
// already has one.
import { createClient } from "npm:@supabase/supabase-js@2";

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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const isInternal = authHeader.replace("Bearer ", "").trim() === SERVICE_KEY;

    let ownerId: string;
    if (isInternal) {
      if (typeof body.owner_contractor_id !== "string") return json({ error: "owner_contractor_id required" }, 400);
      ownerId = body.owner_contractor_id;
    } else {
      const { data: u } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!u?.user) return json({ error: "Unauthorized" }, 401);
      const { data: me } = await admin
        .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
      ownerId = me?.parent_contractor_id ?? u.user.id;
    }

    const days = Number(body.days) > 0 ? Math.min(90, Number(body.days)) : 14;
    const limit = Number(body.limit) > 0 ? Math.min(25, Number(body.limit)) : 10;
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    const { data: leads } = await admin
      .from("leads")
      .select("id, job_type, city, photo_url, urgency, customer_notes, created_at, status")
      .eq("owner_contractor_id", ownerId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    const candidates = (leads ?? []).filter((l: any) => l.status !== "closed" && l.photo_url);
    if (!candidates.length) return json({ success: true, opened: 0, skipped: 0 });

    const { data: already } = await admin
      .from("bid_requests").select("lead_id").eq("owner_contractor_id", ownerId)
      .in("lead_id", candidates.map((l: any) => l.id));
    const have = new Set((already ?? []).map((r: any) => r.lead_id));

    let opened = 0;
    const errors: string[] = [];
    for (const lead of candidates) {
      if (opened >= limit) break;
      if (have.has(lead.id)) continue;

      const description = [
        `${lead.job_type}${lead.city ? ` in ${lead.city}` : ""}.`,
        lead.urgency ? `Customer timeline: ${lead.urgency}.` : null,
        lead.customer_notes ? `What the customer told us: ${lead.customer_notes}` : null,
      ].filter(Boolean).join("\n\n");

      const r = await fetch(`${SUPABASE_URL}/functions/v1/bid-request-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          owner_contractor_id: ownerId,
          lead_id: lead.id,
          title: `${lead.job_type}${lead.city ? ` — ${lead.city}` : ""}`,
          description,
          city: lead.city,
          photo_path: /^https?:/i.test(String(lead.photo_url)) ? null : lead.photo_url,
          deadline_hours: Number(body.deadline_hours) > 0 ? Number(body.deadline_hours) : 72,
          role_needed: ["climber", "ground", "both"].includes(body.role_needed) ? body.role_needed : "climber",
          job_type: lead.job_type,
          needs_stump_grinding: /stump/i.test(String(lead.job_type ?? "")),
        }),
      });
      const out = await r.json().catch(() => ({}));
      if (r.ok && !out?.error) opened++;
      else errors.push(String(out?.error ?? r.status));
    }

    return json({ success: true, opened, considered: candidates.length, errors: errors.slice(0, 3) });
  } catch (e) {
    console.error("crew-open-recent-leads error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
