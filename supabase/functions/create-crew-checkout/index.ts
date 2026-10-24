// Starts a subcontractor membership with a 14-day free trial (card required).
// Locally priced at $10, $25, or $35/mo. No charge where no companies participate.
// The price is worked out here from where the sub works (_shared/crewMarket.ts), never taken from the request.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { CREW_PRICE_IDS, myCrewMarket } from "../_shared/crewMarket.ts";
import { stripeTakesRealCards } from "../_shared/stripeMode.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TRIAL_DAYS = 14;

const log = (step: string, details?: unknown) =>
  console.log(`[CREATE-CREW-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

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

    const ownerId = user.id;
    // On a test key Stripe declines every real card, so nobody is charged until it is live (_shared/stripeMode.ts).
    if (!stripeTakesRealCards(stripeKey)) return new Response(JSON.stringify({ free: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const monthlyPrice = (await myCrewMarket(admin, ownerId)).monthly_price;
    if (monthlyPrice === 0) return new Response(JSON.stringify({ free: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const priceId = CREW_PRICE_IDS[monthlyPrice];
    if (!priceId) throw new Error("Could not work out your local price. Please try again.");
    const { data: owner } = await admin.from("profiles")
      .select("id, email, full_name, company_name, stripe_customer_id").eq("id", ownerId).maybeSingle();
    if (!owner) throw new Error("Account not found");
    const { data: existing } = await admin.from("product_entitlements")
      .select("status").eq("contractor_id", ownerId).eq("product", "crew_membership").maybeSingle();
    if (existing && ["active", "trialing"].includes(existing.status)) {
      return new Response(JSON.stringify({ error: "Your membership is already active." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

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

    // Coming straight back from checkout, a sub can tap again before stripe-webhook has written the membership.
    // Stripe already knows, so never open a second one.
    const current = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    if (current.data.some((s) => (s.status === "active" || s.status === "trialing") && s.metadata?.product === "crew_membership")) {
      return new Response(JSON.stringify({ error: "Your membership is already active. It can take a minute to show up." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    const requestOrigin = (req.headers.get("origin") || "").toLowerCase();
    const isPreview = requestOrigin.includes("lovable.app");
    const origin = isPreview ? requestOrigin : "https://app.treecheck.ai";

    const lineItems = [{ price: priceId, quantity: 1 }];

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_types: ["card"],
      line_items: lineItems,
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { user_id: ownerId, product: "crew_membership", local_monthly_price: String(monthlyPrice) },
      },
      payment_method_collection: "always",
      success_url: `${origin}/dashboard/crew-bids?membership=active`,
      cancel_url: `${origin}/dashboard/crew-bids?membership=cancelled`,
      metadata: { user_id: ownerId, type: "crew_subscription" },
    });

    log("session created", { ownerId, sessionId: session.id });

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
