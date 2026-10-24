// Grant lead access after a verified Apple IAP lead-unlock consumable purchase.
// Body: { lead_id, product_id, tier_price_usd, rc_transaction_id, computed_lead_price_usd? }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      lead_id,
      product_id,
      tier_price_usd,
      rc_transaction_id,
      computed_lead_price_usd,
    } = await req.json();

    if (!lead_id || !product_id || !rc_transaction_id) {
      throw new Error("lead_id, product_id, and rc_transaction_id are required");
    }
    if (!String(product_id).startsWith("treecheck_lead_unlock_")) {
      throw new Error("Invalid lead unlock product");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Authentication failed");
    const user = userData.user;

    // Prefer webhook-recorded unused credit; else accept client tx (webhook may lag)
    let creditRow: { id: string; consumed: boolean } | null = null;
    const { data: byTx } = await supabaseAdmin
      .from("iap_lead_unlock_credits")
      .select("id, consumed")
      .eq("transaction_id", rc_transaction_id)
      .eq("contractor_id", user.id)
      .maybeSingle();

    if (byTx) {
      if (byTx.consumed) throw new Error("This purchase was already used");
      creditRow = byTx;
    } else {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("iap_lead_unlock_credits")
        .insert({
          contractor_id: user.id,
          product_id,
          transaction_id: rc_transaction_id,
          consumed: false,
        })
        .select("id, consumed")
        .single();
      if (insErr) {
        // Unique conflict → already exists
        const { data: again } = await supabaseAdmin
          .from("iap_lead_unlock_credits")
          .select("id, consumed")
          .eq("transaction_id", rc_transaction_id)
          .maybeSingle();
        if (!again || again.consumed) throw new Error("Purchase already used or invalid");
        creditRow = again;
      } else {
        creditRow = inserted;
      }
    }

    const { data: lead, error: leadError } = await supabaseAdmin
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();
    if (leadError || !lead) throw new Error("Lead not found");
    if (lead.status !== "available") throw new Error("This lead is no longer available");
    if (lead.purchase_count >= 3) {
      throw new Error("This lead has reached the maximum number of contractors (3)");
    }

    const { data: existingPurchase } = await supabaseAdmin
      .from("lead_purchases")
      .select("id")
      .eq("lead_id", lead_id)
      .eq("contractor_id", user.id)
      .maybeSingle();
    if (existingPurchase) throw new Error("You have already purchased this lead");

    const { data: serviceArea } = await supabaseAdmin
      .from("service_areas")
      .select("id")
      .eq("contractor_id", user.id)
      .ilike("city", lead.city)
      .maybeSingle();
    if (!serviceArea) throw new Error("This lead is not in your service area");

    const amount = Number(tier_price_usd || computed_lead_price_usd || 0);

    const { error: purchaseError } = await supabaseAdmin.from("lead_purchases").insert({
      lead_id,
      contractor_id: user.id,
      purchase_amount: amount,
    });
    if (purchaseError) throw new Error(purchaseError.message);

    await supabaseAdmin
      .from("leads")
      .update({ purchase_count: (lead.purchase_count || 0) + 1 })
      .eq("id", lead_id);

    await supabaseAdmin
      .from("iap_lead_unlock_credits")
      .update({ consumed: true, lead_id, consumed_at: new Date().toISOString() })
      .eq("id", creditRow!.id);

    await supabaseAdmin.from("credit_transactions").insert({
      contractor_id: user.id,
      amount: 0,
      type: "iap_lead_unlock",
      description: `Apple IAP lead unlock: ${lead.city} (${product_id})`,
      lead_id,
    });

    return new Response(
      JSON.stringify({
        success: true,
        payment_method: "iap",
        amount_charged: amount,
        product_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
