import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { companyMode } from "../_shared/tcNotify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function normalizePhone(raw: string): string {
  let p = raw.replace(/\D/g, "");
  if (p.length === 10) p = "+1" + p;
  else if (!p.startsWith("+")) p = "+" + p;
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Identify caller
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const closeoutId = body?.closeout_id as string | undefined;
    if (!closeoutId) return json({ error: "closeout_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load closeout
    const { data: closeout, error: cErr } = await admin
      .from("lead_closeouts")
      .select("id, contractor_id, lead_id, review_requested")
      .eq("id", closeoutId)
      .maybeSingle();
    if (cErr || !closeout) return json({ error: "Closeout not found" }, 404);

    // Authorize: must be the contractor on the closeout (or admin via profile check)
    const { data: callerProfile } = await admin
      .from("profiles")
      .select("id, role, full_name, company_name, parent_contractor_id")
      .eq("id", userId)
      .maybeSingle();
    const isAdmin = callerProfile?.role === "admin";
    const isOwner = closeout.contractor_id === userId;
    const isTeam = callerProfile?.parent_contractor_id === closeout.contractor_id;
    if (!isOwner && !isAdmin && !isTeam) return json({ error: "Forbidden" }, 403);

    // A sandbox (demo) company never texts customers.
    if ((await companyMode(admin, closeout.contractor_id)) === "sandbox") {
      return json({ error: "The demo company doesn't send review requests." });
    }

    // Load lead (customer info)
    const { data: lead, error: lErr } = await admin
      .from("leads")
      .select("customer_name, customer_phone")
      .eq("id", closeout.lead_id)
      .maybeSingle();
    if (lErr || !lead) return json({ error: "Lead not found" }, 404);
    if (!lead.customer_phone) return json({ error: "Customer has no phone on file" }, 400);

    // Load contractor profile (owner of closeout, not the caller)
    const { data: contractor } = await admin
      .from("profiles")
      .select("full_name, company_name")
      .eq("id", closeout.contractor_id)
      .maybeSingle();

    // Load Google review link
    const { data: integration } = await admin
      .from("dma_integrations")
      .select("google_review_link")
      .eq("contractor_id", closeout.contractor_id)
      .maybeSingle();
    const reviewLink = integration?.google_review_link;
    if (!reviewLink) {
      return json({ error: "Set your Google review link first", code: "missing_review_link" }, 400);
    }

    // Load template (fallback to default)
    const { data: tpl } = await admin
      .from("dma_review_templates")
      .select("template_text")
      .eq("contractor_id", closeout.contractor_id)
      .maybeSingle();
    const templateText =
      tpl?.template_text ||
      "Hi {customer_name}, thanks for choosing {company_name}! If we earned it, would you leave us a quick Google review? {review_link} — {contractor_first_name}";

    const customerFirst = (lead.customer_name || "there").split(" ")[0];
    const contractorFirst = (contractor?.full_name || "the team").split(" ")[0];
    const companyName = contractor?.company_name || contractor?.full_name || "our team";

    const message = templateText
      .replaceAll("{customer_name}", customerFirst)
      .replaceAll("{company_name}", companyName)
      .replaceAll("{review_link}", reviewLink)
      .replaceAll("{contractor_first_name}", contractorFirst);

    // Send SMS via Twilio
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!accountSid || !authToken || !fromNumber) {
      return json({ error: "SMS not configured" }, 500);
    }

    const to = normalizePhone(lead.customer_phone);
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        },
        body: new URLSearchParams({ To: to, From: fromNumber, Body: message }),
      },
    );
    const twilioData = await twilioRes.json();
    if (!twilioRes.ok) {
      console.error("Twilio error", twilioData);
      return json({ error: twilioData?.message || "SMS send failed", twilio: twilioData }, 502);
    }

    // Mark closeout as review requested
    await admin
      .from("lead_closeouts")
      .update({ review_requested: true, review_requested_at: new Date().toISOString() })
      .eq("id", closeoutId);

    return json({ success: true, sid: twilioData.sid, to, message });
  } catch (err) {
    console.error("send-review-request error", err);
    return json({ error: String(err) }, 500);
  }
});
