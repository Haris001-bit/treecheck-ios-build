// Daily trial reminders (payments milestone, 2026-10-21). Public-key callable for the daily cron, and idempotent:
// each reminder is claimed once in billing_reminders before it's sent, so a rerun or retry never repeats one.
// B1, card on file: a company-plan trial with a Stripe subscription gets an email 7 days before the trial ends, with
//     the date, the amount and how to cancel.
// B2, no card yet: a no-card trial, or a company-plan trial without a subscription, gets an email and a text 2 days
//     before the end, only once the plans are open on the website, so there's something to choose.
// Sandbox and demo companies send nothing (tcNotify). Texts in docs/payments/README.md.
// Phone plans and the old $50 iPhone trial get neither: the App Store and Google Play run those trials themselves.
import { createClient } from "npm:@supabase/supabase-js@2";
import { notifyCtx, sendEmail, sendSms } from "../_shared/tcNotify.ts";
import { quote, formatCents } from "../_shared/companyCatalog.ts";
import { billingRollout, plansOpenFor } from "../_shared/billingRollout.ts";
import { stripeTakesRealCards } from "../_shared/stripeMode.ts";
import { LEGACY_DEMO_PRODUCT } from "../_shared/storePlans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const DAY = 86_400_000;
const PLANS_URL = "https://app.treecheck.ai/dashboard/plans";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });

type Owner = { id: string; email: string | null; phone: string | null; full_name: string | null; is_sandbox: boolean | null };

// deno-lint-ignore no-explicit-any
async function claim(admin: any, ownerId: string, kind: string, trialEndsAt: string): Promise<boolean> {
  // The trial end is part of the key, so a later trial (a new signup on the same login) can be reminded again.
  const { error } = await admin.from("billing_reminders").insert({ owner_id: ownerId, kind: `${kind}:${trialEndsAt.slice(0, 10)}` });
  if (!error) return true;
  if (error.code !== "23505") console.error("billing-reminders: claim failed", kind, error.message);
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const now = Date.now();
    const env = stripeTakesRealCards(Deno.env.get("STRIPE_SECRET_KEY")) ? "live" : "sandbox";
    const rollout = await billingRollout(admin);
    const sent = { b1: 0, b2: 0 };

    const owners = async (ids: string[]) => {
      if (!ids.length) return new Map<string, Owner>();
      const { data } = await admin.from("profiles").select("id, email, phone, full_name, is_sandbox").in("id", ids);
      return new Map<string, Owner>((data ?? []).map((o: Owner) => [o.id, o]));
    };

    // Company-plan trials ending within 7 days.
    const { data: trials, error: trialsError } = await admin.from("company_billing")
      .select("owner_id, trial_ends_at, stripe_subscription_id, billing_interval, capacity, dma_source")
      .eq("pricing_version", "2026-10").eq("provider", "stripe").eq("environment", env).eq("status", "trialing")
      .gt("trial_ends_at", new Date(now).toISOString()).lte("trial_ends_at", new Date(now + 7 * DAY).toISOString());
    if (trialsError) throw trialsError;
    // No-card trials (profile fields only) ending within 2 days.
    const { data: noCard, error: noCardError } = await admin.from("profiles")
      .select("id, trial_ends_at").eq("subscription_tier", "demo_trial").is("stripe_subscription_id", null)
      .eq("account_type", "company").is("parent_contractor_id", null)
      .gt("trial_ends_at", new Date(now).toISOString()).lte("trial_ends_at", new Date(now + 2 * DAY).toISOString());
    if (noCardError) throw noCardError;
    // Never asked for a card: an old $50 iPhone trial (it now carries its real end date, but Apple converts it), and a
    // no-card trial owner who has since taken a plan, a phone plan included.
    const skipNoCard = new Set<string>();
    if (noCard?.length) {
      const noCardIds = noCard.map((p: { id: string }) => p.id);
      const [iap, plans] = await Promise.all([
        admin.from("iap_events").select("contractor_id").in("contractor_id", noCardIds).eq("product_id", LEGACY_DEMO_PRODUCT),
        admin.from("company_billing").select("owner_id").in("owner_id", noCardIds).eq("pricing_version", "2026-10"),
      ]);
      if (iap.error) throw iap.error;
      if (plans.error) throw plans.error;
      for (const e of iap.data ?? []) skipNoCard.add(e.contractor_id);
      for (const b of plans.data ?? []) skipNoCard.add(b.owner_id);
    }

    const ids = [...(trials ?? []).map((t: { owner_id: string }) => t.owner_id), ...(noCard ?? []).map((p: { id: string }) => p.id)];
    const people = await owners([...new Set(ids)]);
    const onPlans = new Set((trials ?? []).map((t: { owner_id: string }) => t.owner_id));

    for (const t of trials ?? []) {
      const owner = people.get(t.owner_id);
      if (!owner) continue;
      const ctx = await notifyCtx(admin, t.owner_id, "billing-reminders");
      if (t.stripe_subscription_id) {
        // B1: the card is charged when the trial ends.
        if (!owner.email || !(await claim(admin, t.owner_id, "B1", t.trial_ends_at))) continue;
        const cap = t.capacity ?? {};
        const interval = t.billing_interval === "year" ? "year" : "month";
        const amount = quote({
          ownerScout: !!cap.ownerScout, scoutSeats: cap.scout ?? 0, managerSeats: cap.manager ?? 0, fieldUsers: cap.field ?? 2,
          dma: t.dma_source === "paid" ? "paid" : t.dma_source === "website" ? "website" : "none",
        }, interval).total;
        const ok = await sendEmail(owner.email, `Your TreeCheck trial ends on ${day(t.trial_ends_at)}`,
          `<p>Your free trial of TreeCheck ends on ${day(t.trial_ends_at)}. Your card will then be charged ${formatCents(amount)} a ${interval}, and your plan carries on with nothing to do.</p>` +
          `<p>If you'd rather not continue, cancel before then in TreeCheck under Profile, then Billing, and you won't be charged.</p>`,
          { ...ctx, kind: "B1", role: "owner" });
        if (ok) sent.b1++;
      } else if (plansOpenFor(rollout, t.owner_id) && Date.parse(t.trial_ends_at) <= now + 2 * DAY) {
        sent.b2 += await addCardReminder(admin, owner, t.trial_ends_at, ctx);
      }
    }
    for (const p of noCard ?? []) {
      const owner = people.get(p.id);
      if (!owner || onPlans.has(p.id) || skipNoCard.has(p.id) || !plansOpenFor(rollout, p.id)) continue;
      sent.b2 += await addCardReminder(admin, owner, p.trial_ends_at, await notifyCtx(admin, p.id, "billing-reminders"));
    }
    return json({ ok: true, sent });
  } catch (error) {
    console.error("billing-reminders failed", error instanceof Error ? error.message : error);
    return json({ error: "billing-reminders failed" }, 500);
  }
});

// B2: the trial ends soon and there's no card yet.
// deno-lint-ignore no-explicit-any
async function addCardReminder(admin: any, owner: Owner, trialEndsAt: string, ctx: any): Promise<number> {
  if (!(await claim(admin, owner.id, "B2", trialEndsAt))) return 0;
  const when = day(trialEndsAt);
  let count = 0;
  if (owner.email && await sendEmail(owner.email, `Your TreeCheck trial ends on ${when}`,
    `<p>Your free trial of TreeCheck ends on ${when}. To keep Scout, your jobs and your crews running after that, choose a plan: <a href="${PLANS_URL}">${PLANS_URL}</a></p>`,
    { ...ctx, kind: "B2", role: "owner" })) count = 1;
  if (owner.phone) await sendSms(owner.phone, `TreeCheck: your free trial ends ${when}. Choose a plan to keep your account running: ${PLANS_URL}`, { ...ctx, kind: "B2", role: "owner" });
  return count;
}
