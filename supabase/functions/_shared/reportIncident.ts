import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_PHONE = "+13036693816";

function safe(value: unknown, max = 240) {
  return String(value ?? "").replace(/(?:bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{16,}\.?[A-Za-z0-9_-]*/gi, "[redacted]").slice(0, max);
}

export async function reportIncident(input: {
  journey: string; action: string; summary: string; email?: string | null; fingerprint?: string; sandbox?: boolean;
}) {
  if (input.sandbox) return { incident_ref: null, sms_sent: false, suppressed: true };
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const rawFingerprint = input.fingerprint || `${input.journey}:${input.action}:${input.summary}`;
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawFingerprint))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: duplicate } = await admin.from("signup_incidents").select("id").eq("fingerprint", fingerprint).gte("created_at", since).limit(1).maybeSingle();
  const incidentRef = `TC-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  let smsSent = false;
  let deliveryError: string | null = null;
  if (!duplicate) {
    try {
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const token = Deno.env.get("TWILIO_AUTH_TOKEN");
      const from = Deno.env.get("TWILIO_PHONE_NUMBER");
      if (!sid || !token || !from) throw new Error("Text delivery is not configured");
      const message = `TreeCheck error ${incidentRef}\n${safe(input.journey, 40)} · ${safe(input.action, 60)}\n${safe(input.summary)}${input.email ? `\nAccount: ${safe(input.email, 100)}` : ""}`;
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${sid}:${token}`) },
        body: new URLSearchParams({ To: ADMIN_PHONE, From: from, Body: message }),
      });
      if (!response.ok) throw new Error(`Text delivery returned ${response.status}`);
      smsSent = true;
    } catch (error) {
      deliveryError = safe(error instanceof Error ? error.message : error, 180);
    }
  }
  await admin.from("signup_incidents").insert({
    incident_ref: incidentRef, fingerprint, journey: safe(input.journey, 60), action: safe(input.action, 100),
    safe_summary: safe(input.summary), account_email: input.email ? safe(input.email, 255) : null,
    sms_sent: smsSent, sms_suppressed: Boolean(duplicate), delivery_error: deliveryError,
  });
  return { incident_ref: incidentRef, sms_sent: smsSent, suppressed: Boolean(duplicate) };
}
