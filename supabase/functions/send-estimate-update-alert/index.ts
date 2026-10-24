import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceOrAdmin, notAllowed } from "../_shared/callerGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatPhone(phone: string): string {
  let p = phone.replace(/\D/g, "");
  if (p.length === 10) p = "+1" + p;
  else if (!p.startsWith("+")) p = "+" + p;
  return p;
}

async function sendSMS(to: string, body: string, accountSid: string, authToken: string, fromNumber: string) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
      },
      body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
    }
  );
  const data = await res.json();
  return { to, ok: res.ok, sid: data.sid, error: data.message };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Texts people: only another function (service key) or a TreeCheck admin may call this.
  if (!(await isServiceOrAdmin(req))) return notAllowed(corsHeaders);

  try {
    const { lead_id, new_min, new_max, customer_phone, customer_name, city, job_type } = await req.json();

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER")!;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all contractors serving this city
    const { data: serviceAreas } = await supabase
      .from("service_areas")
      .select("contractor_id")
      .ilike("city", city);

    const uniqueIds = [...new Set((serviceAreas || []).map((sa: any) => sa.contractor_id))];

    const { data: contractors } = await supabase
      .from("profiles")
      .select("full_name, phone")
      .in("id", uniqueIds)
      .not("phone", "is", null);

    const results = [];

    // Send to pros
    const proMessage = `🌳 TREECHECK UPDATE: The ${city} ${job_type.toLowerCase()} estimate has been adjusted to $${new_min}–$${new_max}. Check the app for updated details!\n\nhttps://app.treecheck.ai`;

    const sentPhones = new Set<string>();
    for (const c of contractors || []) {
      if (!c.phone) continue;
      const formatted = formatPhone(c.phone);
      if (sentPhones.has(formatted)) continue;
      sentPhones.add(formatted);
      const r = await sendSMS(formatted, proMessage, accountSid, authToken, fromNumber);
      results.push({ name: c.full_name, ...r });
    }

    // Send to customer
    if (customer_phone) {
      const customerMessage = `Hi ${customer_name}! This is TREECHECK. We've updated the estimate range for your ${job_type.toLowerCase()} in ${city} to $${new_min}–$${new_max} to better reflect the job scope. Local pros have been notified and you should be hearing from them soon!`;
      const r = await sendSMS(formatPhone(customer_phone), customerMessage, accountSid, authToken, fromNumber);
      results.push({ name: customer_name, role: "customer", ...r });
    }

    // Native push to pros
    try {
      if (uniqueIds.length > 0) {
        await supabase.functions.invoke("send-push", {
          body: {
            contractor_ids: uniqueIds,
            notification_type: "lead_updated",
            lead_id,
            title: `🌳 ${city} Estimate Updated`,
            body: `${job_type} now $${new_min}–$${new_max}`,
            data: { lead_id, type: "lead_updated", city, job_type },
          },
        });

      }
    } catch (pushErr) {
      console.error("send-push failed:", pushErr);
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
