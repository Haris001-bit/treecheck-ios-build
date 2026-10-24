import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DMA_PRICE_ID = "price_1TOTnJLSrCwArzdgWdMkVoXy";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // Resolve effective contractor: if this user is a team member, inherit the parent's DMA subscription + beta flag.
    const { data: ownProfile } = await supabaseAdmin
      .from("profiles")
      .select("parent_contractor_id, dma_beta_enabled, email")
      .eq("id", user.id)
      .maybeSingle();

    const effectiveContractorId = ownProfile?.parent_contractor_id ?? user.id;
    const { data: billing } = await supabaseAdmin.from('company_billing').select('pricing_version,status,dma_source,current_period_end,trial_ends_at,complimentary').eq('owner_id', effectiveContractorId).maybeSingle();
    if (billing?.pricing_version === '2026-10') {
      const caller = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
      const { data: allowed, error } = await caller.rpc('company_has_permission', { p_owner: effectiveContractorId, p_permission: 'dmaManage' });
      if (error) throw error;
      return new Response(JSON.stringify({ subscribed: allowed === true, beta_enabled: allowed === true, subscription_end: billing.current_period_end }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    let effectiveEmail = user.email!;
    let betaEnabled = ownProfile?.dma_beta_enabled === true;

    if (ownProfile?.parent_contractor_id) {
      const { data: parentProfile } = await supabaseAdmin
        .from("profiles")
        .select("email, dma_beta_enabled")
        .eq("id", ownProfile.parent_contractor_id)
        .maybeSingle();
      if (parentProfile?.email) effectiveEmail = parentProfile.email;
      betaEnabled = parentProfile?.dma_beta_enabled === true;
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: effectiveEmail, limit: 1 });
    if (customers.data.length === 0) {
      return new Response(JSON.stringify({ subscribed: false, beta_enabled: betaEnabled }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let subs;
    try {
      subs = await stripe.subscriptions.list({
        customer: customers.data[0].id,
        price: DMA_PRICE_ID,
        status: "active",
        limit: 1,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Price doesn't exist in this Stripe mode (e.g. live price + test key in preview).
      // Degrade gracefully so the dashboard still loads.
      if (msg.includes("No such price")) {
        return new Response(JSON.stringify({ subscribed: false, beta_enabled: betaEnabled }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw e;
    }

    const active = subs.data.length > 0;
    const subEnd = active
      ? new Date(subs.data[0].current_period_end * 1000).toISOString()
      : null;

    // Sync status to dma_subscriptions table under the effective (parent) contractor
    if (active) {
      await supabaseAdmin.from("dma_subscriptions").upsert({
        contractor_id: effectiveContractorId,
        stripe_subscription_id: subs.data[0].id,
        status: "active",
      }, { onConflict: "stripe_subscription_id" });
    }

    // Also get card info for display
    let cardLast4: string | null = null;
    let cardBrand: string | null = null;
    const customer = customers.data[0];
    const pmId = customer.invoice_settings?.default_payment_method;
    if (pmId && typeof pmId === "string") {
      try {
        const pm = await stripe.paymentMethods.retrieve(pmId);
        cardLast4 = pm.card?.last4 || null;
        cardBrand = pm.card?.brand || null;
      } catch { /* ignore */ }
    }

    return new Response(JSON.stringify({
      subscribed: active,
      subscription_end: subEnd,
      subscription_id: active ? subs.data[0].id : null,
      card_last4: cardLast4,
      card_brand: cardBrand,
      beta_enabled: betaEnabled,
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
