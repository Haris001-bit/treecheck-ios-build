// Who may call a function that texts people (onboarding milestone). The public anon key passes verify_jwt, so
// these functions check the caller themselves: another function sending the service-role key, or a signed-in
// TreeCheck admin (profiles.role = 'admin'). Anyone else gets 401 before anything is read or sent.
// companyHasScout covers the functions a tree company uses to text crew: only a company with Scout.
// Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { BILLING_EXEMPT_OWNER_IDS, hasScoutAccess, type AccessEntitlement, type AccessProfile } from "./scoutAccess.ts";

export async function isServiceOrAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return true;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey!, { auth: { persistSession: false } });
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return false;
  const { data: profile } = await admin.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return profile?.role === "admin";
}

/** The 401 every guarded function answers with, carrying its own CORS headers. */
export function notAllowed(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "Not allowed" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Mirrors the app's ScoutRequiredGate on the server: inviting crew and opening jobs for bids are part of Scout.
 * A login from /register, or a /start-trial abandoned at the card step, is a company with no Scout and gets false.
 * Checks the owner and the caller (a team member acts for the owner).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function companyHasScout(admin: any, ownerId: string, callerId: string): Promise<boolean> {
  if (BILLING_EXEMPT_OWNER_IDS.includes(ownerId)) return true;
  const ids = Array.from(new Set([ownerId, callerId]));
  const { data: profiles } = await admin
    .from("profiles").select("id, role, subscription_tier, trial_ends_at").in("id", ids);
  const { data: scout } = await admin
    .from("product_entitlements").select("status, current_period_end").in("contractor_id", ids).eq("product", "scout");
  return hasScoutAccess(ownerId, callerId, (profiles ?? []) as AccessProfile[], (scout ?? []) as AccessEntitlement[]);
}
