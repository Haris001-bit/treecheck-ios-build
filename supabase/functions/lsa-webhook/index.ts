import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lsa-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const secret = req.headers.get("x-lsa-secret");
    const expected = Deno.env.get("LSA_WEBHOOK_SECRET");
    if (!expected || secret !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      contractor_id,
      lead_type,
      customer_name,
      customer_phone,
      job_type,
      message,
      received_at,
    } = body ?? {};

    if (!contractor_id || !lead_type || !["call", "message"].includes(lead_type)) {
      return new Response(
        JSON.stringify({ error: "contractor_id and lead_type (call|message) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("lsa_leads")
      .insert({
        contractor_id,
        lead_type,
        customer_name: customer_name ?? null,
        customer_phone: customer_phone ?? null,
        job_type: job_type ?? null,
        message: message ?? null,
        received_at: received_at ?? new Date().toISOString(),
        raw_payload: body,
      })
      .select()
      .single();

    if (error) throw error;

    // TODO: Trigger Retell call/SMS here based on settings + office hours.
    // For now we just log the lead. Hook up Retell once API key is added.

    return new Response(JSON.stringify({ success: true, lead: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("lsa-webhook error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
