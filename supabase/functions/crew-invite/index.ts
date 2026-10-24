// Owner invites a contract climber / ground worker into their crew network.
// Creates (or attaches) the auth user, adds an active crew_members row, and
// texts + emails them a temporary password.
import { createClient } from "npm:@supabase/supabase-js@2";
import { companyMode } from "../_shared/tcNotify.ts";
import { companyHasScout } from "../_shared/callerGuard.ts";
import { companyPlan } from "../_shared/freePlan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const APP_URL = "https://app.treecheck.ai";

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
  if (!res.ok) console.error("crew-invite sms failed", res.status, await res.text());
  return res.ok;
}

function tempPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return "Crew" + Array.from(bytes).map((b) => chars[b % chars.length]).join("") + "!1";
}

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

    const { data: me } = await admin
      .from("profiles").select("parent_contractor_id, company_name, full_name").eq("id", u.user.id).maybeSingle();
    const ownerId = me?.parent_contractor_id ?? u.user.id;
    // A sandbox (demo) company never invites or texts real people.
    if ((await companyMode(admin, ownerId)) === "sandbox") {
      return json({ error: "The demo company can't invite crew." });
    }
    // Always greet with the owner company's name, even when a team member sends the invite.
    const { data: ownerProfile } = await admin
      .from("profiles").select("company_name, full_name, account_type").eq("id", ownerId).maybeSingle();
    // Anyone can get a login from the public signups; only a tree company with Scout invites crew (as in the app).
    if (ownerProfile?.account_type === "subcontractor") return json({ error: "Only a tree company can invite crew." }, 403);
    const { data: billing } = await admin.from('company_billing').select('pricing_version').eq('owner_id', ownerId).maybeSingle();
    if (billing?.pricing_version === '2026-10') {
      const caller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
      const { data: mayInvite, error } = await caller.rpc('company_has_permission', { p_owner: ownerId, p_permission: 'manageJobsSubs' });
      if (error || !mayInvite) return json({ error: 'Company Jobs and Subs permission required.' }, 403);
    } else if ((await companyPlan(admin, ownerId)) !== "free" && !(await companyHasScout(admin, ownerId, u.user.id))) {
      return json({ error: "Inviting crew is part of Scout. Start or renew Scout to invite your crew." }, 403);
    }
    const company = ownerProfile?.company_name || ownerProfile?.full_name
      || me?.company_name || me?.full_name || "a tree company";

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const trade = ["climber", "ground", "both", "stump", "pending"].includes(body.trade) ? body.trade : "pending";
    const certifications = typeof body.certifications === "string" ? body.certifications.trim() : null;
    const equipment = typeof body.equipment === "string" ? body.equipment.trim() : null;

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "A valid email is required" }, 400);
    if (!fullName) return json({ error: "Name is required" }, 400);

    // Find or create the auth user.
    let userId: string | null = null;
    let password: string | null = null;
    const { data: existingProfile } = await admin
      .from("profiles").select("id").eq("email", email).maybeSingle();

    if (existingProfile) {
      userId = existingProfile.id as string;
    } else {
      password = tempPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr || !created.user) return json({ error: createErr?.message || "Could not create account" }, 400);
      userId = created.user.id;
      await admin.from("profiles")
        .update({ full_name: fullName, phone: phone || null })
        .eq("id", userId);
    }

    // Already in someone's network?
    const { data: dupe } = await admin
      .from("crew_members").select("id, owner_contractor_id").eq("user_id", userId).eq("owner_contractor_id", ownerId).maybeSingle();

    let crewId = dupe?.id as string | undefined;
    if (crewId) {
      await admin.from("crew_members").update({
        full_name: fullName, phone: phone || null, email, trade, certifications, equipment, status: "active",
      }).eq("id", crewId);
    } else {
      const { data: inserted, error: insErr } = await admin.from("crew_members").insert({
        owner_contractor_id: ownerId,
        user_id: userId,
        full_name: fullName,
        phone: phone || null,
        email,
        trade,
        certifications,
        equipment,
        status: "active",
      }).select("id").single();
      if (insErr) return json({ error: insErr.message }, 400);
      crewId = inserted.id as string;
    }

    let smsSent = false;
    if (phone.replace(/\D/g, "").length >= 10) {
      const creds = password ? `\n\nLogin: ${email}\nTemporary password: ${password}` : `\n\nSign in with your existing TreeCheck login (${email}).`;
      const reinstall = body.reinstall === true;
      const installLine = reinstall
        ? `\n\nPlease DELETE TreeCheck from your phone first. Then watch the short video and follow the iPhone or Android steps to add it again: ${APP_URL}/crew-install`
        : `\n\nWatch the short video and follow the iPhone or Android steps to add TreeCheck to your phone: ${APP_URL}/crew-install`;
      smsSent = await sendSms(
        phone,
        `${company} added you to their crew network on TreeCheck. You'll get a text when a job is open for bids.${creds}${installLine}`,
      );
    }

    // Let them in on the jobs that are already open for bids.
    let openJobs = 0;
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/crew-backfill-bids`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ crew_member_id: crewId, owner_contractor_id: ownerId }),
      });
      const j = await r.json().catch(() => ({}));
      openJobs = Number(j?.added ?? 0);
    } catch (e) {
      console.warn("crew-invite backfill failed", e);
    }

    return json({ success: true, crew_member_id: crewId, temp_password: password, sms_sent: smsSent, open_jobs: openJobs });
  } catch (e) {
    console.error("crew-invite error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
