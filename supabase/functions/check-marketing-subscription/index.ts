import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { canCheckLegacyMarketing, findLegacyMarketingSubscription, MARKETING_BILLING_UNAVAILABLE } from '../_shared/legacyMarketingBilling.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    if (!canCheckLegacyMarketing(stripeKey)) return new Response(JSON.stringify({
      subscribed: null, subscription_end: null, subscription_id: null,
      billing_available: false, message: MARKETING_BILLING_UNAVAILABLE,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!user.email) throw new Error('Account email is required.');
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ subscribed: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const subs = await stripe.subscriptions.list({
      customer: customers.data[0].id,
      status: "active",
      limit: 100,
    });

    const activeSubscription = findLegacyMarketingSubscription(subs.data);
    const active = !!activeSubscription;
    const subEnd = activeSubscription
      ? new Date(activeSubscription.current_period_end * 1000).toISOString()
      : null;

    // Sync is_active on the marketing profile
    if (activeSubscription) {
      await supabaseAdmin.from("marketing_profiles").upsert({
        contractor_id: user.id,
        is_active: true,
        stripe_subscription_id: activeSubscription.id,
      }, { onConflict: "contractor_id" });
    }

    return new Response(JSON.stringify({
      subscribed: active,
      subscription_end: subEnd,
      subscription_id: activeSubscription?.id ?? null,
      billing_available: true,
    }), {
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
