import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { isServiceOrAdmin, notAllowed } from "../_shared/callerGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_PHONE = "+13036693816";

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[NOTIFY-ADMIN-TX] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Texts people: only another function (service key) or a TreeCheck admin may call this.
  if (!(await isServiceOrAdmin(req))) return notAllowed(corsHeaders);

  try {
    const { type, contractor_name, company_name, city, amount, details } = await req.json();

    logStep("Received notification request", { type, contractor_name, city, amount });

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER")!;

    let message = "";

    switch (type) {
      case "lead_purchase":
        message = `🌳 Lead Purchased!\n${contractor_name}${company_name ? ` (${company_name})` : ''} unlocked a ${city} lead for $${amount}.${details ? `\n${details}` : ''}`;
        break;
      case "credit_purchase":
        message = `💳 Credit Purchase!\n${contractor_name}${company_name ? ` (${company_name})` : ''} bought $${amount} in credits.${details ? `\n${details}` : ''}`;
        break;
      case "premium_signup":
        message = `⭐ Premium Signup!\n${contractor_name}${company_name ? ` (${company_name})` : ''} signed up for Premium ($${amount}).${details ? `\n${details}` : ''}`;
        break;
      case "auto_renewal":
        message = `🔄 Auto-Renewal!\n${contractor_name}${company_name ? ` (${company_name})` : ''} auto-renewed $${amount} in credits.${details ? `\n${details}` : ''}`;
        break;
      default:
        message = `💰 Transaction: ${type}\n${contractor_name}${company_name ? ` (${company_name})` : ''} — $${amount}.${details ? `\n${details}` : ''}`;
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: ADMIN_PHONE,
      From: fromNumber,
      Body: message,
    });

    const resp = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      logStep("SMS failed", { error: errBody });
      throw new Error(`Twilio error: ${errBody}`);
    }

    logStep("SMS sent to admin");

    return new Response(JSON.stringify({ success: true }), {
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
