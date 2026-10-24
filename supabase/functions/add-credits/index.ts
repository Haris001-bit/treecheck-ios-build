import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ADD-CREDITS] ${step}${detailsStr}`);
};

// Called after successful Stripe checkout to actually add credits
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

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
    logStep("User authenticated", { userId: user.id });

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Verify the user actually paid by checking recent checkout sessions
    const customers = await stripe.customers.list({ email: user.email!, limit: 1 });
    if (customers.data.length === 0) throw new Error("No Stripe customer found");

    const sessions = await stripe.checkout.sessions.list({
      customer: customers.data[0].id,
      limit: 5,
    });

    // Find the most recent completed credit purchase session
    const creditSession = sessions.data.find(
      (s) => s.payment_status === 'paid' && s.metadata?.type === 'credit_purchase'
    );

    if (!creditSession) throw new Error("No completed credit purchase found");

    // Check if we already processed this session (idempotency)
    const { data: existingTx } = await supabaseAdmin
      .from("credit_transactions")
      .select("id")
      .eq("stripe_payment_intent_id", creditSession.payment_intent as string)
      .single();

    if (existingTx) {
      logStep("Credits already added for this session");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("credit_balance")
        .eq("id", user.id)
        .single();

      return new Response(JSON.stringify({ 
        success: true, 
        already_processed: true,
        credit_balance: profile?.credit_balance || 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const creditAmount = 250; // $250

    // Add credits to profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credit_balance, stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (profileError) throw new Error("Profile not found");

    const newBalance = (profile.credit_balance || 0) + creditAmount;

    await supabaseAdmin
      .from("profiles")
      .update({ 
        credit_balance: newBalance,
        stripe_customer_id: customers.data[0].id,
        discount_next_lead: true,
      })
      .eq("id", user.id);

    // Record the transaction
    await supabaseAdmin
      .from("credit_transactions")
      .insert({
        contractor_id: user.id,
        amount: creditAmount,
        type: 'purchase',
        description: `$${creditAmount} credit purchase`,
        stripe_payment_intent_id: creditSession.payment_intent as string,
      });

    logStep("Credits added", { newBalance, creditAmount });

    return new Response(JSON.stringify({ 
      success: true, 
      credit_balance: newBalance,
      amount_added: creditAmount 
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
