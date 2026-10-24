import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Accepts a team invitation.
// - Brand-new email: creates the account with the password given here and links it to the team.
// - Email that already has a TreeCheck account: never touches its password. The invitee must be
//   signed in as that same email (Authorization header) and accept; the link alone is not enough.
// Codes returned with HTTP 200 so the page can react: existing_account_sign_in, password_required.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { team_token, password, fullName, phone } = await req.json();
    const resolvedName = (typeof fullName === "string" && fullName.trim()) ? fullName.trim() : null;
    if (!team_token) {
      throw new Error("Missing required fields");
    }

    // Lookup invitation
    const { data: invite, error: invErr } = await admin
      .from("team_invitations")
      .select("id, parent_contractor_id, email, phone, full_name, expires_at, used_at")
      .eq("invite_token", team_token)
      .maybeSingle();
    if (invErr) throw invErr;
    if (!invite) throw new Error("Invalid invitation link");
    if (invite.used_at) throw new Error("This invitation has already been used");
    if (new Date(invite.expires_at) < new Date()) throw new Error("This invitation has expired");
    const { data: companyBilling } = await admin.from('company_billing').select('pricing_version').eq('owner_id', invite.parent_contractor_id).maybeSingle();
    const versioned = companyBilling?.pricing_version === '2026-10';
    const { data: reservation } = versioned ? await admin.from('team_member_access').select('id,status,member_kind').eq('invitation_id', invite.id).eq('owner_id', invite.parent_contractor_id).maybeSingle() : { data: null };
    if (versioned && (!reservation || reservation.status !== 'invited')) throw new Error('This invitation does not have a reserved seat. Ask the owner to invite you again.');

    // Get parent profile (for company_name inheritance)
    const { data: parentProfile } = await admin
      .from("profiles")
      .select("company_name")
      .eq("id", invite.parent_contractor_id)
      .maybeSingle();

    // Check if user already exists
    const { data: existing, error: existingErr } = await admin
      .from("profiles").select("id, parent_contractor_id").eq("email", invite.email).maybeSingle();
    if (existingErr) throw existingErr;

    let userId: string;
    let session: unknown = null;

    if (existing) {
      const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      const { data: caller } = bearer
        ? await admin.auth.getUser(bearer)
        : { data: { user: null } };
      const callerEmail = (caller?.user?.email ?? "").toLowerCase();
      if (!caller?.user || callerEmail !== String(invite.email).toLowerCase()) {
        return json({
          error: "You already have a TreeCheck account with this email. Sign in with it, then open this invitation link again.",
          code: "existing_account_sign_in",
        });
      }
      if (caller.user.id !== existing.id) throw new Error("Invalid invitation link");
      if (existing.parent_contractor_id && existing.parent_contractor_id !== invite.parent_contractor_id) {
        throw new Error("This account is already on another team.");
      }
      const { count: ownTeam, error: teamErr } = await admin
        .from("profiles").select("id", { count: "exact", head: true })
        .eq("parent_contractor_id", existing.id);
      if (teamErr) throw teamErr;
      if ((ownTeam ?? 0) > 0) {
        throw new Error("This account manages its own team, so it can't join another team.");
      }

      userId = existing.id;
      // Link to the team only. Name, phone and password stay as the account owner set them.
      const { error: linkErr } = await admin.from("profiles")
        .update({ parent_contractor_id: invite.parent_contractor_id })
        .eq("id", userId);
      if (linkErr) throw linkErr;
    } else {
      if (!password) {
        return json({ error: "Choose a password to set up your account.", code: "password_required" });
      }
      if (password.length < 6) throw new Error("Password must be at least 6 characters");

      // Create new auth user (auto-confirmed)
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: invite.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: resolvedName ?? invite.full_name ?? null, phone: phone ?? invite.phone ?? null },
      });
      if (createErr) throw createErr;
      if (!created.user) throw new Error('Account creation failed.');
      userId = created.user.id;

      // Upsert profile, link to parent
      await admin.from("profiles").upsert({
        id: userId,
        email: invite.email,
        full_name: resolvedName ?? invite.full_name ?? null,
        phone: phone ?? invite.phone ?? null,
        company_name: parentProfile?.company_name ?? null,
        parent_contractor_id: invite.parent_contractor_id,
      }, { onConflict: "id" });
    }

    // Ensure user role is contractor
    await admin.from("user_roles").upsert(
      { user_id: userId, role: "contractor" },
      { onConflict: "user_id,role", ignoreDuplicates: true }
    );

    // Mark invitation used
    if (versioned && reservation) {
      const { error: reservationError } = await admin.from('team_member_access').update({ user_id: userId, status: 'active' }).eq('id', reservation.id).eq('status', 'invited');
      if (reservationError) throw reservationError;
    }
    await admin.from("team_invitations").update({ used_at: new Date().toISOString() }).eq("id", invite.id);

    if (!existing) {
      // Sign the new user in (return session)
      const { data: signin, error: signErr } = await admin.auth.signInWithPassword({
        email: invite.email,
        password,
      });
      if (signErr) throw signErr;
      session = signin.session;
    }

    return json({
      success: true,
      session,
      email: invite.email,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 400);
  }
});
