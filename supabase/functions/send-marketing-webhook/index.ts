import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const webhookUrl = Deno.env.get("MARKETING_WEBHOOK_URL");
    if (!webhookUrl) throw new Error("MARKETING_WEBHOOK_URL is not configured");

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

    // Get marketing profile
    const { data: marketing, error: mpError } = await supabaseAdmin
      .from("marketing_profiles")
      .select("*")
      .eq("contractor_id", user.id)
      .single();

    if (mpError || !marketing) throw new Error("No marketing profile found");
    if (!marketing.is_active) throw new Error("Marketing subscription is not active");

    // Get contractor profile for extra info
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, company_name, phone, email")
      .eq("id", user.id)
      .single();

    // Get service areas
    const { data: areas } = await supabaseAdmin
      .from("service_areas")
      .select("city, region")
      .eq("contractor_id", user.id);

    // Generate a signed URL for the marketing photo
    let photoSignedUrl = null;
    if (marketing.photo_url) {
      const { data: signedData } = await supabaseAdmin.storage
        .from("marketing-photos")
        .createSignedUrl(marketing.photo_url, 60 * 60 * 24 * 30); // 30 day URL
      photoSignedUrl = signedData?.signedUrl;
    }

    const payload = {
      contractor_id: user.id,
      company_name: profile?.company_name,
      owner_name: profile?.full_name,
      phone: profile?.phone,
      email: profile?.email,
      bio: marketing.bio,
      photo_url: photoSignedUrl,
      isa_certified: marketing.isa_certified,
      isa_credentials: marketing.isa_credentials,
      website_url: marketing.website_url,
      service_areas: areas || [],
      is_active: marketing.is_active,
      updated_at: marketing.updated_at,
    };

    // Send to website webhook
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!webhookResponse.ok) {
      console.error("Webhook failed:", webhookResponse.status, await webhookResponse.text());
      throw new Error("Failed to send data to website");
    }

    return new Response(JSON.stringify({ success: true }), {
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
