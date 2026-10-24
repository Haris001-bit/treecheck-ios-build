// Permanently deletes the authenticated user's account.
// Required for App Store compliance (account deletion in-app).

import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0?target=deno";
import { disconnectOwnerBanks } from "../_shared/pulse/itemRemoval.ts";

// Payments milestone (2026-10-21): a deleted account must stop being charged. These are the TreeCheck subscriptions an
// account pays for: its company plan, the old $50 plan, and the legacy Scout, seat, DMA and Marketing subscriptions.
// App Store purchases ("rc:<transaction>") are cancelled in Apple's settings, not here. False if Stripe failed.
// deno-lint-ignore no-explicit-any
async function cancelOwnSubscriptions(admin: any, userId: string): Promise<boolean> {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return true;
  const [billing, profile, entitlements, dma, marketing] = await Promise.all([
    admin.from("company_billing").select("stripe_subscription_id").eq("owner_id", userId),
    admin.from("profiles").select("stripe_subscription_id").eq("id", userId),
    admin.from("product_entitlements").select("stripe_subscription_id").eq("contractor_id", userId),
    admin.from("dma_subscriptions").select("stripe_subscription_id").eq("contractor_id", userId),
    admin.from("marketing_profiles").select("stripe_subscription_id").eq("contractor_id", userId),
  ]);
  const ids = new Set<string>();
  for (const result of [billing, profile, entitlements, dma, marketing]) {
    for (const row of result.data ?? []) if (typeof row.stripe_subscription_id === "string" && row.stripe_subscription_id.startsWith("sub_")) ids.add(row.stripe_subscription_id);
  }
  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });
  for (const id of ids) {
    try {
      const sub = await stripe.subscriptions.retrieve(id);
      if (sub.status !== "canceled" && sub.status !== "incomplete_expired") await stripe.subscriptions.cancel(id);
    } catch (e) {
      // A test-mode id on the live key, or a subscription already gone: nothing left to charge.
      if ((e as { code?: string }).code === "resource_missing") continue;
      console.error("delete-account: subscription not cancelled", id, (e as Error).message);
      return false;
    }
  }
  return true;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? null;

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 200) : "unspecified";
    const details = typeof body?.details === "string" ? body.details.slice(0, 2000) : null;

    const admin = createClient(supabaseUrl, service);

    // Financial Pulse (W2-07): close the company's bank connections at Plaid first. The account's bank
    // records and keys are deleted with it, so a connection left open now could never be closed. If
    // Plaid can't be reached, nothing is deleted and the owner can try again (status 200: the Profile page
    // shows `error` from the body; the client hides the body of a non-2xx reply).
    const banks = await disconnectOwnerBanks(admin, userId);
    if (banks.some((b) => b.outcome === "failed")) {
      return new Response(JSON.stringify({ error: "We couldn't disconnect your bank connection just now. Please try again in a minute." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stop the charges before anything is deleted; if Stripe can't be reached, nothing is deleted and they try again.
    if (!(await cancelOwnSubscriptions(admin, userId))) {
      return new Response(JSON.stringify({ error: "We couldn't cancel your subscription just now. Please try again in a minute." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log why before we delete the user.
    try {
      await admin.from("account_deletion_feedback").insert({
        user_id: userId,
        email: userEmail,
        reason,
        details,
      });
    } catch (_e) {
      // non-fatal
    }

    // Best-effort cleanup of app data. The profiles row is removed via cascade
    // when the auth user is deleted, but we also clear other tables that
    // reference the user directly so nothing dangles.
    const tables: Array<{ table: string; column: string }> = [
      { table: "service_areas", column: "contractor_id" },
      { table: "mobile_unlock_intents", column: "user_id" },
      { table: "estimate_feedback", column: "contractor_id" },
      { table: "contractor_engagement", column: "contractor_id" },
      { table: "premium_rotation", column: "contractor_id" },
    ];
    for (const t of tables) {
      try {
        await admin.from(t.table).delete().eq(t.column, userId);
      } catch (_e) {
        // ignore — some tables may not exist in every environment
      }
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) throw delErr;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
