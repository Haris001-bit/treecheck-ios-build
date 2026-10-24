// Gives a newly-active crew member access to the jobs that are already open for
// bids (e.g. website leads broadcast before they joined). Adds them as a
// recipient on every open, role-matching request from the last N days and sends
// one summary alert.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const APP_URL = "https://app.treecheck.ai";
const DEFAULT_DAYS = 14;

async function sendSms(to: string, body: string) {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !from) return false;
  let phone = to.replace(/\D/g, "");
  if (phone.length === 10) phone = "+1" + phone;
  else if (!phone.startsWith("+")) phone = "+" + phone;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
    },
    body: new URLSearchParams({ To: phone, From: from, Body: body }),
  });
  if (!res.ok) console.error("crew-backfill sms failed", res.status, await res.text());
  return res.ok;
}

function roleFits(roleNeeded: string, m: any) {
  const trade = String(m.trade ?? "climber");
  if (roleNeeded === "both") return true;
  if (roleNeeded === "climber") return trade === "climber" || trade === "both";
  return trade === "ground" || trade === "both" || m.wants_ground_work === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const isInternal = authHeader.replace("Bearer ", "").trim() === SERVICE_KEY;

    let ownerId: string | null = null;
    if (isInternal) {
      ownerId = typeof body.owner_contractor_id === "string" ? body.owner_contractor_id : null;
    } else {
      const { data: u } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!u?.user) return json({ error: "Unauthorized" }, 401);
      const { data: me } = await admin
        .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
      ownerId = me?.parent_contractor_id ?? u.user.id;
    }

    const crewMemberId = typeof body.crew_member_id === "string" ? body.crew_member_id : null;
    const days = Number(body.days) > 0 ? Math.min(90, Number(body.days)) : DEFAULT_DAYS;
    const notify = body.notify !== false;

    let memberQuery = admin
      .from("crew_members")
      .select("id, owner_contractor_id, full_name, phone, user_id, trade, wants_ground_work, status")
      .eq("status", "active");
    if (crewMemberId) memberQuery = memberQuery.eq("id", crewMemberId);
    if (ownerId) memberQuery = memberQuery.eq("owner_contractor_id", ownerId);
    const { data: allMembers } = await memberQuery;
    // Only climbers see open inquiries. Ground crew wait for the post-award
    // dispatch; stump grinders are alerted separately when a job needs grinding.
    const members = (allMembers ?? []).filter((m: any) => m.trade === "climber" || m.trade === "both");
    if (!members?.length) return json({ success: true, members: 0, added: 0 });

    const owners = [...new Set(members.map((m: any) => m.owner_contractor_id))];

    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const { data: requests } = await admin
      .from("bid_requests")
      .select("id, owner_contractor_id, title, city, role_needed, deadline_at, created_at")
      .in("owner_contractor_id", owners)
      .eq("status", "open")
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    const openRequests = (requests ?? []).filter(
      (_r: any) => true,
    );
    if (!openRequests.length) return json({ success: true, members: members.length, added: 0 });

    // Skip crew who have paused themselves.
    const { data: avail } = await admin
      .from("crew_availability").select("crew_member_id, taking_work")
      .in("crew_member_id", members.map((m: any) => m.id));
    const paused = new Set(
      (avail ?? []).filter((a: any) => a.taking_work === false).map((a: any) => a.crew_member_id),
    );

    const { data: existing } = await admin
      .from("bid_request_recipients")
      .select("bid_request_id, crew_member_id")
      .in("bid_request_id", openRequests.map((r: any) => r.id));
    const have = new Set((existing ?? []).map((e: any) => `${e.bid_request_id}:${e.crew_member_id}`));

    const rows: any[] = [];
    const perMember = new Map<string, number>();
    for (const m of members as any[]) {
      if (paused.has(m.id)) continue;
      for (const r of openRequests) {
        if (r.owner_contractor_id !== m.owner_contractor_id) continue;
        if (!roleFits(String(r.role_needed ?? "climber"), m)) continue;
        if (have.has(`${r.id}:${m.id}`)) continue;
        rows.push({ bid_request_id: r.id, crew_member_id: m.id, notified_at: new Date().toISOString() });
        perMember.set(m.id, (perMember.get(m.id) ?? 0) + 1);
      }
    }

    if (!rows.length) return json({ success: true, members: members.length, added: 0 });

    const { error: insErr } = await admin.from("bid_request_recipients").insert(rows);
    if (insErr) return json({ error: insErr.message }, 400);

    let smsSent = 0;
    if (notify) {
      const { data: ownerProfiles } = await admin
        .from("profiles").select("id, company_name, full_name").in("id", owners);
      const companyOf = new Map(
        (ownerProfiles ?? []).map((p: any) => [p.id, p.company_name || p.full_name || "A tree company"]),
      );
      const link = `${APP_URL}/dashboard/crew-bids`;
      for (const m of members as any[]) {
        const n = perMember.get(m.id) ?? 0;
        if (!n) continue;
        const company = companyOf.get(m.owner_contractor_id) ?? "A tree company";
        const msg = `${company}: ${n} tree job${n === 1 ? " is" : "s are"} open for bids right now. Open TreeCheck to see the photos and send your crew size, hours and minimum + ideal pay: ${link}`;
        if (m.phone && String(m.phone).replace(/\D/g, "").length >= 10) {
          if (await sendSms(String(m.phone), msg)) smsSent++;
        }
        if (m.user_id) {
          try {
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
              body: JSON.stringify({
                contractor_ids: [m.user_id],
                notification_type: "account_activity_non_payment",
                title: n === 1 ? "A job is open for bids" : `${n} jobs are open for bids`,
                body: "Tap to see the photos and send your pay range.",
                data: { route: "/dashboard/crew-bids", source: "crew_bids" },
              }),
            });
          } catch (e) {
            console.warn("crew-backfill push failed", e);
          }
        }
      }
    }

    return json({ success: true, members: members.length, added: rows.length, sms_sent: smsSent });
  } catch (e) {
    console.error("crew-backfill-bids error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
