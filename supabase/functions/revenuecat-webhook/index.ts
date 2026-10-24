// RevenueCat webhook → grant credits / subscriptions into the same tables Stripe uses.
// Secrets: REVENUECAT_WEBHOOK_SECRET (the old RevenueCat project), REVENUECAT_WEBHOOK_SECRET_V2 (TreeCheck's own
// project, which sells the phone plans), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. With neither secret set, nothing is
// accepted.
//
// Configure in RevenueCat Dashboard → Integrations → Webhooks, Authorization header "Bearer <secret>".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { billingRollout } from "../_shared/billingRollout.ts";
import { storePlanBlocker } from "../_shared/storePlanBlocker.ts";
import { isStorePlanEvent, legacyDemoUpdate, LEGACY_DEMO_PRODUCTS, storePlanDecision } from "../_shared/storePlans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-revenuecat-signature",
};

const PRODUCT = {
  credits250: "treecheck_credits_250",
  credits500: "treecheck_credits_500",
  marketing: "treecheck_marketing_monthly",
  dma: "treecheck_dma_monthly",
  demo: "treecheck_demo_monthly",
} as const;

const CREDIT_GRANTS: Record<string, number> = {
  [PRODUCT.credits250]: 250,
  [PRODUCT.credits500]: 500,
};

const GRANT_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
]);

const REVOKE_EVENTS = new Set(["EXPIRATION", "CANCELLATION", "REFUND"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const secrets = [Deno.env.get("REVENUECAT_WEBHOOK_SECRET"), Deno.env.get("REVENUECAT_WEBHOOK_SECRET_V2")].filter((s): s is string => !!s);
    const auth = req.headers.get("Authorization") || "";
    if (!secrets.length) console.error("revenuecat-webhook: no webhook secret is set, refusing every event");
    if (!secrets.some((s) => auth === `Bearer ${s}`)) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const event = body?.event || body;
    const eventId = String(event?.id || event?.event_timestamp_ms || crypto.randomUUID());
    const type = String(event?.type || "");
    const appUserId = String(event?.app_user_id || event?.original_app_user_id || "");
    // A product change is about the new product; every other event about its own.
    const productId = String(
      (type === "PRODUCT_CHANGE" ? event?.new_product_id : null) ||
        event?.product_id || event?.new_product_id || event?.entitlement_ids?.[0] || "",
    );
    const transactionId = String(
      event?.transaction_id || event?.original_transaction_id || eventId,
    );

    if (!appUserId || appUserId.startsWith("$RCAnonymousID")) {
      return json({ ok: true, skipped: "anonymous" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Idempotency
    const { data: existing } = await supabase
      .from("iap_events")
      .select("id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (existing) {
      return json({ ok: true, duplicate: true });
    }

    const logEvent = () =>
      supabase.from("iap_events").insert({
        event_id: eventId,
        event_type: type,
        contractor_id: appUserId,
        product_id: productId,
        transaction_id: transactionId,
        payload: event,
      });

    // Phone plans (payments milestone): the owner's company_billing row, decided in _shared/storePlans.ts. The write
    // is an upsert, so it runs before the event is logged and a retry after a failure writes it again.
    if (isStorePlanEvent(event)) {
      const [{ data: row, error: rowError }, rollout] = await Promise.all([
        supabase.from("company_billing")
          .select("pricing_version, provider, environment, status, stripe_subscription_id, complimentary, trial_ends_at, current_period_end, capacity")
          .eq("owner_id", appUserId).maybeSingle(),
        billingRollout(supabase),
      ]);
      if (rowError) throw rowError;
      const blocker = row?.pricing_version === "2026-10" ? null : await storePlanBlocker(supabase, appUserId);
      const decision = storePlanDecision(event, row, {
        sandboxAllowed: rollout.storeSandboxOwnerIds.includes(appUserId),
        blocker,
        now: Date.now(),
      });
      if (decision.kind === "write") {
        const { error } = await supabase.from("company_billing")
          .upsert({ owner_id: appUserId, ...decision.update, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
        if (error) throw error;
      } else if (decision.kind === "skip") {
        console.warn("revenuecat-webhook: phone plan event not applied", { eventId, type, appUserId, reason: decision.reason });
      }
      await logEvent();
      return json({ ok: true, plan: decision.kind });
    }

    await logEvent();

    // The old $50 iPhone plan: access through the same entitlement rows Stripe writes, kept until it really expires.
    if (productId === PRODUCT.demo) {
      const { profile, entitlements } = legacyDemoUpdate(event);
      if (profile) await supabase.from("profiles").update(profile).eq("id", appUserId);
      if (entitlements) {
        // A product the company also pays for through Stripe stays Stripe's.
        const { data: held } = await supabase.from("product_entitlements")
          .select("product, stripe_subscription_id, status").eq("contractor_id", appUserId);
        const stripeHeld = new Set((held ?? [])
          .filter((e) => String(e.stripe_subscription_id ?? "").startsWith("sub_") && e.status !== "canceled")
          .map((e) => e.product));
        for (const product of LEGACY_DEMO_PRODUCTS) {
          if (stripeHeld.has(product)) continue;
          await supabase.from("product_entitlements").upsert({
            contractor_id: appUserId,
            product,
            status: entitlements.status,
            seat_count: 1,
            stripe_subscription_id: `rc:${String(event?.original_transaction_id || transactionId)}`,
            current_period_end: entitlements.current_period_end,
            updated_at: new Date().toISOString(),
          }, { onConflict: "contractor_id,product" });
        }
      }
      return json({ ok: true });
    }

    if (GRANT_EVENTS.has(type)) {
      const creditAmt = CREDIT_GRANTS[productId];
      if (creditAmt) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("credit_balance")
          .eq("id", appUserId)
          .maybeSingle();
        const bal = Number(profile?.credit_balance || 0) + creditAmt;
        const updates: Record<string, unknown> = { credit_balance: bal };
        if (productId === PRODUCT.credits500) {
          updates.subscription_tier = "premium";
          updates.discount_next_lead = true;
        } else if (productId === PRODUCT.credits250) {
          updates.discount_next_lead = true;
        }
        await supabase.from("profiles").update(updates).eq("id", appUserId);
        await supabase.from("credit_transactions").insert({
          contractor_id: appUserId,
          amount: creditAmt,
          type: "iap_purchase",
          description: `Apple IAP: ${productId}`,
        });
      }

      if (productId === PRODUCT.marketing) {
        await supabase.from("marketing_profiles").upsert(
          {
            contractor_id: appUserId,
            is_active: true,
            stripe_subscription_id: `rc:${transactionId}`,
          },
          { onConflict: "contractor_id" },
        );
      }

      if (productId === PRODUCT.dma) {
        await supabase.from("dma_subscriptions").upsert(
          {
            contractor_id: appUserId,
            status: "active",
            stripe_subscription_id: `rc:${transactionId}`,
          },
          { onConflict: "contractor_id" },
        );
      }

      // Store consumable lead-unlock purchase for later claim
      if (productId.startsWith("treecheck_lead_unlock_")) {
        await supabase.from("iap_lead_unlock_credits").upsert(
          {
            contractor_id: appUserId,
            product_id: productId,
            transaction_id: transactionId,
            consumed: false,
          },
          { onConflict: "transaction_id" },
        );
      }
    }

    if (REVOKE_EVENTS.has(type)) {
      if (productId === PRODUCT.marketing) {
        await supabase
          .from("marketing_profiles")
          .update({ is_active: false })
          .eq("contractor_id", appUserId);
      }
      if (productId === PRODUCT.dma) {
        await supabase
          .from("dma_subscriptions")
          .update({ status: "canceled" })
          .eq("contractor_id", appUserId);
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error("revenuecat-webhook error:", err);
    return json({ error: String(err) }, 500);
  }
});
