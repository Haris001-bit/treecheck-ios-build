// Free iOS account registration (no Stripe). Body mirrors StartTrial fields without Checkout.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { parseConsent, recordConsent } from "../_shared/consent.ts";
import { giveawayOpen, recordGiveawayEntry } from "../_shared/giveaway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      email,
      password,
      full_name,
      company_name,
      phone,
      city,
      start_demo_iap,
    } = body || {};

    if (!email || !password || !full_name || !company_name) {
      throw new Error("email, password, full_name, and company_name are required");
    }

    // Older app builds send no consent; newer ones must agree to account messages. Marketing stays optional.
    const consent = parseConsent(body?.consent);
    if (consent && !consent.account) throw new Error("Check the box to agree to account messages about your account.");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      email_confirm: true,
      user_metadata: { full_name, company_name, phone, city },
    });
    if (createErr || !created.user) {
      throw new Error(createErr?.message || "Failed to create user");
    }

    const userId = created.user.id;

    await supabaseAdmin.from("profiles").upsert({
      id: userId,
      email: String(email).trim().toLowerCase(),
      full_name,
      company_name,
      phone: phone || null,
      is_active: true,
      subscription_tier: "free",
      credit_balance: 0,
    }, { onConflict: "id" });

    if (consent) await recordConsent(supabaseAdmin, req, userId, consent, { email, phone }, "app-signup");

    // Starting the 14-day trial enters the RipSaw giveaway, in the apps as on the website. Here the trial starts next, when
    // the owner picks a plan in the App Store or Google Play, so the entry waits for it: giveaway-draw counts it once the
    // store trial shows in company_billing. One entry per email; never blocks or changes the signup.
    if (giveawayOpen()) {
      await recordGiveawayEntry(supabaseAdmin, req, {
        userId, fullName: full_name, email, phone, companyName: company_name, region: body?.state,
        source: "app-signup", status: "awaiting_trial",
      });
    }

    // Service area so the new account can see leads in their city.
    if (city && String(city).trim()) {
      await supabaseAdmin
        .from("service_areas")
        .insert({ contractor_id: userId, city: String(city).trim() });
    }





    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        start_demo_iap: !!start_demo_iap,
        message: start_demo_iap
          ? "Account created. Complete the App Store trial purchase in the app."
          : "Account created. You can sign in.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
