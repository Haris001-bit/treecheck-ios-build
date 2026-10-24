// Whether a company not yet on the 2026-10 plans may move there through a phone plan (payments milestone, Part B).
// Moving switches on the new permission rules for the whole company, so the companies the website keeps where they
// are stay there too: Timber and founders, a company with teammates (they have no team_member_access rows yet), and
// one paying through Stripe. An owner on the old $50 iPhone plan may move: it's the same Apple subscription.
// Used by revenuecat-webhook before it writes a plan, and by company-billing so the phone plan screen never sells one.

export const STORE_BLOCKERS = {
  protected: "Your company's current plan stays as it is. Contact us to change it.",
  team: "Contact us to move your team to the new plans.",
  web: "Your company pays for TreeCheck on the website.",
} as const;

const TIMBER_OWNER = "705cecc2-5926-48c1-a728-b3ebd6b920a2";

/** Null when the owner may take a phone plan; otherwise the reason, worded for the owner. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function storePlanBlocker(admin: any, owner: string): Promise<string | null> {
  const { data: profile, error } = await admin.from("profiles")
    .select("id, is_founder, stripe_subscription_id, parent_contractor_id, account_type").eq("id", owner).maybeSingle();
  if (error) throw error;
  if (!profile || profile.parent_contractor_id || (profile.account_type ?? "company") !== "company") return STORE_BLOCKERS.protected;
  if (owner === TIMBER_OWNER || profile.is_founder || profile.stripe_subscription_id) return STORE_BLOCKERS.protected;
  const [team, paid] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("parent_contractor_id", owner),
    admin.from("product_entitlements").select("stripe_subscription_id").eq("contractor_id", owner).in("status", ["active", "trialing", "past_due"]),
  ]);
  if (team.error) throw team.error;
  if (paid.error) throw paid.error;
  if (team.count) return STORE_BLOCKERS.team;
  // Rows the old $50 iPhone plan writes carry "rc:"; only a Stripe subscription ("sub_") keeps the company on the web.
  if ((paid.data ?? []).some((e: { stripe_subscription_id?: string | null }) => String(e.stripe_subscription_id ?? "").startsWith("sub_"))) return STORE_BLOCKERS.web;
  return null;
}
