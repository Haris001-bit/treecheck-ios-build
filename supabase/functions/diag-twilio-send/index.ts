import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { isServiceOrAdmin, notAllowed } from "../_shared/callerGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Texts people: only another function (service key) or a TreeCheck admin may call this.
  if (!(await isServiceOrAdmin(req))) return notAllowed(corsHeaders);
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !from) {
    return new Response(JSON.stringify({ error: "missing env", hasSid: !!accountSid, hasToken: !!authToken, hasFrom: !!from }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { to, message } = await req.json();
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }),
  });
  const body = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: body.slice(0, 2000) }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
