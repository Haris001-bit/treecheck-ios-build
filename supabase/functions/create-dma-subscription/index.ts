import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { fromNativeApp, nativePurchaseRefusal } from "../_shared/nativeClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DMA_PRICE_ID = "price_1TOTnJLSrCwArzdgWdMkVoXy";

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-DMA-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (fromNativeApp(req)) return nativePurchaseRefusal(corsHeaders);

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Authentication failed");

    const user = userData.user;
    const { data: memberProfile } = await supabaseAdmin.from('profiles').select('parent_contractor_id').eq('id', user.id).single();
    const { data: billingVersion } = await supabaseAdmin.from('company_billing').select('pricing_version').eq('owner_id', memberProfile?.parent_contractor_id ?? user.id).maybeSingle();
    if (billingVersion?.pricing_version === '2026-10') throw new Error('Only the owner can purchase DMA through the company plan.');
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Find existing Stripe customer — every TreeCheck contractor already has one
    const customers = await stripe.customers.list({ email: user.email!, limit: 1 });
    if (customers.data.length === 0) {
      throw new Error("No Stripe customer found. Please add a payment method through TreeCheck billing first.");
    }

    const customer = customers.data[0];
    logStep("Found existing Stripe customer", { customerId: customer.id });

    // Check if already has an active DMA subscription
    const existingSubs = await stripe.subscriptions.list({
      customer: customer.id,
      price: DMA_PRICE_ID,
      status: "active",
      limit: 1,
    });

    if (existingSubs.data.length > 0) {
      throw new Error("You already have an active DMA subscription.");
    }

    // Verify customer has a default payment method
    if (!customer.invoice_settings?.default_payment_method && !customer.default_source) {
      throw new Error("No payment method on file. Please add a card through TreeCheck billing first.");
    }

    // Create the subscription using card on file (no checkout redirect)
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: DMA_PRICE_ID }],
      metadata: {
        feature: "dma",
        contractor_id: user.id,
        started_at: new Date().toISOString(),
      },
      payment_behavior: "error_if_incomplete",
    });

    logStep("DMA subscription created", { subscriptionId: subscription.id });

    // Store in dma_subscriptions table
    const { error: dbError } = await supabaseAdmin
      .from("dma_subscriptions")
      .insert({
        contractor_id: user.id,
        stripe_subscription_id: subscription.id,
        status: "active",
        started_at: new Date().toISOString(),
      });

    if (dbError) {
      logStep("DB insert error (non-fatal)", { error: dbError.message });
    }

    return new Response(JSON.stringify({
      success: true,
      subscription_id: subscription.id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
