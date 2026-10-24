import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceOrAdmin, notAllowed } from "../_shared/callerGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OKC_CITIES = ["oklahoma city", "okc", "edmond", "moore", "norman", "yukon", "mustang", "bethany", "midwest city", "del city", "the village", "nichols hills", "warr acres", "piedmont", "choctaw"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Texts people: only another function (service key) or a TreeCheck admin may call this.
  if (!(await isServiceOrAdmin(req))) return notAllowed(corsHeaders);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find contractors with an OKC-area service area
    const { data: areas, error: areasErr } = await supabase
      .from("service_areas")
      .select("contractor_id, city");
    if (areasErr) throw areasErr;

    const okcContractorIds = new Set<string>();
    for (const a of areas || []) {
      if (a.city && OKC_CITIES.includes(String(a.city).toLowerCase().trim())) {
        okcContractorIds.add(a.contractor_id);
      }
    }

    const { data: contractors, error } = await supabase
      .from("profiles")
      .select("id, full_name, phone, email")
      .in("id", Array.from(okcContractorIds))
      .eq("role", "contractor")
      .not("phone", "is", null);
    if (error) throw error;

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER")!;

    const message = `TreeCheck: A few fresh OKC-area leads just dropped from Timber Tree Service. Mark from Timber is slammed this week and routed them to TreeCheck. Unlock works exactly the same — when you call the homeowner, just mention "Mark from Timber sent you." Good luck!`;

    const results: any[] = [];
    for (const c of contractors || []) {
      let phone = (c.phone || "").replace(/\D/g, "");
      if (phone.length === 10) phone = "+1" + phone;
      else if (!phone.startsWith("+")) phone = "+" + phone;
      if (phone.length < 8) { results.push({ email: c.email, status: "skipped_bad_phone" }); continue; }

      try {
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
            },
            body: new URLSearchParams({ To: phone, From: fromNumber, Body: message }),
          }
        );
        const data = await res.json();
        results.push({ email: c.email, phone, status: res.ok ? "sent" : "failed", sid: data.sid, err: data.message });
      } catch (e) {
        results.push({ email: c.email, status: "error", error: String(e) });
      }
    }

    return new Response(JSON.stringify({ success: true, count: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
