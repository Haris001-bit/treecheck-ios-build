// Creates a short-lived "unlock intent" the iOS app uses to hand a contractor
// off to the TreeCheck website to complete a lead unlock. This function does
// NOT charge anyone, does NOT unlock the lead, and does NOT reveal PII.

import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STANDARD_FEE_RATE = 0.05;
const DAY1_FEE_RATE = 0.03;
const DAY2_FEE_RATE = 0.02;
const PREMIUM_DISCOUNT_RATE = 0.025;

function rateForLead(createdAt: string): number {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 36e5;
  if (hours >= 48) return DAY2_FEE_RATE;
  if (hours >= 24) return DAY1_FEE_RATE;
  return STANDARD_FEE_RATE;
}

function priceFromRange(min: number, max: number, rate: number): number {
  return Math.round(((Number(min) + Number(max)) / 2) * rate * 100) / 100;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const leadId: string | undefined = body?.lead_id;
    if (!leadId || typeof leadId !== "string") {
      return new Response(JSON.stringify({ error: "lead_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, service);

    // Resolve contractor parent (team-aware).
    const { data: profile } = await admin
      .from("profiles")
      .select("id, parent_contractor_id, subscription_tier, subscription_ends_at, role")
      .eq("id", user.id)
      .maybeSingle();
    const contractorId = profile?.parent_contractor_id ?? user.id;
    const isAdmin = profile?.role === "admin";

    // Fetch the lead (service role bypasses RLS so we can preview).
    const { data: lead, error: leadErr } = await admin
      .from("leads")
      .select("id, status, purchase_count, estimated_cost_min, estimated_cost_max, created_at, city")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (lead.status !== "available" || (lead.purchase_count ?? 0) >= 3) {
      return new Response(JSON.stringify({ error: "Lead no longer available" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already purchased?
    const { data: existing } = await admin
      .from("lead_purchases")
      .select("id")
      .eq("lead_id", leadId)
      .eq("contractor_id", contractorId)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ error: "Already unlocked" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-area check (admins bypass).
    if (!isAdmin) {
      const { data: areas } = await admin
        .from("service_areas")
        .select("city")
        .eq("contractor_id", contractorId);
      const cities = (areas ?? []).map((a) => String(a.city).toLowerCase());
      if (cities.length && !cities.includes(String(lead.city).toLowerCase())) {
        return new Response(JSON.stringify({ error: "Lead is outside your service area" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Pricing: mirrors src/lib/subscriptions.ts.
    const isPremium =
      (profile?.subscription_tier === "pro" || profile?.subscription_tier === "premium") &&
      (!profile?.subscription_ends_at ||
        new Date(profile.subscription_ends_at).getTime() > Date.now());
    const rate = isPremium ? PREMIUM_DISCOUNT_RATE : rateForLead(lead.created_at);
    const fee = priceFromRange(lead.estimated_cost_min, lead.estimated_cost_max, rate);

    // Issue intent.
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = base64url(tokenBytes);
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin.from("mobile_unlock_intents").insert({
      token_hash: tokenHash,
      contractor_id: contractorId,
      user_id: user.id,
      lead_id: leadId,
      quoted_unlock_fee: fee,
      currency: "usd",
      source_platform: "ios",
      status: "created",
      expires_at: expiresAt,
    });
    if (insertErr) throw insertErr;

    const webBase =
      Deno.env.get("TREECHECK_WEB_BASE_URL") ?? "https://app.treecheck.ai";
    const intentUrl = `${webBase.replace(/\/$/, "")}/mobile/unlock?intent=${encodeURIComponent(token)}&from=ios`;

    // Generate a one-time magic link so the web opens already signed in as this
    // contractor — no password re-entry on the iOS handoff.
    let unlockUrl = intentUrl;
    if (user.email) {
      try {
        const { data: linkData } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email: user.email,
          options: { redirectTo: intentUrl },
        });
        const actionLink = (linkData as any)?.properties?.action_link;
        if (actionLink) unlockUrl = actionLink;
      } catch (_e) {
        // Fall back to the plain intent URL (user will be asked to log in).
      }
    }

    return new Response(
      JSON.stringify({
        unlock_url: unlockUrl,
        quoted_unlock_fee: fee,
        quote_expires_at: expiresAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
