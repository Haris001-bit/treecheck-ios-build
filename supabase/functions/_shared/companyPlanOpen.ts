// Puts a company on the 2026-10 plans (payments milestone, 2026-10-21): a web signup that chose a plan, or an owner
// leaving the no-card trial. The one company_billing row is updated or inserted, never duplicated, and a paid or
// protected agreement is never touched. Stripe Checkout then runs through company-billing.

export type OpenPlan = {
  env: "live" | "sandbox";
  ownerScout: boolean;
  interval: "month" | "year";
  // trialing keeps the access of a no-card trial still running; incomplete gives no access until Checkout completes.
  status: "trialing" | "incomplete";
  trialEndsAt: string | null;
};

/** Null when the company is on the new plans now; otherwise why it stays where it is. */
// deno-lint-ignore no-explicit-any
export async function openCompanyPlan(admin: any, owner: string, plan: OpenPlan): Promise<string | null> {
  const { data: row, error } = await admin.from("company_billing")
    .select("pricing_version, complimentary, stripe_subscription_id").eq("owner_id", owner).maybeSingle();
  if (error) throw error;
  if (row?.complimentary) return "This account keeps its existing agreement.";
  if (row?.stripe_subscription_id) return "This company already has a subscription.";
  const fields = {
    pricing_version: "2026-10",
    environment: plan.env, // always explicit: the column defaults to 'sandbox'
    provider: "stripe",
    status: plan.status,
    trial_ends_at: plan.trialEndsAt,
    billing_interval: plan.interval,
    capacity: { scout: 0, manager: 0, field: 2, ownerScout: plan.ownerScout },
    current_period_end: null,
    updated_at: new Date().toISOString(),
  };
  const { error: writeError } = row
    ? await admin.from("company_billing").update(fields).eq("owner_id", owner).is("stripe_subscription_id", null)
    : await admin.from("company_billing").insert({ owner_id: owner, ...fields });
  if (writeError) throw writeError;
  return null;
}
