// Who counts as a tree company with Scout, on the server (onboarding milestone). The same rule as the app's
// ScoutRequiredGate (src/components/PaidFeatureGate.tsx) and useEntitlements, so a company the app lets onto the
// Bid Board is never refused here. Pure: callers load the rows. No imports, so vitest can run it.

/** Founder company (Timber Edmond): exempt from Bid Board and sub-network billing. Same list as the app's. */
export const BILLING_EXEMPT_OWNER_IDS = ["705cecc2-5926-48c1-a728-b3ebd6b920a2"];

export interface AccessProfile {
  id: string;
  role?: string | null;
  subscription_tier?: string | null;
  trial_ends_at?: string | null;
}
export interface AccessEntitlement {
  status?: string | null;
  current_period_end?: string | null;
}

/**
 * True when the company (or the person acting for it) may use Scout: Timber, an admin caller, a trial that hasn't
 * ended, or an active or trialing Scout entitlement that hasn't ended.
 */
export function hasScoutAccess(
  ownerId: string,
  callerId: string,
  profiles: AccessProfile[],
  scoutEntitlements: AccessEntitlement[],
  now = Date.now(),
): boolean {
  if (BILLING_EXEMPT_OWNER_IDS.includes(ownerId)) return true;
  const notEnded = (iso?: string | null) => !iso || new Date(iso).getTime() > now;
  for (const p of profiles) {
    if (p.id === callerId && p.role === "admin") return true;
    if (p.subscription_tier === "demo_trial" && notEnded(p.trial_ends_at)) return true;
  }
  return scoutEntitlements.some((e) => (e.status === "active" || e.status === "trialing") && notEnded(e.current_period_end));
}
