import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceOrAdmin, notAllowed } from "../_shared/callerGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Texts people: only another function (service key) or a TreeCheck admin may call this.
  if (!(await isServiceOrAdmin(req))) return notAllowed(corsHeaders);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all contractors with phone numbers
    const { data: contractors, error } = await supabase
      .from("profiles")
      .select("id, full_name, phone, email")
      .eq("role", "contractor")
      .not("phone", "is", null);

    if (error) throw error;

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER")!;

    const message = `TREECHECK is LIVE! Sample leads are gone — real homeowners are coming through now. Full details & FAQ:\n\nhttps://app.treecheck.ai/go-live.html`;

    const results = [];

    for (const contractor of contractors || []) {
      if (!contractor.phone) continue;

      let phone = contractor.phone.replace(/\D/g, "");
      if (phone.length === 10) phone = "+1" + phone;
      else if (!phone.startsWith("+")) phone = "+" + phone;

      try {
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
            },
            body: new URLSearchParams({
              To: phone,
              From: fromNumber,
              Body: message,
            }),
          }
        );

        const data = await twilioRes.json();
        results.push({ email: contractor.email, status: twilioRes.ok ? "sent" : "failed", sid: data.sid });
      } catch (e) {
        results.push({ email: contractor.email, status: "error", error: String(e) });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
