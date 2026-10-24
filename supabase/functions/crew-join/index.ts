// Public self-signup for contract climbers / ground workers.
// Creates the account (if needed) and adds a PENDING crew_members row that the
// owner must approve before the person receives any bid requests.
// An email that already has an account needs that account's password, and an existing account's profile
// (name, phone, account type) is never changed here: the form is public, so knowing an email is not enough.
import { createClient } from "npm:@supabase/supabase-js@2";
import { companyMode } from "../_shared/tcNotify.ts";

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
  if (!res.ok) console.error("crew-join sms failed", res.status, await res.text());
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const ownerId = typeof body.owner === "string" ? body.owner.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 80) : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const trade = ["climber", "ground", "both", "stump", "crane"].includes(body.trade) ? body.trade : "climber";
    const certifications = typeof body.certifications === "string" ? body.certifications.trim() : null;
    const equipment = typeof body.equipment === "string" ? body.equipment.trim() : null;

    // Capability profile — informational, never a gate on joining.
    const bool = (v: unknown) => v === true;
    const capabilities = {
      insured: ["yes", "no", "working_on_it"].includes(body.insured) ? body.insured : null,
      wants_ground_work: trade === "ground" ? true : bool(body.wantsGroundWork),
      can_skid_steer: bool(body.canSkidSteer),
      mini_skid_experience: bool(body.miniSkidExperience),
      can_chipper: bool(body.canChipper),
      crane_certified: bool(body.craneCertified),
      truck_trailer_experience: bool(body.truckTrailerExperience),
      disposal_runs_ok: bool(body.disposalRunsOk),
      owns_saws: bool(body.ownsSaws),
      has_drivers_license: bool(body.hasDriversLicense),
      tree_experience_level: ["never", "some", "experienced"].includes(body.treeExperienceLevel)
        ? body.treeExperienceLevel
        : null,
      years_climbing: Number.isFinite(Number(body.yearsClimbing)) && Number(body.yearsClimbing) >= 0
        ? Math.min(60, Math.round(Number(body.yearsClimbing)))
        : null,
    };

    if (ownerId && !/^[0-9a-f-]{36}$/i.test(ownerId)) return json({ error: "Invalid invite link" }, 400);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "A valid email is required" }, 400);
    if (!fullName) return json({ error: "Name is required" }, 400);
    if (!password) return json({ error: "Enter a password" }, 400);
    if (phone.replace(/\D/g, "").length < 10) return json({ error: "A mobile number is required so we can text you jobs" }, 400);

    const { data: owner } = ownerId ? await admin
      .from("profiles").select("id, company_name, full_name, phone").eq("id", ownerId).maybeSingle() : { data: null };
    if (ownerId && !owner) return json({ error: "Invalid invite link" }, 400);
    // A sandbox (demo) company takes no outside sign-ups.
    if (ownerId && (await companyMode(admin, ownerId)) === "sandbox") {
      return json({ error: "This invite link isn't taking new members." });
    }

    let userId: string | null = null;
    const { data: existingProfile } = await admin
      .from("profiles").select("id").eq("email", email).maybeSingle();
    let isNewAccount = !existingProfile;

    const existingAccount = "You already have a TreeCheck account with this email. Enter that account's password, or reset it from the sign-in screen.";
    const passwordOwner = async () => {
      const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
      const { data: signedIn, error: signInErr } = await authClient.auth.signInWithPassword({ email, password });
      if (signInErr || !signedIn.user) return null;
      await authClient.auth.signOut({ scope: "local" }); // only this check's session
      return signedIn.user.id;
    };

    if (existingProfile) {
      // The account the email and password open, which is the one being joined (profiles.email can be stale).
      userId = await passwordOwner();
      if (!userId) return json({ error: existingAccount }, 400);
    } else {
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr && ((createErr as { code?: string }).code === "email_exists" || /already (been )?registered|already exists/i.test(createErr.message))) {
        // The account exists under a differently written email in profiles: same rule, its password or nothing.
        userId = await passwordOwner();
        if (!userId) return json({ error: existingAccount }, 400);
        isNewAccount = false;
      } else {
        if (createErr && (createErr as { code?: string }).code === "weak_password") return json({ error: createErr.message }, 400);
        if (createErr || !created.user) return json({ error: createErr?.message || "Could not create account" }, 500);
        userId = created.user.id;
        await admin.from("profiles").update({ full_name: fullName, phone, account_type: "subcontractor" }).eq("id", userId);
      }
    }

    if (!ownerId) {
      if (isNewAccount) await admin.from("profiles").update({ full_name: fullName, phone, account_type: "subcontractor" }).eq("id", userId);
      await admin.from("crew_profiles").upsert({ user_id: userId, network_visible: true, home_city: body.locationLabel || body.location || null, travel_radius_miles: 30, latitude: body.latitude ?? null, longitude: body.longitude ?? null, location_label: body.locationLabel || null }, { onConflict: "user_id" });
      return json({ success: true, status: "network", company: null });
    }

    const { data: existingCrew } = await admin
      .from("crew_members").select("id, status").eq("user_id", userId).eq("owner_contractor_id", ownerId).maybeSingle();

    let crewMemberId: string | null = existingCrew?.id ?? null;
    if (existingCrew) {
      await admin.from("crew_members").update({
        full_name: fullName, phone, email, trade, certifications, equipment, ...capabilities,
      }).eq("id", existingCrew.id);
    } else {
      const { data: inserted, error: insErr } = await admin.from("crew_members").insert({
        owner_contractor_id: ownerId,
        user_id: userId,
        full_name: fullName,
        phone,
        email,
        trade,
        certifications,
        equipment,
        status: "pending",
        ...capabilities,
      }).select("id").single();
      if (insErr) return json({ error: insErr.message }, 500);
      crewMemberId = inserted?.id ?? null;
    }

    // Start them with a normal Mon–Fri availability record they can adjust.
    if (crewMemberId) {
      const weekly = Array.isArray(body.weeklyDays)
        ? body.weeklyDays.filter((d: unknown) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 6)
        : [1, 2, 3, 4, 5];
      await admin.from("crew_availability").upsert(
        { crew_member_id: crewMemberId, weekly_days: weekly, taking_work: true },
        { onConflict: "crew_member_id" },
      );
    }

    const company = owner?.company_name || owner?.full_name || "the crew network";
    // One text per new request: asking again for the same company doesn't text the owner again.
    if (owner?.phone && !existingCrew) {
      await sendSms(owner.phone as string, `TreeCheck: ${fullName} asked to join your crew network. Approve them under Crew Network.`);
    }

    return json({ success: true, status: existingCrew?.status ?? "pending", company });
  } catch (e) {
    console.error("crew-join error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
