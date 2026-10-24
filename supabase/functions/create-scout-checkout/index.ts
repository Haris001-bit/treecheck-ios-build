// Starts a Scout subscription with a 14-day free trial (card required); no trial when the company already had one.
// $50/mo for the account owner + $35/mo per additional active team member.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { fromNativeApp, nativePurchaseRefusal } from "../_shared/nativeClient.ts";
import { stripeTakesRealCards } from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SCOUT_BASE_PRICE_ID = "price_1UGdxrLSrCwArzdg0jJTJ729"; // $50/mo owner
const SCOUT_SEAT_PRICE_ID = "price_1UGdyALSrCwArzdgC4D6GAA6"; // $35/mo per extra member
const TRIAL_DAYS = 14;
// Both prices exist only in Stripe test mode. Since the live key went in (2026-10-21) this checkout answers with a
// plain message instead of Stripe's "No such price" error, until upgrades move to the new company plans.
const LEGACY_SCOUT_CLOSED = "The new TreeCheck plans open for payment in the next few days. Nothing is charged until then.";

const log = (step: string, details?: unknown) =>
  console.log(`[CREATE-SCOUT-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (fromNativeApp(req)) return nativePurchaseRefusal(corsHeaders);

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    if (stripeTakesRealCards(stripeKey)) {
      return new Response(JSON.stringify({ error: LEGACY_SCOUT_CLOSED }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const { data: userData, error: userErr } = await admin.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData.user) throw new Error("Authentication failed");
    const user = userData.user;

    // Subscriptions belong to the account owner, not a team member.
    const { data: me } = await admin
      .from("profiles")
      .select("id, email, full_name, company_name, parent_contractor_id, stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    const ownerId = me?.parent_contractor_id || user.id;
    const { data: billingVersion } = await admin.from('company_billing').select('pricing_version').eq('owner_id', ownerId).maybeSingle();
    if (billingVersion?.pricing_version === '2026-10') throw new Error('Use the company plan to purchase Scout licenses. Legacy Scout checkout is disabled for this account.');
    const { data: owner } = await admin
      .from("profiles")
      .select("id, email, full_name, company_name, stripe_customer_id")
      .eq("id", ownerId)
      .maybeSingle();
    if (!owner) throw new Error("Account not found");

    // Already active/trialing? Nothing to buy.
    const { data: existing } = await admin
      .from("product_entitlements")
      .select("status, current_period_end")
      .eq("contractor_id", ownerId)
      .eq("product", "scout")
      .maybeSingle();
    if (existing && ["active", "trialing"].includes(existing.status)) {
      return new Response(JSON.stringify({ error: "Scout is already active on this account." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const { data: trialUsedData, error: trialErr } = await admin.rpc("company_trial_used", { p_owner: ownerId });
    if (trialErr) throw new Error(trialErr.message);
    const trialUsed = trialUsedData === true;

    // Extra seats = active team members under this owner.
    const { count: seatCount } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("parent_contractor_id", ownerId)
      .eq("is_active", true);
    const extraSeats = seatCount ?? 0;

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let customerId = owner.stripe_customer_id ?? null;
    if (customerId) {
      try {
        const c = await stripe.customers.retrieve(customerId);
        if ((c as any).deleted) customerId = null;
      } catch {
        customerId = null;
      }
    }
    if (!customerId) {
      const created = await stripe.customers.create({
        email: owner.email ?? undefined,
        name: owner.full_name ?? undefined,
        metadata: { user_id: ownerId, company_name: owner.company_name ?? "" },
      });
      customerId = created.id;
      await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", ownerId);
    }

    const requestOrigin = (req.headers.get("origin") || "").toLowerCase();
    const isPreview = requestOrigin.includes("lovable.app");
    const origin = isPreview ? requestOrigin : "https://app.treecheck.ai";

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: SCOUT_BASE_PRICE_ID, quantity: 1 },
    ];
    if (extraSeats > 0) lineItems.push({ price: SCOUT_SEAT_PRICE_ID, quantity: extraSeats });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_types: ["card"],
      line_items: lineItems,
      subscription_data: {
        // A trial never restarts: owners who already had one (including Free owners after their trial) pay from day one.
        ...(trialUsed ? {} : { trial_period_days: TRIAL_DAYS }),
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { user_id: ownerId, product: "scout" },
      },
      payment_method_collection: "always",
      success_url: `${origin}/dashboard/instant-estimator?scout=active`,
      cancel_url: `${origin}/dashboard/instant-estimator?scout=cancelled`,
      metadata: { user_id: ownerId, type: "scout_subscription" },
    });

    log("session created", { ownerId, extraSeats, sessionId: session.id });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
