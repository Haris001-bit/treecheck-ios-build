// The company plans switch (payments milestone, 2026-10-21). One row in billing_rollout, set in the SQL editor:
// web_live opens the new plans, the card at signup and the plan picker on the website; test_owner_ids opens them
// for listed throwaway owners before that; store_sandbox_owner_ids lists who App Store and Google Play sandbox
// purchases may unlock. Missing or unreadable means everything stays closed.

export type BillingRollout = { webLive: boolean; testOwnerIds: string[]; storeSandboxOwnerIds: string[] };

export const ROLLOUT_CLOSED: BillingRollout = { webLive: false, testOwnerIds: [], storeSandboxOwnerIds: [] };

// deno-lint-ignore no-explicit-any
export async function billingRollout(admin: any): Promise<BillingRollout> {
  const { data, error } = await admin.from("billing_rollout")
    .select("web_live, test_owner_ids, store_sandbox_owner_ids").eq("id", 1).maybeSingle();
  if (error || !data) {
    if (error) console.error("billing_rollout unreadable, plans stay closed:", error.message);
    return ROLLOUT_CLOSED;
  }
  return {
    webLive: data.web_live === true,
    testOwnerIds: Array.isArray(data.test_owner_ids) ? data.test_owner_ids : [],
    storeSandboxOwnerIds: Array.isArray(data.store_sandbox_owner_ids) ? data.store_sandbox_owner_ids : [],
  };
}

/** Whether this owner (or, with null, a brand-new signup) may choose and pay for a company plan on the website. */
export function plansOpenFor(rollout: BillingRollout, owner: string | null): boolean {
  return rollout.webLive || (!!owner && rollout.testOwnerIds.includes(owner));
}
