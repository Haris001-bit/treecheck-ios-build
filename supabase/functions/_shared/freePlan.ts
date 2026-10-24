// Free owner plan (Oklahoma companies only). The database decides the plan (company_plan) and counts monthly use
// atomically (free_plan_claim); these helpers only call them and word the refusals.
// Subcontractor accounts are never on a plan: company_plan returns 'none' for them.

export type CompanyPlan = "paid" | "trialing" | "free" | "locked" | "none";
export type FreeUseKind = "job" | "scout_preview" | "dma_preview";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function companyPlan(admin: any, ownerId: string): Promise<CompanyPlan> {
  const { data, error } = await admin.rpc("company_plan", { p_owner: ownerId });
  if (error) throw new Error(`company_plan: ${error.message}`);
  return (data ?? "locked") as CompanyPlan;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function companyTrialUsed(admin: any, ownerId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("company_trial_used", { p_owner: ownerId });
  if (error) throw new Error(`company_trial_used: ${error.message}`);
  return data === true;
}

export interface FreeClaim { ok: boolean; already?: boolean; used: number; limit: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function claimFreeUse(admin: any, ownerId: string, kind: FreeUseKind, refId: string): Promise<FreeClaim> {
  const { data, error } = await admin.rpc("free_plan_claim", { p_owner: ownerId, p_kind: kind, p_ref: refId });
  if (error) throw new Error(`free_plan_claim: ${error.message}`);
  return data as FreeClaim;
}

/** The refusal a Free owner sees at a monthly limit. Expected, so callers return it as a normal message. */
export function freeLimitMessage(kind: FreeUseKind, limit: number, trialUsed: boolean): string {
  const next = trialUsed ? "Upgrade to Core" : "Start your 14-day free trial";
  if (kind === "job") return `You've sent ${limit} jobs to subs this month. ${next} for unlimited jobs, or wait until the 1st.`;
  if (kind === "scout_preview") return `You've used your ${limit} free Scout previews this month. ${next} for full estimates, or wait until the 1st.`;
  return `You've used your ${limit} free DMA previews this month. ${next} for full posts, or wait until the 1st.`;
}
