import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (s: string, d?: unknown) => console.log(`[FINALIZE-TRIAL] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { session_id } = await req.json();
    if (!session_id) throw new Error("Missing session_id");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2025-08-27.basil" });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ["subscription"] });
    const userId = session.metadata?.user_id;
    if (!userId) throw new Error("No user_id on session");

    const sub = session.subscription as Stripe.Subscription | null;
    if (!sub) throw new Error("No subscription on session");

    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
    const periodEndUnix =
      (sub as any).current_period_end ??
      sub.items?.data?.[0]?.current_period_end ??
      null;
    const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;
    const tier = sub.status === "trialing" ? "demo_trial" : "demo_paid";

    await admin
      .from("profiles")
      .update({
        stripe_subscription_id: sub.id,
        subscription_tier: tier,
        trial_ends_at: trialEnd,
        subscription_ends_at: periodEnd,
      })
      .eq("id", userId);

    log("Updated profile", { userId, tier, trialEnd });

    return new Response(JSON.stringify({ ok: true, user_id: userId, tier, trial_ends_at: trialEnd }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }
});
