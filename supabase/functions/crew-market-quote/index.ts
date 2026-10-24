import { createClient } from "npm:@supabase/supabase-js@2";
import { companiesNear, crewMonthlyPrice, loadServiceAreas, myCrewMarket, CREW_RADIUS_MILES } from "../_shared/crewMarket.ts";
import { stripeTakesRealCards } from "../_shared/stripeMode.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
// Google Maps goes through Lovable's connector gateway, as in geo-reverse: GOOGLE_MAPS_API_KEY is the gateway
// connection's key, not a Google key, so calling maps.googleapis.com with it directly is always refused.
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

/** The place's point and Google's name for it, or null when it can't be looked up. */
async function geocode(location: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const mapsKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!lovableKey || !mapsKey) { console.error("crew-market-quote: maps gateway not configured"); return null; }
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(location)}`, {
      headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": mapsKey },
    });
  } catch (e) {
    console.error("crew-market-quote: geocode unreachable", e);
    return null;
  }
  const data = await res.json().catch(() => null);
  const first = data?.results?.[0];
  const lat = Number(first?.geometry?.location?.lat), lng = Number(first?.geometry?.location?.lng);
  if (!res.ok || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error("crew-market-quote: geocode failed", res.status, data?.status ?? "", data?.error_message ?? "");
    return null;
  }
  return { lat, lng, label: first.formatted_address || location };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // A company's signup link (/crew-join?owner=<id>): its name, so the sub knows whose crew they're joining.
    if (typeof body.owner === "string") {
      if (!/^[0-9a-f-]{36}$/i.test(body.owner)) return json({ error: "Invalid invite link" }, 400);
      const { data: p } = await admin
        .from("profiles").select("company_name, account_type, is_sandbox").eq("id", body.owner).maybeSingle();
      const live = p && !p.is_sandbox && (p.account_type ?? "company") === "company";
      return json({ company: live ? (p.company_name || null) : null });
    }

    // Signed in with no location: the sub's own local price, for the membership screen.
    if (body.mine === true) {
      const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
      const { data: userData } = token ? await admin.auth.getUser(token) : { data: { user: null } };
      if (!userData?.user) return json({ error: "Please sign in again" }, 401);
      // billing "test": Stripe can't take real cards yet, so the membership screen lets the sub in (stripeMode.ts).
      const billing = stripeTakesRealCards(Deno.env.get("STRIPE_SECRET_KEY")) ? "live" : "test";
      return json({ ...(await myCrewMarket(admin, userData.user.id)), billing, radius_miles: CREW_RADIUS_MILES });
    }

    const location = typeof body.location === "string" ? body.location.trim().slice(0, 160) : "";
    if (location.length < 2) return json({ error: "Enter your city and state" }, 400);
    // A failed lookup never stops signup: the city name alone still finds companies whose areas name that city.
    const place = await geocode(location);
    const count = companiesNear(await loadServiceAreas(admin), place?.lat ?? NaN, place?.lng ?? NaN, location).size;
    return json({ company_count: count, monthly_price: crewMonthlyPrice(count), latitude: place?.lat ?? null, longitude: place?.lng ?? null, location_label: place?.label || location, radius_miles: CREW_RADIUS_MILES });
  } catch (error) {
    console.error("crew-market-quote error", error);
    return json({ error: "Could not check your local network" }, 500);
  }
});
