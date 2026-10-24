import Stripe from "https://esm.sh/stripe@18.5.0?target=deno";
import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!authData.user) return json({ error: "Unauthorized" }, 401);
    const { data: me } = await admin.from("profiles").select("parent_contractor_id, stripe_customer_id, is_sandbox").eq("id", authData.user.id).maybeSingle();
    if (me?.is_sandbox) return json({ error: "Billing is simulated in the signup sandbox" }, 400);
    const ownerId = me?.parent_contractor_id ?? authData.user.id;
    const { data: owner } = await admin.from("profiles").select("stripe_customer_id").eq("id", ownerId).maybeSingle();
    if (!owner?.stripe_customer_id) return json({ error: "No billing account found" }, 404);
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2025-08-27.basil" });
    const requestOrigin = (req.headers.get("origin") || "").toLowerCase();
    const origin = requestOrigin.includes("lovable.app") ? requestOrigin : "https://app.treecheck.ai";
    const session = await stripe.billingPortal.sessions.create({ customer: owner.stripe_customer_id, return_url: `${origin}/dashboard/profile` });
    return json({ url: session.url });
  } catch (error) {
    console.error("create-billing-portal error", error);
    return json({ error: error instanceof Error ? error.message : "Could not open billing" }, 500);
  }
});
