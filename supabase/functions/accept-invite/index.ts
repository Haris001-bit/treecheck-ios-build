import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PRO_PRICE_ID = "price_1SxJbKLSrCwArzdg1WYErO90";

// All cities/towns within ~30 miles of central OKC
const OKC_METRO_CITIES = [
  "Oklahoma City", "Edmond", "Norman", "Moore", "Midwest City",
  "Del City", "Yukon", "Mustang", "Bethany", "Warr Acres",
  "The Village", "Nichols Hills", "Spencer", "Choctaw", "Harrah",
  "Jones", "Luther", "Arcadia", "Piedmont", "Cashion",
  "Deer Creek", "Guthrie", "Crescent", "Langston", "Coyle",
  "Newcastle", "Blanchard", "Tuttle", "Union City", "El Reno",
  "Shawnee", "Meeker", "Tecumseh", "McLoud", "Dale",
  "Noble", "Slaughterville", "Goldsby", "Washington", "Purcell",
  "Lexington", "Hall Park", "Forest Park", "Lake Aluma",
  "Valley Brook", "Woodlawn Park", "Smith Village", "Tinker AFB",
  "Nicoma Park", "Bridge Creek",
];

// Austin metro cities for Texas contractors
const AUSTIN_METRO_CITIES = [
  "Austin", "Round Rock", "Pflugerville", "Hutto", "Georgetown",
  "Cedar Park", "Leander", "Buda", "Kyle", "Manchaca",
  "Dripping Springs", "Bee Cave", "Lakeway", "Lago Vista", "Spicewood",
  "Elgin", "Manor", "Bastrop", "Rollingwood", "West Lake Hills",
  "Sunset Valley", "Jonestown", "Liberty Hill", "Lockhart", "Taylor",
];

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ACCEPT-INVITE] ${step}${detailsStr}`);
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, password, fullName, companyName, phone, tier } = await req.json();
    logStep("Request received", { tier });

    if (!token || !password) {
      return new Response(
        JSON.stringify({ error: 'Token and password are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Find and validate the invitation
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .select('*')
      .eq('invite_token', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (inviteError || !invitation) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired invitation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create the user account
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: invitation.email,
      password: password,
      email_confirm: true,
    });

    if (authError) {
      console.error('Auth error creating user:', authError);
      return new Response(
        JSON.stringify({ error: 'Unable to create account. Please try again or contact support.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = authData.user?.id;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Failed to create user' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update the profile with additional info
    const subscriptionTier = tier === 'pro' ? 'pro' : 'free';
    await supabaseAdmin
      .from('profiles')
      .update({
        full_name: fullName || null,
        company_name: companyName || null,
        phone: phone || null,
        subscription_tier: subscriptionTier,
      })
      .eq('id', userId);
    
    logStep("Profile updated", { userId, subscriptionTier });

    // Role is automatically set to 'contractor' via the profiles table default
    // No need for separate user_roles insert - the handle_new_user trigger creates the profile

    // Auto-populate service areas based on invitation market
    const market = (invitation.market || 'OKC').toUpperCase().trim();

    const serviceAreaRows = market === 'AUSTIN'
      ? AUSTIN_METRO_CITIES.map(city => ({ contractor_id: userId, city, region: "TX" }))
      : OKC_METRO_CITIES.map(city => ({ contractor_id: userId, city, region: "OK" }));

    const { error: saError } = await supabaseAdmin
      .from('service_areas')
      .insert(serviceAreaRows);

    if (saError) {
      console.error('Error inserting service areas:', saError);
    } else {
      logStep("Service areas populated", { count: serviceAreaRows.length });
    }

    // Mark invitation as used
    await supabaseAdmin
      .from('invitations')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invitation.id);

    // If Pro tier selected, create Stripe checkout session
    if (tier === 'pro') {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
      if (!stripeKey) {
        logStep("STRIPE_SECRET_KEY not set, skipping Pro checkout");
        return new Response(
          JSON.stringify({ success: true, message: 'Account created. Please set up Pro subscription from dashboard.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      
      // Create Stripe customer
      const customer = await stripe.customers.create({
        email: invitation.email,
        metadata: { supabase_user_id: userId }
      });

      // Save customer ID to profile
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customer.id })
        .eq('id', userId);

      logStep("Stripe customer created", { customerId: customer.id });

      const origin = req.headers.get('origin') || 'https://app.treecheck.ai';
      
      // Create checkout session for Pro subscription
      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
        mode: 'subscription',
        success_url: `${origin}/login?subscription=success`,
        cancel_url: `${origin}/login?subscription=cancelled`,
        metadata: { user_id: userId },
      });

      logStep("Checkout session created", { sessionId: session.id });

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Account created successfully',
          checkout_url: session.url
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Account created successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in accept-invite:', error);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
