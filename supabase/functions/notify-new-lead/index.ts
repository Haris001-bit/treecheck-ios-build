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
    const { lead_id, city, estimated_cost_min, estimated_cost_max } = await req.json();

    if (!lead_id || !city) {
      return new Response(JSON.stringify({ error: "Missing lead_id or city" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find contractors who serve this city and have a phone number
    const { data: contractors, error: saError } = await supabase
      .from("service_areas")
      .select("contractor_id")
      .ilike("city", city);

    if (saError) {
      console.error("Error fetching service areas:", saError);
      throw saError;
    }

    if (!contractors || contractors.length === 0) {
      console.log(`No contractors serve ${city}`);
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const uniqueIds = [...new Set(contractors.map((c: any) => c.contractor_id))];

    // Get phone numbers for these contractors
    const { data: profiles, error: profError } = await supabase
      .from("profiles")
      .select("id, phone, full_name")
      .in("id", uniqueIds)
      .eq("is_active", true);

    if (profError) {
      console.error("Error fetching profiles:", profError);
      throw profError;
    }

    const withPhone = (profiles || []).filter((p: any) => p.phone && p.phone.trim().length > 5);

    if (withPhone.length === 0) {
      console.log("No contractors with phone numbers found");
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send SMS via Twilio
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER")!;

    const costRange = `$${Number(estimated_cost_min).toLocaleString()} - $${Number(estimated_cost_max).toLocaleString()}`;
    const message = `🌳 New Tree Lead in ${city}! Est. ${costRange}. Log in to claim it before it's gone!`;

    // Normalize phone to E.164 — default to US (+1) if no country code
    const normalizePhone = (phone: string): string => {
      const digits = phone.replace(/\D/g, "");
      if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
      if (digits.length === 10) return `+1${digits}`;
      if (phone.trim().startsWith("+")) return phone.trim();
      return `+1${digits}`;
    };

    let sentCount = 0;

    for (const contractor of withPhone) {
      try {
        const toNumber = normalizePhone(contractor.phone);
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const body = new URLSearchParams({
          To: toNumber,
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

        if (resp.ok) {
          sentCount++;
          console.log(`SMS sent to ${contractor.full_name || contractor.id}`);
        } else {
          const errBody = await resp.text();
          console.error(`SMS failed for ${contractor.id}:`, errBody);
        }
      } catch (smsErr) {
        console.error(`SMS error for ${contractor.id}:`, smsErr);
      }
    }

    console.log(`Sent ${sentCount}/${withPhone.length} SMS notifications for lead ${lead_id}`);

    // NOTE: Native iOS push for purchasable marketplace leads is intentionally NOT sent.
    // iOS push is gated to access-confirmed events (lead_assigned / lead_unlocked_elsewhere
    // / scout_lead_created) and is fired from the function that grants that access
    // (e.g. purchase webhook, scout-estimate-callback, admin assign). SMS above already
    // notifies contractors of marketplace availability on the web.
    return new Response(JSON.stringify({ sent: sentCount, total: withPhone.length, push_sent: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("notify-new-lead error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
