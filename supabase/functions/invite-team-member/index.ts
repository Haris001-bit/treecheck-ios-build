import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { companyMode } from "../_shared/tcNotify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://app.treecheck.ai";

function b64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const connKey = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!apiKey || !connKey) return { sent: false, error: "email not configured" };

  const mime = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");

  const res = await fetch(
    "https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: b64url(mime) }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    console.error("gmail send failed", res.status, t);
    return { sent: false, error: `gmail ${res.status}` };
  }
  return { sent: true };
}

async function sendSms(to: string, body: string) {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !from) return { sent: false, error: "sms not configured" };

  let phone = to.replace(/\D/g, "");
  if (phone.length === 10) phone = "+1" + phone;
  else if (!phone.startsWith("+")) phone = "+" + phone;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
      },
      body: new URLSearchParams({ To: phone, From: from, Body: body }),
    },
  );
  if (!res.ok) {
    console.error("twilio failed", res.status, await res.text());
    return { sent: false, error: `twilio ${res.status}` };
  }
  return { sent: true };
}

function inviteHtml(company: string, inviteUrl: string | null, existingAccount = false) {
  const cta = inviteUrl
    ? `<p style="margin:24px 0"><a href="${inviteUrl}" style="background:#7a9b4d;color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${existingAccount ? "Accept your invite" : "Accept your invite &amp; set up your account"}</a></p>
       ${existingAccount ? `<p style="font-size:14px">You already have a TreeCheck login. Open the link, sign in with it when asked, then accept.</p>` : ""}
       <p style="font-size:13px;color:#666">Or paste this link into your browser:<br>${inviteUrl}</p>`
    : `<p style="margin:24px 0"><a href="${APP_URL}/login" style="background:#7a9b4d;color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Sign in to TreeCheck</a></p>`;

  return `<div style="font-family:Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <h2 style="color:#7a9b4d;margin-bottom:8px">You've been added to ${company} on TreeCheck</h2>
    <p>TreeCheck is the app your team uses for leads, field estimates (Scout&trade;), and job marketing.</p>
    ${cta}
    <h3 style="margin-bottom:4px">Watch the video and get the app on your phone</h3>
    <p style="margin-top:4px">Open the <a href="${APP_URL}/crew-install">TreeCheck video and phone setup guide</a>. It has clear, separate steps for iPhone and Android.</p>
    <p style="font-size:13px;color:#666;margin-top:24px">Questions? Just reply to this email.</p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
    const auth = req.headers.get("Authorization");
    if (!auth) throw new Error("No auth header");
    const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (!user?.email) throw new Error("Not authenticated");
    const { data: billingVersion } = await supabase.from('company_billing').select('pricing_version').eq('owner_id', user.id).maybeSingle();
    if (billingVersion?.pricing_version === '2026-10') throw new Error('Use the company team-access confirmation to reserve included or paid capacity.');

    const { email, phone, fullName } = await req.json();
    if (!email || typeof email !== "string") throw new Error("Email required");
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = typeof phone === "string" && phone.replace(/\D/g, "").length >= 10
      ? phone.trim()
      : null;
    const cleanName = typeof fullName === "string" && fullName.trim() ? fullName.trim() : null;

    // A sandbox (demo) company may invite real office teammates on purpose (Mark, 2026-10-27), with free seats.
    const isSandbox = (await companyMode(supabase, user.id)) === "sandbox";

    // Founder bypass — anyone else needs paid seats
    const { data: profile } = await supabase
      .from("profiles").select("is_founder, company_name, full_name").eq("id", user.id).single();
    const isFounder = !!profile?.is_founder;
    const company = profile?.company_name || profile?.full_name || "your team";

    if (!isFounder && !isSandbox) {
      const { data: seats } = await supabase
        .from("team_seats").select("seat_quantity, status").eq("contractor_id", user.id).maybeSingle();
      const { count: usedCount } = await supabase
        .from("profiles").select("id", { count: "exact", head: true }).eq("parent_contractor_id", user.id);
      const { count: pendingCount } = await supabase
        .from("team_invitations").select("id", { count: "exact", head: true })
          .eq("parent_contractor_id", user.id).is("used_at", null)
          .gt("expires_at", new Date().toISOString());
      const used = (usedCount ?? 0) + (pendingCount ?? 0);
      const allowed = seats?.seat_quantity ?? 0;
      if (used >= allowed) {
        return new Response(JSON.stringify({ error: "No available seats. Add a seat first ($9/mo)." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Existing accounts are never attached directly: they get the same invitation as
    // everyone else and accept it themselves after signing in with their own login.
    const { data: existingProfile } = await supabase
      .from("profiles").select("id, parent_contractor_id").eq("email", cleanEmail).maybeSingle();

    // 200 with a code so the Team page can show the message (the client hides non-2xx bodies).
    if (existingProfile?.parent_contractor_id) {
      const own = existingProfile.parent_contractor_id === user.id;
      return new Response(JSON.stringify({
        error: own ? "That user is already on your team." : "That user is already on another team.",
        code: own ? "already_on_your_team" : "already_on_another_team",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create invitation
    const { data: invitation, error: inviteErr } = await supabase
      .from("team_invitations")
      .insert({ parent_contractor_id: user.id, email: cleanEmail, phone: cleanPhone, full_name: cleanName })
      .select().single();
    if (inviteErr) throw inviteErr;

    // Always the real app address: the sender's page may be a preview the invitee can't open.
    const inviteUrl = `${APP_URL}/accept-invite?team_token=${invitation.invite_token}`;

    const mail = await sendEmail(
      cleanEmail,
      `Your TreeCheck invite from ${company}`,
      inviteHtml(company, inviteUrl, !!existingProfile),
    );
    let sms: { sent: boolean } = { sent: false };
    if (cleanPhone) {
      sms = await sendSms(
        cleanPhone,
        existingProfile
          ? `${company} invited you to their team on TreeCheck. Open this link, sign in with your existing TreeCheck login (${cleanEmail}) and accept: ${inviteUrl}`
          : `${company} invited you to TreeCheck. Set up your account: ${inviteUrl}\n\nThen watch the short video and follow the iPhone or Android setup steps: ${APP_URL}/crew-install`,
      );
    }

    return new Response(JSON.stringify({
      success: true,
      invite_url: inviteUrl,
      expires_at: invitation.expires_at,
      email_sent: mail.sent,
      sms_sent: sms.sent,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
