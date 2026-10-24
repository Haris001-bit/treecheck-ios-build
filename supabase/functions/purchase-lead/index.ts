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
  console.log(`[PURCHASE-LEAD] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { lead_id, use_discount, payment_source } = await req.json();
    if (!lead_id) throw new Error("lead_id is required");
    const creditsOnly = payment_source === "credits" || payment_source === "iap_wallet";

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Supabase configuration missing");

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Authentication failed");
    const user = userData.user;
    logStep("User authenticated", { userId: user.id });

    // Get profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id, subscription_tier, credit_balance, discount_next_lead, full_name, company_name")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      throw new Error("Profile not found");
    }
    if (!creditsOnly && !profile.stripe_customer_id) {
      throw new Error("No payment method on file. Please add a card first.");
    }
    if (!creditsOnly && !stripeKey) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }

    const creditBalance = profile.credit_balance || 0;
    const isPremium = profile.subscription_tier === 'premium';
    const hasNextLeadDiscount = profile.discount_next_lead === true;
    logStep("Profile found", { customerId: profile.stripe_customer_id, creditBalance, isPremium, hasNextLeadDiscount });

    // Get lead
    const { data: lead, error: leadError } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (leadError || !lead) throw new Error("Lead not found");
    
    if (lead.status !== "available") throw new Error("This lead is no longer available");
    if (lead.purchase_count >= 3) throw new Error("This lead has reached the maximum number of contractors (3)");

    // Check duplicate purchase
    const { data: existingPurchase } = await supabaseAdmin
      .from("lead_purchases")
      .select("id")
      .eq("lead_id", lead_id)
      .eq("contractor_id", user.id)
      .single();
    if (existingPurchase) throw new Error("You have already purchased this lead");

    // Check service area
    const { data: serviceArea } = await supabaseAdmin
      .from("service_areas")
      .select("id")
      .eq("contractor_id", user.id)
      .ilike("city", lead.city)
      .single();
    if (!serviceArea) throw new Error("This lead is not in your service area");

    // Calculate price
    const medianCost = (lead.estimated_cost_min + lead.estimated_cost_max) / 2;
    
    // Time-based standard rate decay:
    // 0-24h: 5%, 24-48h: 3%, 48h+: 2%
    const leadAgeMs = Date.now() - new Date(lead.created_at).getTime();
    const leadAgeHours = leadAgeMs / (1000 * 60 * 60);
    let baseStandardRate = 0.05;
    if (leadAgeHours >= 48) baseStandardRate = 0.02;
    else if (leadAgeHours >= 24) baseStandardRate = 0.03;
    logStep("Lead age pricing", { leadAgeHours: Math.round(leadAgeHours), baseStandardRate });

    // Determine fee rate:
    // - Premium in rotation (early access): current standard rate — the advantage IS the early access
    // - Premium out of rotation: 2.5% — discounted rate compensates for no early access
    // - use_discount flag: 2.5% (triggered by credit purchase, one-time)
    // - Otherwise: time-decayed standard rate
    let feeRate = baseStandardRate;

    if (isPremium) {
      // Check if this contractor had early access on this lead
      const { data: rotationEntry } = await supabaseAdmin
        .from("premium_rotation")
        .select("id")
        .eq("lead_id", lead_id)
        .eq("contractor_id", user.id)
        .single();

      if (rotationEntry) {
        // In rotation — they got early access, pay current standard rate
        feeRate = baseStandardRate;
        logStep("Premium in rotation — standard rate", { feeRate });
      } else {
        // Out of rotation — no early access, get 2.5% discount
        feeRate = 0.025;
        logStep("Premium out of rotation — discounted rate", { feeRate });
      }
    } else if (use_discount || hasNextLeadDiscount) {
      feeRate = Math.min(0.025, baseStandardRate);
      logStep("Next-lead discount applied", { use_discount, hasNextLeadDiscount, feeRate });
    }
    const purchaseAmountDollars = Math.round(medianCost * feeRate * 100) / 100;
    const purchaseAmountCents = Math.round(purchaseAmountDollars * 100);

    logStep("Price calculated", { medianCost, feeRate, purchaseAmountDollars });

    // Determine payment method: credits or card
    let paymentMethod: 'credits' | 'card' = 'card';
    let cardChargeCents = purchaseAmountCents;
    let creditsUsed = 0;

    if (creditBalance >= purchaseAmountDollars) {
      // Fully covered by credits
      paymentMethod = 'credits';
      creditsUsed = purchaseAmountDollars;
      cardChargeCents = 0;
      logStep("Paying with credits", { creditsUsed });
    } else if (creditsOnly) {
      throw new Error(
        `Insufficient credits. Need $${purchaseAmountDollars.toFixed(2)}, have $${creditBalance.toFixed(2)}.`,
      );
    } else if (creditBalance > 0) {
      // Partial credits, charge remainder to card
      creditsUsed = creditBalance;
      cardChargeCents = Math.round((purchaseAmountDollars - creditBalance) * 100);
      logStep("Partial credits + card", { creditsUsed, cardChargeCents });
    }

    // From the phone apps, only credits may pay: a card charge, and the Premium auto-renewal below, would be Stripe
    // purchases inside the app (_shared/nativeClient.ts). Credit unlocks from the apps carry on as before.
    const nativeApp = fromNativeApp(req);
    if (nativeApp && cardChargeCents > 0) return nativePurchaseRefusal(corsHeaders);

    const stripe = stripeKey
      ? new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" })
      : null;

    // Charge card if needed
    if (cardChargeCents > 0) {
      if (!stripe || !profile.stripe_customer_id) {
        throw new Error("Card payment is not available. Buy credits or use App Store unlock.");
      }
      const customer = await stripe.customers.retrieve(profile.stripe_customer_id);
      if ((customer as any).deleted) throw new Error("Stripe customer was deleted");

      const paymentMethods = await stripe.paymentMethods.list({
        customer: profile.stripe_customer_id,
        type: "card",
        limit: 1,
      });

      if (paymentMethods.data.length === 0) {
        throw new Error("No payment method on file. Please add a card first.");
      }

      const pm = paymentMethods.data[0];

      const paymentIntent = await stripe.paymentIntents.create({
        amount: cardChargeCents,
        currency: "usd",
        customer: profile.stripe_customer_id,
        payment_method: pm.id,
        off_session: true,
        confirm: true,
        description: `Lead purchase: ${lead.city} - $${lead.estimated_cost_min}-$${lead.estimated_cost_max} job`,
        metadata: { lead_id, contractor_id: user.id },
      });

      if (paymentIntent.status !== "succeeded") {
        throw new Error(`Payment failed with status: ${paymentIntent.status}`);
      }
      logStep("Card charged", { paymentIntentId: paymentIntent.id, amount: cardChargeCents });
    }

    // Deduct credits if used
    if (creditsUsed > 0) {
      const newBalance = creditBalance - creditsUsed;
      await supabaseAdmin
        .from("profiles")
        .update({ credit_balance: newBalance })
        .eq("id", user.id);

      await supabaseAdmin
        .from("credit_transactions")
        .insert({
          contractor_id: user.id,
          amount: -creditsUsed,
          type: 'lead_unlock',
          description: `Lead unlock: ${lead.city}`,
          lead_id,
        });

      logStep("Credits deducted", { creditsUsed, newBalance });

      // Auto-renew: if Premium and balance hits $0, charge $500 and refill (Stripe only)
      if (isPremium && newBalance <= 0 && stripe && profile.stripe_customer_id && !nativeApp) {
        logStep("Auto-renewal triggered — balance depleted");
        try {
          const paymentMethods = await stripe.paymentMethods.list({
            customer: profile.stripe_customer_id,
            type: "card",
            limit: 1,
          });

          if (paymentMethods.data.length > 0) {
            const pm = paymentMethods.data[0];
            const renewalIntent = await stripe.paymentIntents.create({
              amount: 50000, // $500
              currency: "usd",
              customer: profile.stripe_customer_id,
              payment_method: pm.id,
              off_session: true,
              confirm: true,
              description: "Premium auto-renewal: $500 credit refill",
              metadata: { contractor_id: user.id, type: "premium_auto_renewal" },
            });

            if (renewalIntent.status === "succeeded") {
              // Add $500 to balance
              await supabaseAdmin
                .from("profiles")
                .update({ credit_balance: newBalance + 500 })
                .eq("id", user.id);

              await supabaseAdmin
                .from("credit_transactions")
                .insert({
                  contractor_id: user.id,
                  amount: 500,
                  type: 'auto_renewal',
                  description: 'Premium auto-renewal: $500 credit refill',
                  stripe_payment_intent_id: renewalIntent.id,
                });

              logStep("Auto-renewal successful", { paymentIntentId: renewalIntent.id });
            } else {
              logStep("Auto-renewal payment not succeeded", { status: renewalIntent.status });
            }
          } else {
            logStep("Auto-renewal skipped — no card on file");
          }
        } catch (renewalError) {
          // Don't fail the lead purchase if auto-renewal fails
          const msg = renewalError instanceof Error ? renewalError.message : String(renewalError);
          logStep("Auto-renewal failed (non-blocking)", { error: msg });
        }
      }
    }

    // Record purchase
    const { error: purchaseError } = await supabaseAdmin
      .from("lead_purchases")
      .insert({
        lead_id,
        contractor_id: user.id,
        purchase_amount: purchaseAmountDollars,
      });

    if (purchaseError) {
      logStep("CRITICAL: Payment succeeded but purchase record failed", { error: purchaseError.message });
      throw new Error("Payment processed but failed to record purchase. Please contact support.");
    }

    logStep("Purchase complete");

    // Notify admin via SMS (non-blocking)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const notifyResp = await fetch(`${supabaseUrl}/functions/v1/notify-admin-transaction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          type: "lead_purchase",
          contractor_name: profile.full_name || user.email,
          company_name: profile.company_name || null,
          city: lead.city,
          amount: purchaseAmountDollars,
          details: `${lead.job_type} • $${lead.estimated_cost_min}-$${lead.estimated_cost_max} est. • ${paymentMethod === 'credits' ? 'Paid with credits' : creditsUsed > 0 ? `$${creditsUsed} credits + $${cardChargeCents/100} card` : 'Card charge'}`,
        }),
      });
      logStep("Admin notification sent", { ok: notifyResp.ok });
    } catch (notifyErr) {
      logStep("Admin notification failed (non-blocking)", { error: String(notifyErr) });
    }

    // Clear next-lead discount flag if it was used
    if (hasNextLeadDiscount) {
      await supabaseAdmin
        .from("profiles")
        .update({ discount_next_lead: false })
        .eq("id", user.id);
      logStep("Next-lead discount flag cleared");
    }

    // Return new credit balance
    const { data: updatedProfile } = await supabaseAdmin
      .from("profiles")
      .select("credit_balance")
      .eq("id", user.id)
      .single();

    return new Response(JSON.stringify({
      success: true,
      amount_charged: purchaseAmountDollars,
      credits_used: creditsUsed,
      card_charged: cardChargeCents / 100,
      credit_balance: updatedProfile?.credit_balance || 0,
      payment_method: paymentMethod,
    }), {
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
