// Confirms the hire once the homeowner accepts the quote.
// Called by the Jobber quote webhook (service role) or by the owner tapping
// "Quote accepted — hire them" on the Bid Board.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
  if (!res.ok) console.error("hire sms failed", res.status, await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    const token = authHeader.replace("Bearer ", "").trim();
    const isInternal = token === SERVICE;

    const body = await req.json().catch(() => ({}));
    const requestId = typeof body.bid_request_id === "string" ? body.bid_request_id : null;
    const quoteId = typeof body.jobber_quote_id === "string" ? body.jobber_quote_id : null;
    if (!requestId && !quoteId) return json({ error: "bid_request_id or jobber_quote_id required" }, 400);

    let q = admin.from("bid_requests").select(
      "id, owner_contractor_id, title, city, awarded_bid_id, awarded_date, awarded_ground_bid_id, awarded_ground_date, hired_at, status",
    );
    q = requestId ? q.eq("id", requestId) : q.eq("jobber_quote_id", quoteId!);
    const { data: request } = await q.maybeSingle();
    if (!request) return json({ error: "No bid request for that quote" }, 404);

    if (!isInternal) {
      const { data: u } = await admin.auth.getUser(token);
      if (!u?.user) return json({ error: "Unauthorized" }, 401);
      const { data: me } = await admin
        .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
      const ownerId = me?.parent_contractor_id ?? u.user.id;
      if (ownerId !== request.owner_contractor_id) return json({ error: "Not your bid request" }, 403);
      const caller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
      const { data: allowed, error: permissionError } = await caller.rpc('company_has_permission', { p_owner: ownerId, p_permission: 'manageJobsSubs' });
      if (permissionError || !allowed) return json({ error: 'Company Jobs and Subs permission required.' }, 403);
    }

    if (!request.awarded_bid_id) return json({ error: "No crew has been awarded this job yet" }, 400);
    if (request.hired_at) return json({ success: true, already_hired: true });

    // Both the climber and the ground crew (when one was picked) get hired.
    const awardedBidIds = [request.awarded_bid_id, request.awarded_ground_bid_id].filter(Boolean) as string[];
    const { data: awardedBids } = await admin
      .from("bids").select("id, crew_member_id, ideal_pay, bid_role").in("id", awardedBidIds);
    const memberIds = (awardedBids ?? []).map((b: any) => b.crew_member_id);
    const { data: crewRows } = await admin
      .from("crew_members").select("id, full_name, phone, user_id")
      .in("id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
    const crewById = new Map((crewRows ?? []).map((c: any) => [c.id, c]));

    await admin.from("bid_requests").update({
      hired_at: new Date().toISOString(),
      quote_status: "approved",
      status: "hired",
      updated_at: new Date().toISOString(),
    }).eq("id", request.id);
    await admin.from("bids").update({ status: "hired" }).in("id", awardedBidIds);

    const { data: ownerProfile } = await admin
      .from("profiles").select("company_name, full_name, phone").eq("id", request.owner_contractor_id).maybeSingle();
    const company = ownerProfile?.company_name || ownerProfile?.full_name || "The company";

    const where = request.city ? ` in ${request.city}` : "";
    const whenFor = (bid: any) => {
      const d = String(bid?.bid_role ?? "climber") === "ground"
        ? (request.awarded_ground_date ?? request.awarded_date)
        : request.awarded_date;
      return d ? ` Scheduled for ${d}.` : "";
    };

    let smsSent = 0;
    const hiredNames: string[] = [];
    for (const bid of awardedBids ?? []) {
      const member: any = crewById.get(bid.crew_member_id);
      if (!member) continue;
      if (member.full_name) hiredNames.push(String(member.full_name));
      const when = whenFor(bid);
      const msg = `You're hired — ${request.title}${where}.${when} ${company} will send you the address and details. Open TreeCheck for the job.`;
      if (member.phone && await sendSms(String(member.phone), msg)) smsSent++;
      if (member.user_id) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
            body: JSON.stringify({
              contractor_ids: [member.user_id],
              notification_type: "account_activity_non_payment",
              title: "You're hired",
              body: `${request.title}${where}.${when}`,
              data: { route: "/dashboard/crew-bids", bid_request_id: request.id, source: "crew_hired" },
            }),
          });
        } catch (e) {
          console.warn("hire push failed", e);
        }
      }
    }

    // Let the office know the crew has been confirmed.
    if (ownerProfile?.phone) {
      const whenLabel = request.awarded_date ? ` Scheduled for ${request.awarded_date}.` : "";
      await sendSms(
        String(ownerProfile.phone),
        `Quote accepted — ${hiredNames.join(" and ") || "your crew"} confirmed for ${request.title}${where}.${whenLabel}`,
      );
    }

    // Now that the job is real, call the ground workers in.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/job-dispatch-open`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ bid_request_id: request.id }),
      });
    } catch (e) {
      console.warn("ground dispatch failed", e);
    }

    // If the ground crew already lined up on a day, book it in Jobber now.
    try {
      const { data: filled } = await admin.from("job_dispatches").select("id, jobber_status")
        .eq("bid_request_id", request.id).eq("status", "filled");
      for (const d of filled ?? []) {
        if (d.jobber_status === "scheduled") continue;
        await fetch(`${SUPABASE_URL}/functions/v1/job-dispatch-availability`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({ dispatch_id: d.id, action: "schedule" }),
        });
      }
    } catch (e) {
      console.warn("jobber schedule on approval failed", e);
    }

    return json({ success: true, sms_sent: smsSent, crew: hiredNames });
  } catch (e) {
    console.error("bid-hire error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
