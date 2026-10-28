import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { fromNativeApp, nativePurchaseRefusal } from "../_shared/nativeClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PREMIUM-CHECKOUT] ${step}${detailsStr}`);
};

// Premium credit purchase: $500 one-time with Premium perks (auto-renews when balance hits $0)
const PREMIUM_PRICE_ID = "price_1T4R8fLSrCwArzdgsiAIRFgV";
// Closed 2026-10-21 when the live key went in: nothing in the app grants Premium after this one-time payment
// (no handler for premium_credit_purchase or ?premium=success), so a buyer would pay $500 for nothing.
const PREMIUM_CHECKOUT_OPEN = false;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (fromNativeApp(req)) return nativePurchaseRefusal(corsHeaders);
  if (!PREMIUM_CHECKOUT_OPEN) {
    return new Response(JSON.stringify({ error: "Premium isn't available to buy right now." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 409,
    });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Supabase configuration missing");

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Authentication failed");

    const user = userData.user;
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: user.email!, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    const origin = req.headers.get("origin") || "https://app.treecheck.ai";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email!,
      line_items: [{ price: PREMIUM_PRICE_ID, quantity: 1 }],
      mode: "payment",
      payment_intent_data: {
        setup_future_usage: "off_session",
      },
      success_url: `${origin}/dashboard?premium=success`,
      cancel_url: `${origin}/dashboard?premium=cancelled`,
      metadata: {
        user_id: user.id,
        type: 'premium_credit_purchase',
      },
    });

    logStep("Checkout session created", { sessionId: session.id });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
