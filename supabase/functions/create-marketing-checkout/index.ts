import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { fromNativeApp, nativePurchaseRefusal } from "../_shared/nativeClient.ts";
import { canCheckLegacyMarketing, findLegacyMarketingSubscription, LEGACY_MARKETING_PRICE_ID, MARKETING_BILLING_UNAVAILABLE } from '../_shared/legacyMarketingBilling.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MARKETING_PRICE_ID = LEGACY_MARKETING_PRICE_ID;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (fromNativeApp(req)) return nativePurchaseRefusal(corsHeaders);

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? '',
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? '',
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Authentication failed");

    const user = userData.user;
    if (!canCheckLegacyMarketing(stripeKey)) return new Response(JSON.stringify({ error: MARKETING_BILLING_UNAVAILABLE }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409,
    });
    if (!user.email) throw new Error('Account email is required.');
    const { data: profile } = await supabaseAdmin.from('profiles').select('parent_contractor_id').eq('id', user.id).maybeSingle();
    const { data: billing } = await supabaseAdmin.from('company_billing').select('pricing_version').eq('owner_id', profile?.parent_contractor_id ?? user.id).maybeSingle();
    if (billing?.pricing_version === '2026-10') throw new Error('Use the company plan for marketing purchases. Existing website bundles are preserved.');
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check for existing active subscription
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      // Check if already subscribed
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 100,
      });
      if (findLegacyMarketingSubscription(subs.data)) {
        return new Response(JSON.stringify({ error: "You already have an active Marketing Package subscription." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    const origin = req.headers.get("origin") || "https://app.treecheck.ai";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [{ price: MARKETING_PRICE_ID, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/dashboard/marketing?subscribed=success`,
      cancel_url: `${origin}/dashboard/marketing?subscribed=cancelled`,
      metadata: {
        user_id: user.id,
        type: "marketing_package",
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
