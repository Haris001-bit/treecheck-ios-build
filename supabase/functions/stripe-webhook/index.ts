// Authoritative Stripe webhook — the source of truth for entitlements.
// Public endpoint (verify_jwt = false). Signature is verified with STRIPE_WEBHOOK_SECRET.
import Stripe from "https://esm.sh/stripe@18.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { isCrewSubscription } from "../_shared/crewMarket.ts";
import { reconcileCompany, ReconcileSkip } from '../_shared/companyReconcile.ts';
import { stripeTakesRealCards } from '../_shared/stripeMode.ts';

const log = (s: string, d?: unknown) =>
  console.log(`[STRIPE-WEBHOOK] ${s}${d ? " " + JSON.stringify(d) : ""}`);

const DEMO_TRIAL_PRODUCTS = ["scout", "dma_basic_demo", "team_seats"];
const DEMO_PRICE_ID = "price_1TcYOALSrCwArzdgFXnQwYOd";
const SEAT_PRICE_ID = "price_1TTVwoLSrCwArzdgWcMzk2P7";
// Scout subscription: $50/mo owner base + $35/mo per additional team member
const SCOUT_BASE_PRICE_ID = "price_1UGdxrLSrCwArzdg0jJTJ729";
const SCOUT_SEAT_PRICE_ID = "price_1UGdyALSrCwArzdgC4D6GAA6";
// Subcontractor membership prices ($10/$25/$35 local, plus the old $20) live in _shared/crewMarket.ts.

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!stripeKey || !webhookSecret) return new Response("Server not configured", { status: 500 });

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    log("BAD SIGNATURE", { err: (err as Error).message });
    return new Response("Bad signature", { status: 400 });
  }

  log("event", { type: event.type, id: event.id });

  // Events from the other Stripe mode can't belong to this key's customers; retrying won't change that.
  if (event.livemode !== stripeTakesRealCards(stripeKey)) {
    log("ignored: other Stripe mode", { id: event.id, livemode: event.livemode });
    return new Response(JSON.stringify({ received: true, ignored: "mode" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        if (!userId) break;

        if (session.mode === "subscription" && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await handleSubscription(admin, userId, sub);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.user_id ?? (await lookupUserByCustomer(admin, sub.customer as string));
        if (!userId) { log("no user for sub", { sub: sub.id }); break; }
        await handleSubscription(admin, userId, sub);
        break;
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice;
        const subId = ((inv as any).subscription ?? (inv as any).parent?.subscription_details?.subscription) as string | null;
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const userId = sub.metadata?.user_id ?? (await lookupUserByCustomer(admin, sub.customer as string));
        if (userId) await handleSubscription(admin, userId, sub);
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId = ((inv as any).subscription ?? (inv as any).parent?.subscription_details?.subscription) as string | null;
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const userId = sub.metadata?.user_id ?? (await lookupUserByCustomer(admin, sub.customer as string));
        if (!userId) break;
        if (sub.metadata?.pricing_version === '2026-10') {
          await reconcileCompany(admin, stripe, userId, sub.id);
          break;
        }
        await markProductsStatus(admin, userId, productsForSubscription(sub), "past_due", periodEnd(sub));
        break;
      }
    }
  } catch (err) {
    if (err instanceof ReconcileSkip) {
      log("ignored: company billing", { id: event.id, reason: err.message });
      return new Response(JSON.stringify({ received: true, ignored: "company" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    log("HANDLER ERROR", { err: (err as Error).message });
    // Let Stripe retry failed writes; reconciliation always retrieves current subscription state.
    return new Response('Webhook processing failed', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// --- helpers ---

function periodEnd(sub: Stripe.Subscription): string | null {
  const unix =
    (sub as any).current_period_end ??
    sub.items?.data?.[0]?.current_period_end ??
    null;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

function productsForSubscription(sub: Stripe.Subscription): string[] {
  const priceIds = sub.items.data.map((i: Stripe.SubscriptionItem) => i.price.id);
  const products: string[] = [];
  if (priceIds.includes(DEMO_PRICE_ID)) products.push(...DEMO_TRIAL_PRODUCTS);
  if (priceIds.includes(SEAT_PRICE_ID)) products.push("team_seats");
  if (priceIds.includes(SCOUT_BASE_PRICE_ID)) products.push("scout");
  if (isCrewSubscription(priceIds, sub.metadata?.product)) products.push("crew_membership");
  return Array.from(new Set(products));
}

async function lookupUserByCustomer(admin: any, customerId: string): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

async function handleSubscription(admin: any, userId: string, sub: Stripe.Subscription) {
  if (sub.metadata?.pricing_version === '2026-10') {
    // reconcileCompany re-reads the subscription and checks the row is on the same Stripe mode.
    const key = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
    await reconcileCompany(admin, new Stripe(key, { apiVersion: '2025-08-27.basil' }), userId, sub.id);
    return;
  }
  const products = productsForSubscription(sub);
  if (products.length === 0) return;

  const status =
    sub.status === "trialing" ? "trialing" :
    sub.status === "active" ? "active" :
    sub.status === "past_due" ? "past_due" :
    "canceled";

  const pEnd = periodEnd(sub);
  const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

  // Keep profile in sync for demo plan
  if (sub.items.data.some((i: Stripe.SubscriptionItem) => i.price.id === DEMO_PRICE_ID)) {
    const tier = status === "trialing" ? "demo_trial" : status === "active" ? "demo_paid" : "free";
    await admin.from("profiles").update({
      stripe_subscription_id: sub.id,
      stripe_customer_id: sub.customer,
      subscription_tier: tier,
      trial_ends_at: trialEnd,
      subscription_ends_at: pEnd,
    }).eq("id", userId);
  }

  await markProductsStatus(admin, userId, products, status, pEnd, sub);
}

async function markProductsStatus(
  admin: any,
  userId: string,
  products: string[],
  status: string,
  periodEndISO: string | null,
  sub?: Stripe.Subscription,
) {
  for (const product of products) {
    let seatCount = 1;
    if (sub && product === "team_seats") {
      seatCount = sub.items.data.find((i: Stripe.SubscriptionItem) => i.price.id === SEAT_PRICE_ID)?.quantity ?? 1;
    } else if (sub && product === "scout") {
      // owner + any additional team-member seats
      seatCount = 1 + (sub.items.data.find((i: Stripe.SubscriptionItem) => i.price.id === SCOUT_SEAT_PRICE_ID)?.quantity ?? 0);
    }
    await admin.from("product_entitlements").upsert({
      contractor_id: userId,
      product,
      status,
      seat_count: seatCount,
      stripe_subscription_id: sub?.id ?? null,
      stripe_customer_id: (sub?.customer as string) ?? null,
      current_period_end: periodEndISO,
      updated_at: new Date().toISOString(),
    }, { onConflict: "contractor_id,product" });
  }
  log("wrote entitlements", { userId, products, status });
}
