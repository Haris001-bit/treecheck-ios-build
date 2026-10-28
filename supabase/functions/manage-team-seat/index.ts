import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { fromNativeApp, nativePurchaseRefusal } from "../_shared/nativeClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TEAM_SEAT_LOOKUP_KEY = "treecheck_team_seat_monthly_usd_9";
const TEAM_SEAT_PRODUCT_NAME = "TreeCheck Team Seat";

const log = (s: string, d?: unknown) => console.log(`[TEAM-SEAT] ${s}${d ? " " + JSON.stringify(d) : ""}`);

const getTeamSeatPriceId = async (stripe: Stripe) => {
  const existing = await stripe.prices.list({
    active: true,
    lookup_keys: [TEAM_SEAT_LOOKUP_KEY],
    limit: 1,
  });
  if (existing.data[0]?.id) return existing.data[0].id;

  const product = await stripe.products.create({
    name: TEAM_SEAT_PRODUCT_NAME,
    metadata: { feature: "team_seats" },
  });

  try {
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: 900,
      recurring: { interval: "month" },
      lookup_key: TEAM_SEAT_LOOKUP_KEY,
      metadata: { feature: "team_seats" },
    });
    return price.id;
  } catch (e) {
    const retry = await stripe.prices.list({
      active: true,
      lookup_keys: [TEAM_SEAT_LOOKUP_KEY],
      limit: 1,
    });
    if (retry.data[0]?.id) return retry.data[0].id;
    throw e;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY missing");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const auth = req.headers.get("Authorization");
    if (!auth) throw new Error("No auth header");
    const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (!user?.email) throw new Error("Not authenticated");
    const { data: billingVersion } = await supabase.from('company_billing').select('pricing_version').eq('owner_id', user.id).maybeSingle();
    if (billingVersion?.pricing_version === '2026-10') throw new Error('Use company billing to change assigned seats. Legacy seat purchases are disabled for this account.');

    const body = await req.json();
    const action: "set_quantity" = body.action ?? "set_quantity";
    const desiredQty: number = Math.max(0, parseInt(body.quantity ?? "0", 10));

    // Founder and demo (sandbox) bypass — no Stripe needed; a demo company is never charged.
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_founder, is_sandbox, subscription_tier, trial_ends_at, stripe_subscription_id, stripe_customer_id")
      .eq("id", user.id)
      .single();
    const isFounder = !!profile?.is_founder;
    const isSandbox = profile?.is_sandbox === true;

    const { data: existing } = await supabase
      .from("team_seats").select("*").eq("contractor_id", user.id).maybeSingle();

    if (isFounder || isSandbox) {
      await supabase.from("team_seats").upsert({
        contractor_id: user.id,
        seat_quantity: desiredQty,
        status: isSandbox && !isFounder ? "demo_comp" : "founder_comp",
        stripe_subscription_id: null,
      }, { onConflict: "contractor_id" });
      return new Response(JSON.stringify({ success: true, seat_quantity: desiredQty, founder: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Adding a paid seat from the phone apps would be a Stripe purchase inside the app (_shared/nativeClient.ts).
    if (fromNativeApp(req) && desiredQty > (existing?.seat_quantity ?? 0)) return nativePurchaseRefusal(corsHeaders);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Prefer the customer id stored on the profile (matches current Stripe mode).
    // Fall back to email lookup for legacy accounts.
    let customer: any = null;
    if (profile?.stripe_customer_id) {
      try {
        const c = await stripe.customers.retrieve(profile.stripe_customer_id);
        if (!(c as any).deleted) customer = c;
      } catch (_) {
        // stored id belongs to a different Stripe mode; fall through to email lookup
      }
    }
    if (!customer) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) customer = customers.data[0];
    }
    if (!customer) throw new Error("No Stripe customer found. Add a payment method first.");

    // A card can be attached to the customer without being the invoice default.
    // check-payment-method already treats that as valid, so mirror that behavior here
    // and use the attached card explicitly for the seat subscription.
    let defaultPaymentMethod = typeof customer.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : null;
    if (!defaultPaymentMethod) {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customer.id,
        type: "card",
        limit: 1,
      });
      defaultPaymentMethod = paymentMethods.data[0]?.id ?? null;
    }
    if (!defaultPaymentMethod && !customer.default_source) {
      throw new Error("No payment method on file. Add a card in TreeCheck billing first.");
    }

    // Align seat billing with the demo trial so trial users don't get charged early.
    // We look up the demo subscription and reuse its trial_end (unix seconds).
    let seatTrialEnd: number | undefined;
    if (profile?.subscription_tier === "demo_trial" && profile?.stripe_subscription_id) {
      try {
        const demoSub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
        if (demoSub.trial_end && demoSub.trial_end * 1000 > Date.now()) {
          seatTrialEnd = demoSub.trial_end;
          log("aligning seat trial_end with demo sub", { seatTrialEnd });
        }
      } catch (e) {
        log("could not load demo sub for trial alignment", { err: (e as Error).message });
      }
    }

    const seatPriceId = await getTeamSeatPriceId(stripe);

    // Prefer attaching seats as a line item on the user's MAIN subscription
    // (the $50/mo plan) so everything bills as one combined monthly invoice.
    // Fall back to a standalone seat subscription only if no main sub exists.
    let mainSub: Stripe.Subscription | null = null;
    if (profile?.stripe_subscription_id) {
      try {
        const s = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
        if (s.status !== "canceled") mainSub = s;
      } catch (_) { /* ignore */ }
    }

    if (mainSub) {
      // Find existing seat line item on the main subscription (if any)
      const seatItem = mainSub.items.data.find(
        (it) => it.price?.id === seatPriceId || it.price?.lookup_key === TEAM_SEAT_LOOKUP_KEY,
      );

      if (desiredQty === 0) {
        if (seatItem) {
          await stripe.subscriptionItems.del(seatItem.id, { proration_behavior: "create_prorations" });
        }
        await supabase.from("team_seats").upsert({
          contractor_id: user.id,
          seat_quantity: 0,
          status: "canceled",
          stripe_subscription_id: null,
        }, { onConflict: "contractor_id" });
        log("ok (removed from main sub)", { qty: 0, sub: mainSub.id });
        return new Response(JSON.stringify({ success: true, seat_quantity: 0, subscription_id: mainSub.id }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (seatItem) {
        await stripe.subscriptionItems.update(seatItem.id, {
          quantity: desiredQty,
          proration_behavior: "create_prorations",
        });
      } else {
        await stripe.subscriptionItems.create({
          subscription: mainSub.id,
          price: seatPriceId,
          quantity: desiredQty,
          proration_behavior: "create_prorations",
        });
      }

      await supabase.from("team_seats").upsert({
        contractor_id: user.id,
        seat_quantity: desiredQty,
        status: mainSub.status,
        stripe_subscription_id: mainSub.id,
        stripe_price_id: seatPriceId,
      }, { onConflict: "contractor_id" });

      log("ok (attached to main sub)", { qty: desiredQty, sub: mainSub.id });
      return new Response(JSON.stringify({ success: true, seat_quantity: desiredQty, subscription_id: mainSub.id, attached_to_main: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fallback: no main subscription — manage a standalone seat subscription.
    let subscriptionId = existing?.stripe_subscription_id ?? null;
    let sub: Stripe.Subscription | null = null;
    if (subscriptionId) {
      sub = await stripe.subscriptions.retrieve(subscriptionId);
      if (sub.status === "canceled") sub = null;
    }

    if (desiredQty === 0) {
      if (sub) await stripe.subscriptions.cancel(sub.id);
      await supabase.from("team_seats").upsert({
        contractor_id: user.id,
        seat_quantity: 0,
        status: "canceled",
        stripe_subscription_id: null,
      }, { onConflict: "contractor_id" });
      return new Response(JSON.stringify({ success: true, seat_quantity: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!sub) {
      sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: seatPriceId, quantity: desiredQty }],
        metadata: { feature: "team_seats", contractor_id: user.id, user_id: user.id },
        ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
        payment_behavior: seatTrialEnd ? "default_incomplete" : "error_if_incomplete",
        ...(seatTrialEnd ? { trial_end: seatTrialEnd } : {}),
      });
    } else {
      const item = sub.items.data[0];
      sub = await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: seatPriceId, quantity: desiredQty }],
        ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
        proration_behavior: "create_prorations",
      });
    }

    await supabase.from("team_seats").upsert({
      contractor_id: user.id,
      seat_quantity: desiredQty,
      status: sub.status,
      stripe_subscription_id: sub.id,
      stripe_price_id: seatPriceId,
    }, { onConflict: "contractor_id" });

    log("ok (standalone)", { qty: desiredQty, sub: sub.id });
    return new Response(JSON.stringify({ success: true, seat_quantity: desiredQty, subscription_id: sub.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", { msg });
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
