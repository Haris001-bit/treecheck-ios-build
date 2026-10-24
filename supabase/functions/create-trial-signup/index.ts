import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { hasScoutAccess, type AccessEntitlement, type AccessProfile } from "../_shared/scoutAccess.ts";
import { trialTakesCard, TRIAL_DAYS_WITHOUT_CARD } from "../_shared/stripeMode.ts";
import { billingRollout, plansOpenFor } from "../_shared/billingRollout.ts";
import { openCompanyPlan } from "../_shared/companyPlanOpen.ts";
import { fromNativeApp } from "../_shared/nativeClient.ts";
import { geocodeBusinessPlace, type Place } from "../_shared/businessPlace.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (step: string, details?: unknown) => {
  console.log(`[CREATE-TRIAL-SIGNUP] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

// A mistake the person can fix (wrong password, missing field). Shown to them, never reported as an incident.
class Fixable extends Error {}

// The plan a new web signup chose (company plans, payments milestone): Core with or without one Scout, monthly or yearly.
function parsePlan(raw: unknown): { ownerScout: boolean; interval: "month" | "year" } | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.ownerScout !== "boolean" || (p.interval !== "month" && p.interval !== "year")) return null;
  return { ownerScout: p.ownerScout, interval: p.interval };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { email, password, full_name, company_name, phone, city, state } = body || {};
    const startFree = body?.start === "free";

    if (!email || !password || !full_name || !company_name) {
      throw new Fixable("Email, password, your name and company name are required");
    }

    if (password.length < 8) throw new Fixable("Password must be at least 8 characters");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Free plan (Oklahoma tree companies only): checked on the map lookup before any account is created.
    let freePlace: Place | null = null;
    if (startFree) {
      if (!city || !String(city).trim() || !state || !String(state).trim()) throw new Fixable("Enter your business city and state to start free.");
      freePlace = await geocodeBusinessPlace(String(city).trim().slice(0, 100), String(state).trim().slice(0, 40));
      if (!freePlace) throw new Fixable("We couldn't find that city. Check the spelling and the state.");
      const { data: states } = await admin.rpc("free_plan_states");
      if (!Array.isArray(states) || !states.includes(freePlace.state)) {
        throw new Fixable("The Free plan is for Oklahoma tree companies. Start your 14-day free trial instead.");
      }
    }

    let userId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let existing: Record<string, any> | null = null;

    // 1. Create a new user, or verify the password for an existing one so
    // someone who already started signup can still continue to payment.
    // Email auto-confirmed so they can sign in right away after checkout.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, company_name },
    });
    if (created?.user) {
      userId = created.user.id;
      log("User created", { userId });
    } else if (createErr && ((createErr as { code?: string }).code === "email_exists" || /already (been )?registered|already exists/i.test(createErr.message))) {
      const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      const { data: signedIn, error: signInErr } = await authClient.auth.signInWithPassword({ email, password });
      if (signInErr || !signedIn.user) {
        throw new Fixable("That email already has a TreeCheck account. Sign in, or enter that account's password here to continue to payment.");
      }
      await authClient.auth.signOut({ scope: "local" }); // only this check's session
      userId = signedIn.user.id;
      log("Existing user verified", { userId });
      // Continuing to payment is for someone who started signup before. Any other login keeps what it is: an admin,
      // a team member, a crew login, or a company that already has Scout (Timber, a running trial, a paid plan).
      const { data: current } = await admin.from("profiles")
        .select("id, role, parent_contractor_id, account_type, subscription_tier, trial_ends_at, company_name, full_name, phone")
        .eq("id", userId).maybeSingle();
      const { data: scout } = await admin.from("product_entitlements")
        .select("status, current_period_end").eq("contractor_id", userId).eq("product", "scout");
      if (current?.role === "admin" || current?.parent_contractor_id || current?.account_type === "subcontractor") {
        throw new Fixable("That email is already used for a TreeCheck login. Sign in with it, or use a different email for your company.");
      }
      if (hasScoutAccess(userId, userId, current ? [current as AccessProfile] : [], (scout ?? []) as AccessEntitlement[])) {
        throw new Fixable("This account already has TreeCheck. Sign in to use it.");
      }
      existing = current ?? {};
    } else {
      throw new Error(createErr?.message || "Failed to create user");
    }

    // 3. Update profile (handle_new_user trigger creates a base row). The trial itself starts only when Stripe
    // confirms the card (stripe-webhook / finalize-trial-signup set subscription_tier), so leaving checkout
    // early never opens the trial.
    if (existing) {
      // Fill in only what is missing; never overwrite a name, company or phone the account already has.
      const fill: Record<string, unknown> = {};
      if (!existing.company_name) fill.company_name = company_name;
      if (!existing.full_name) fill.full_name = full_name;
      if (!existing.phone && phone) fill.phone = phone;
      if (!existing.role) fill.role = "contractor";
      if (Object.keys(fill).length) await admin.from("profiles").update(fill).eq("id", userId);
    } else {
      await admin.from("profiles").upsert({
        id: userId,
        email,
        full_name,
        company_name,
        phone: phone || null,
        role: "contractor",
        account_type: "company",
      });
    }

    // 4. Service area (default city, when provided), for a new account only.
    if (!existing && city && String(city).trim()) {
      await admin.from("service_areas").insert({ contractor_id: userId, city: String(city).trim() });
    }

    if (startFree && freePlace) {
      const { error: locationError } = await admin.from("company_locations").upsert({
        owner_id: userId, city: freePlace.city, state: freePlace.state, latitude: freePlace.lat, longitude: freePlace.lng, label: freePlace.label,
      }, { onConflict: "owner_id" });
      if (locationError) throw locationError;
      // No card, no Stripe customer and no trial dates: the trial clock starts only when they choose it.
      if (!existing?.subscription_tier) await admin.from("profiles").update({ subscription_tier: "free" }).eq("id", userId);
      log("Free plan started", { userId });
      return new Response(JSON.stringify({ free_started: true, user_id: userId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Always send people to the APP domain, never the marketing site. The signup form lives on
    // tradesmarketing.ai but /start-trial/success and /login only exist in the app.
    const requestOrigin = (req.headers.get("origin") || "").toLowerCase();
    const isPreview = requestOrigin.includes("id-preview--") && requestOrigin.includes("lovable.app");
    const origin = isPreview
      ? requestOrigin
      : "https://app.treecheck.ai";

    // Company plans (payments milestone, 2026-10-21). Once billing_rollout opens them and the key is live, the new web
    // signup sends the chosen plan: the account goes onto the 2026-10 plans with no access yet, and the app signs in and
    // opens Stripe Checkout through company-billing, so the card comes first and checkout lives in one place. Requests
    // without a plan (Android 1.1, the tradesmarketing.ai form) keep the no-card trial below and choose a plan later.
    const plan = parsePlan(body?.plan);
    if (plan && !fromNativeApp(req) && trialTakesCard(stripeKey, plansOpenFor(await billingRollout(admin), userId))) {
      const { data: trialUsed, error: trialError } = await admin.rpc("company_trial_used", { p_owner: userId });
      if (trialError) throw trialError;
      const refusal = await openCompanyPlan(admin, userId, {
        env: "live", ownerScout: plan.ownerScout, interval: plan.interval, status: "incomplete",
        trialEndsAt: trialUsed ? null : new Date(Date.now() + TRIAL_DAYS_WITHOUT_CARD * 86_400_000).toISOString(),
      });
      if (refusal) throw new Fixable(refusal);
      log("Company plan opened, checkout next", { userId, trial: !trialUsed });
      return new Response(JSON.stringify({ checkout_next: true, trial: !trialUsed, user_id: userId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // The no-card trial, before the plans open and for requests that don't choose a plan. It starts here with a real end
    // date, and the person goes to sign in. `url` is for the marketing site's form, which expects one.
    // One trial per account: an ended trial doesn't restart.
    if (existing?.subscription_tier === "demo_trial") {
      throw new Fixable("This account has already had its free trial. Sign in to continue.");
    }
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS_WITHOUT_CARD * 86_400_000).toISOString();
    await admin.from("profiles").update({ subscription_tier: "demo_trial", trial_ends_at: trialEndsAt }).eq("id", userId);
    // New test signups only. Existing company agreements remain explicitly legacy.
    if (!existing && body.pricing_version === '2026-10') {
      const { error: billingError } = await admin.from('company_billing').insert({ owner_id: userId, pricing_version: '2026-10', environment: 'sandbox', status: 'trialing', trial_ends_at: trialEndsAt, capacity: { scout: 0, manager: 0, field: 2, ownerScout: false } });
      if (billingError) throw billingError;
    }
    log("Trial started without a card", { userId });
    return new Response(JSON.stringify({
      trial_started: true,
      trial_ends_at: trialEndsAt,
      user_id: userId,
      url: `${origin}/login?trial=started`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg, fixable: err instanceof Fixable }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});
